import { createHash } from "node:crypto";
import type { BoundingBox } from "./models/types.ts";

export type Format = "plain-text" | "pdf" | "zip" | "unknown";
export type CapabilityStatus = "supported" | "partially-supported" | "unsupported" | "unverified";

export interface DetectionResult {
  format: Format;
  status: CapabilityStatus;
  evidence: string[];
}

export interface SourceRecord {
  sourceId: string;
  sha256: string;
  byteLength: number;
  detected: DetectionResult;
}

/** Resource limits applied before and during extraction. */
export interface ExtractionLimits {
  /** Maximum accepted input size in bytes. */
  maxInputBytes: number;
  /** Maximum number of PDF pages that may be processed in one request. */
  maxPages: number;
  /** Maximum number of characters retained for one page. */
  maxTextCharactersPerPage: number;
  /** Maximum wall-clock time for a single extractor invocation. */
  timeoutMs: number;
}

export const DEFAULT_EXTRACTION_LIMITS: Readonly<ExtractionLimits> = {
  maxInputBytes: 50 * 1024 * 1024,
  maxPages: 2_000,
  maxTextCharactersPerPage: 2_000_000,
  timeoutMs: 30_000,
};

/** One page of extracted, source-attributed text. */
export interface ExtractedPage {
  /** 1-based page number in the original document. */
  pageNumber: number;
  textContent?: string | undefined;
  /** Character offset within this page's extracted text (inclusive). */
  startOffset?: number | undefined;
  /** Character offset within this page's extracted text (exclusive). */
  endOffset?: number | undefined;
  /**
   * Bounding box in the extractor's native coordinate space. For PDFs this is
   * PDF user space (origin at the bottom-left of the page, unit = 1/72 inch).
   */
  boundingBox?: BoundingBox | undefined;
  warnings?: string[] | undefined;
}

export interface ExtractionResult {
  status: "complete" | "partial" | "failed";
  text?: string | undefined;
  pages: ExtractedPage[];
  warnings: string[];
  source: SourceRecord;
  /** Present only when a registered extractor handled the detected format. */
  extractorId?: string | undefined;
  extractorVersion?: string | undefined;
  /** Total page count reported by the source, when the format exposes it. */
  pageCount?: number | undefined;
}

export type TextExtraction = ExtractionResult;

export interface ExtractOptions {
  limits?: Partial<ExtractionLimits> | undefined;
}

export interface Extractor {
  readonly format: Format;
  readonly id: string;
  readonly version: string;
  extract(bytes: Uint8Array, source: SourceRecord, options?: ExtractOptions): Promise<ExtractionResult> | ExtractionResult;
}

const PDF_SIGNATURE = Buffer.from("%PDF-");
const ZIP_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];

function startsWith(bytes: Uint8Array, signature: Buffer): boolean {
  return Buffer.from(bytes).subarray(0, signature.length).equals(signature);
}

function isZip(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURES.some((signature) => startsWith(bytes, signature));
}

function isPlausibleUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    decoder.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Detect by content first; extensions are only secondary evidence. */
export function detectFormat(bytes: Uint8Array, filename = ""): DetectionResult {
  const evidence: string[] = [];
  if (startsWith(bytes, PDF_SIGNATURE)) {
    return { format: "pdf", status: "unverified", evidence: ["PDF signature detected"] };
  }
  if (isZip(bytes)) {
    return { format: "zip", status: "unverified", evidence: ["ZIP signature detected; container contents not inspected"] };
  }
  if (isPlausibleUtf8Text(bytes)) {
    evidence.push("Valid UTF-8 text without NUL bytes");
    const extension = filename.toLowerCase().split(".").pop();
    if (extension === "md" || extension === "markdown") evidence.push("Markdown extension hint");
    return { format: "plain-text", status: "supported", evidence };
  }
  if (filename.trim()) evidence.push("Filename extension is not sufficient to identify content");
  return { format: "unknown", status: "unsupported", evidence };
}

/** Creates immutable metadata from caller-provided bytes; does not write or mutate the source. */
export function createSourceRecord(bytes: Uint8Array, filename = ""): SourceRecord {
  const snapshot = Buffer.from(bytes);
  const sha256 = createHash("sha256").update(snapshot).digest("hex");
  return {
    sourceId: sha256,
    sha256,
    byteLength: snapshot.byteLength,
    detected: detectFormat(snapshot, filename),
  };
}

function resolveLimits(options?: ExtractOptions): ExtractionLimits {
  const overrides = options?.limits ?? {};
  const resolved: ExtractionLimits = { ...DEFAULT_EXTRACTION_LIMITS };
  for (const key of Object.keys(overrides) as Array<keyof ExtractionLimits>) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`INVALID_EXTRACTION_LIMIT: ${key} must be a positive integer`);
    }
    resolved[key] = value;
  }
  return resolved;
}

function failure(source: SourceRecord, extractor: Extractor, warnings: string[], pageCount?: number): ExtractionResult {
  return {
    status: "failed",
    pages: [],
    warnings,
    source,
    extractorId: extractor.id,
    extractorVersion: extractor.version,
    ...(pageCount === undefined ? {} : { pageCount }),
  };
}

export const plainTextExtractor: Extractor = {
  format: "plain-text",
  id: "builtin-plain-text",
  version: "1.0.0",
  extract(bytes, source, options) {
    const limits = resolveLimits(options);
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const truncated = text.length > limits.maxTextCharactersPerPage;
      const textContent = truncated ? text.slice(0, limits.maxTextCharactersPerPage) : text;
      return {
        status: truncated ? "partial" : "complete",
        text: textContent,
        pages: [{
          pageNumber: 1,
          textContent,
          startOffset: 0,
          endOffset: textContent.length,
          ...(truncated ? { warnings: ["TEXT_TRUNCATED: The text exceeded the per-page character limit."] } : {}),
        }],
        warnings: truncated
          ? ["TEXT_TRUNCATED: The text exceeded the per-page character limit."]
          : [],
        source,
        extractorId: this.id,
        extractorVersion: this.version,
        pageCount: 1,
      };
    } catch {
      return failure(source, this, ["TEXT_DECODE_FAILED: Input is not valid UTF-8; no text was extracted."]);
    }
  },
};

interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
}

function pageText(items: PdfTextItem[]): string {
  let text = "";
  for (const item of items) {
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text.trimEnd();
}

function unionBoundingBox(items: PdfTextItem[]): BoundingBox | undefined {
  const positioned = items.filter((item) => item.str.trim() !== "");
  if (positioned.length === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const item of positioned) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function pdfErrorCode(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "PasswordException" || /password|encrypted/i.test(message)) {
    return "PDF_ENCRYPTED";
  }
  return "PDF_PARSE_FAILED";
}

export const pdfExtractor: Extractor = {
  format: "pdf",
  id: "builtin-pdf",
  version: "1.0.0",
  async extract(bytes, source, options) {
    const limits = resolveLimits(options);
    if (bytes.byteLength > limits.maxInputBytes) {
      return failure(source, this, [
        `PDF_SIZE_LIMIT_EXCEEDED: Input is ${bytes.byteLength} bytes; limit is ${limits.maxInputBytes}.`,
      ]);
    }

    let documentProxy: { numPages: number; loadingTask?: { destroy?: () => Promise<void> } } | undefined;
    try {
      const unpdf = await import("unpdf");
      documentProxy = await withTimeout(
        unpdf.getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 }),
        limits.timeoutMs,
        "PDF_TIMEOUT",
      );

      if (documentProxy.numPages > limits.maxPages) {
        return failure(source, this, [
          `PDF_PAGE_LIMIT_EXCEEDED: Document has ${documentProxy.numPages} pages; limit is ${limits.maxPages}.`,
        ], documentProxy.numPages);
      }

      const { items } = await withTimeout(
        unpdf.extractTextItems(documentProxy as never),
        limits.timeoutMs,
        "PDF_TIMEOUT",
      );
      const pages: ExtractedPage[] = [];
      const warnings: string[] = [];
      let extractedPages = 0;
      let truncated = false;

      for (let index = 0; index < documentProxy.numPages; index += 1) {
        const pageNumber = index + 1;
        const pageItems = (items[index] ?? []) as PdfTextItem[];
        const rawText = pageText(pageItems);
        if (rawText.length === 0) {
          const warning = `PDF_PAGE_TEXT_UNAVAILABLE: Page ${pageNumber} has no extractable text; it may be scanned and OCR is not supported.`;
          warnings.push(warning);
          pages.push({ pageNumber, warnings: [warning] });
          continue;
        }
        const pageTruncated = rawText.length > limits.maxTextCharactersPerPage;
        const textContent = pageTruncated
          ? rawText.slice(0, limits.maxTextCharactersPerPage)
          : rawText;
        const boundingBox = unionBoundingBox(pageItems);
        const pageWarnings = pageTruncated
          ? [`PDF_TEXT_TRUNCATED: Page ${pageNumber} exceeded the per-page character limit.`]
          : [];
        if (pageTruncated) {
          truncated = true;
          warnings.push(pageWarnings[0]!);
        }
        pages.push({
          pageNumber,
          textContent,
          startOffset: 0,
          endOffset: textContent.length,
          ...(boundingBox ? { boundingBox } : {}),
          ...(pageWarnings.length > 0 ? { warnings: pageWarnings } : {}),
        });
        extractedPages += 1;
      }

      if (extractedPages === 0) {
        return failure(source, this, [
          "PDF_TEXT_UNAVAILABLE_OCR_REQUIRED: The PDF contains no extractable text. Scanned PDFs require OCR, which is not implemented.",
        ], documentProxy.numPages);
      }

      const text = pages
        .map((page) => page.textContent)
        .filter((value): value is string => value !== undefined && value !== "")
        .join("\n\n");
      const status = warnings.length > 0 || truncated || extractedPages < documentProxy.numPages
        ? "partial"
        : "complete";
      return {
        status,
        text,
        pages,
        warnings,
        source,
        extractorId: this.id,
        extractorVersion: this.version,
        pageCount: documentProxy.numPages,
      };
    } catch (error) {
      const code = (error instanceof Error && error.message === "PDF_TIMEOUT")
        ? "PDF_TIMEOUT"
        : pdfErrorCode(error);
      const messages: Record<string, string> = {
        PDF_TIMEOUT: `PDF_TIMEOUT: Extraction exceeded ${limits.timeoutMs} ms.`,
        PDF_ENCRYPTED: "PDF_ENCRYPTED: The PDF is encrypted or password-protected; no text was extracted.",
        PDF_PARSE_FAILED: "PDF_PARSE_FAILED: The PDF could not be parsed; no text was extracted.",
      };
      return failure(source, this, [messages[code] ?? messages.PDF_PARSE_FAILED!]);
    } finally {
      try {
        await documentProxy?.loadingTask?.destroy?.();
      } catch {
        // Cleanup failure must not change the extraction result.
      }
    }
  },
};

/** Registry intentionally contains only the extractors whose behavior is implemented and tested. */
export class ExtractorRegistry {
  readonly #extractors = new Map<Format, Extractor>();

  register(extractor: Extractor): void {
    if (this.#extractors.has(extractor.format)) {
      throw new Error(`Extractor already registered for format: ${extractor.format}`);
    }
    this.#extractors.set(extractor.format, extractor);
  }

  get(format: Format): Extractor | undefined {
    return this.#extractors.get(format);
  }
}

export async function extractSource(
  bytes: Uint8Array,
  filename = "",
  registry: ExtractorRegistry = defaultRegistry(),
  options?: ExtractOptions,
): Promise<ExtractionResult> {
  const snapshot = Buffer.from(bytes);
  const source = createSourceRecord(snapshot, filename);
  const limits = resolveLimits(options);
  const extractor = registry.get(source.detected.format);
  if (snapshot.byteLength > limits.maxInputBytes) {
    const warning = `INPUT_SIZE_LIMIT_EXCEEDED: Input is ${snapshot.byteLength} bytes; limit is ${limits.maxInputBytes}.`;
    return extractor
      ? failure(source, extractor, [warning])
      : { status: "failed", pages: [], warnings: [warning], source };
  }

  if (!extractor) {
    return {
      status: "failed",
      pages: [],
      warnings: [`NO_EXTRACTOR: No extractor registered for detected format: ${source.detected.format}`],
      source,
    };
  }
  try {
    return await extractor.extract(snapshot, source, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(source, extractor, [`EXTRACTION_FAILED: ${message}`]);
  }
}

export function defaultRegistry(): ExtractorRegistry {
  const registry = new ExtractorRegistry();
  registry.register(plainTextExtractor);
  registry.register(pdfExtractor);
  return registry;
}
