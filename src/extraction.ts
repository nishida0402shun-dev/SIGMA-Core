import { createHash } from "node:crypto";
import type { BoundingBox, ExtractionMethod } from "./models/types.ts";

export type Format = "plain-text" | "pdf" | "image" | "zip" | "unknown";
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
  /** How this page's text was produced. */
  extractionMethod?: ExtractionMethod | undefined;
  /** OCR engine provenance, present only when extractionMethod is "ocr". */
  ocrEngineId?: string | undefined;
  ocrEngineVersion?: string | undefined;
  /** Language specification used by the OCR engine. */
  ocrLanguage?: string | undefined;
  /** Engine-reported mean word confidence in 0..1; not an accuracy measurement. */
  ocrConfidence?: number | undefined;
  /** Preprocessor provenance in the form "id@version", when preprocessing was applied. */
  ocrPreprocessing?: string | undefined;
}

export interface ExtractionResult {
  status: "complete" | "partial" | "failed" | "cancelled";
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

/** Page-level progress emitted while an extraction runs. */
export interface ExtractionProgress {
  phase:
    | "page-started"
    | "page-rendered"
    | "page-preprocessed"
    | "ocr-completed"
    | "page-completed"
    | "page-failed"
    | "cancelled";
  pageNumber: number;
  pageCount?: number | undefined;
  extractionMethod?: ExtractionMethod | undefined;
  message?: string | undefined;
}

import { isOcrCancelled, OcrCancelledError, throwIfAborted } from "./ocr.ts";
import type { ImagePreprocessor, OcrEngine, OcrPageResult, PdfPageRenderer } from "./ocr.ts";
import { assessOcrQuality, validateOcrQualityPolicy, type OcrQualityPolicy } from "./ocr-quality.ts";
import { unpdfPageRenderer } from "./pdf-page-renderer.ts";

export type TextExtraction = ExtractionResult;

export interface ExtractOptions {
  limits?: Partial<ExtractionLimits> | undefined;
  ocrEngine?: OcrEngine | undefined;
  /** Tesseract-style language specification; the engine validates it. */
  ocrLanguage?: string | undefined;
  /** Optional image cleanup applied before OCR; opt-in because it can reduce accuracy. */
  imagePreprocessor?: ImagePreprocessor | undefined;
  /** Flags low-confidence or short OCR text for review; never changes the text by itself. */
  ocrQuality?: OcrQualityPolicy | undefined;
  /** Tried once for a page that needs review; the better attempt by confidence is kept. */
  ocrFallbackPreprocessor?: ImagePreprocessor | undefined;
  /** Stops OCR when process RSS exceeds this many MiB; opt-in, off by default. */
  ocrMemoryLimitMiB?: number | undefined;
  /** Defaults to the unpdf/canvas renderer; injected in tests and host integrations. */
  pdfPageRenderer?: PdfPageRenderer | undefined;
  /** Cancels extraction before a page and aborts in-flight OCR/preprocessing. */
  signal?: AbortSignal | undefined;
  /** Receives page-level progress; callback failures never fail extraction. */
  onProgress?: ((progress: ExtractionProgress) => void) | undefined;
}

export interface Extractor {
  readonly format: Format;
  readonly id: string;
  readonly version: string;
  extract(bytes: Uint8Array, source: SourceRecord, options?: ExtractOptions): Promise<ExtractionResult> | ExtractionResult;
}

const PDF_SIGNATURE = Buffer.from("%PDF-");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
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
  if (startsWith(bytes, PNG_SIGNATURE) || startsWith(bytes, JPEG_SIGNATURE)) {
    return {
      format: "image",
      status: "unverified",
      evidence: ["PNG/JPEG signature detected; text requires an available OCR engine"],
    };
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
  if (options?.ocrMemoryLimitMiB !== undefined) {
    const limit = options.ocrMemoryLimitMiB;
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error("INVALID_OCR_MEMORY_LIMIT: ocrMemoryLimitMiB must be a positive number");
    }
  }
  validateOcrQualityPolicy(options?.ocrQuality);
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

function cancelled(
  source: SourceRecord,
  extractor: Extractor,
  pages: ExtractedPage[],
  warnings: string[],
  pageCount?: number,
): ExtractionResult {
  const text = pages
    .map((page) => page.textContent)
    .filter((value): value is string => value !== undefined && value !== "")
    .join("\n\n");
  return {
    status: "cancelled",
    ...(text.length > 0 ? { text } : {}),
    pages,
    warnings,
    source,
    extractorId: extractor.id,
    extractorVersion: extractor.version,
    ...(pageCount === undefined ? {} : { pageCount }),
  };
}

function reportProgress(options: ExtractOptions | undefined, progress: ExtractionProgress): void {
  try {
    options?.onProgress?.(progress);
  } catch {
    // A host progress callback must not change the extraction result.
  }
}

function preprocessorProvenance(preprocessor: ImagePreprocessor): string {
  const suffix = preprocessor.settings ? `+${preprocessor.settings}` : "";
  return `${preprocessor.id}@${preprocessor.version}${suffix}`;
}

function preprocessorKey(preprocessor: ImagePreprocessor | undefined): string {
  return preprocessor ? preprocessorProvenance(preprocessor) : "none";
}

const MIB = 1024 * 1024;

/** Opt-in admission guard: returns a warning when OCR must not start. */
function memoryLimitWarning(pageNumber: number, options: ExtractOptions | undefined): string | undefined {
  const limit = options?.ocrMemoryLimitMiB;
  if (limit === undefined) return undefined;
  const rssMiB = process.memoryUsage.rss() / MIB;
  if (rssMiB <= limit) return undefined;
  return `OCR_MEMORY_LIMIT: Page ${pageNumber} was not OCR'd because process RSS ${rssMiB.toFixed(1)} MiB exceeds the ${limit.toFixed(1)} MiB limit.`;
}

interface OcrAttempt {
  result: OcrPageResult;
  preprocessor?: ImagePreprocessor | undefined;
  qualityWarnings: string[];
  retryWarnings: string[];
}

async function runOcrAttempt(
  imageBytes: Uint8Array,
  pageNumber: number,
  pageCount: number,
  engine: OcrEngine,
  preprocessor: ImagePreprocessor | undefined,
  limits: ExtractionLimits,
  options: ExtractOptions | undefined,
): Promise<{ result: OcrPageResult; preprocessor: ImagePreprocessor | undefined }> {
  const imageForOcr = preprocessor
    ? await withTimeout(
      preprocessor.process(imageBytes, pageNumber, options?.signal),
      limits.timeoutMs,
      "OCR_TIMEOUT",
      options?.signal,
    )
    : imageBytes;
  if (preprocessor) {
    reportProgress(options, { phase: "page-preprocessed", pageNumber, pageCount });
  }
  throwIfAborted(options?.signal);
  const result = await withTimeout(
    engine.processPage(imageForOcr, pageNumber, {
      timeoutMs: limits.timeoutMs,
      language: options?.ocrLanguage,
      signal: options?.signal,
    }),
    limits.timeoutMs,
    "OCR_TIMEOUT",
    options?.signal,
  );
  throwIfAborted(options?.signal);
  return { result, preprocessor };
}

function formatConfidence(value: number | undefined): string {
  return value === undefined ? "n/a" : value.toFixed(2);
}

function preferAttempt(
  first: { result: OcrPageResult; preprocessor: ImagePreprocessor | undefined },
  second: { result: OcrPageResult; preprocessor: ImagePreprocessor | undefined },
): { result: OcrPageResult; preprocessor: ImagePreprocessor | undefined } {
  const firstLength = first.result.textContent.trim().length;
  const secondLength = second.result.textContent.trim().length;
  if ((firstLength === 0) !== (secondLength === 0)) {
    return firstLength === 0 ? second : first;
  }
  if (first.result.confidence !== undefined && second.result.confidence !== undefined) {
    if (first.result.confidence !== second.result.confidence) {
      return second.result.confidence > first.result.confidence ? second : first;
    }
  } else if (second.result.confidence !== undefined) {
    return second;
  } else if (first.result.confidence !== undefined) {
    return first;
  }
  return secondLength > firstLength ? second : first;
}

/**
 * Runs OCR once and, only when the result needs review and a different fallback
 * preprocessor is configured, retries the page once. Retry keeps the attempt
 * with the higher engine confidence (or non-empty text when the first was empty).
 */
async function runOcrWithQuality(
  imageBytes: Uint8Array,
  pageNumber: number,
  pageCount: number,
  engine: OcrEngine,
  limits: ExtractionLimits,
  options: ExtractOptions | undefined,
): Promise<OcrAttempt> {
  const first = await runOcrAttempt(
    imageBytes,
    pageNumber,
    pageCount,
    engine,
    options?.imagePreprocessor,
    limits,
    options,
  );
  const firstAssessment = assessOcrQuality(
    pageNumber,
    first.result.textContent,
    first.result.confidence,
    options?.ocrQuality,
  );
  const empty = first.result.textContent.trim().length === 0;
  const fallback = options?.ocrFallbackPreprocessor;
  if ((!firstAssessment.needsReview && !empty) || !fallback) {
    return { ...first, qualityWarnings: firstAssessment.warnings, retryWarnings: [] };
  }
  if (preprocessorKey(fallback) === preprocessorKey(options?.imagePreprocessor)) {
    return { ...first, qualityWarnings: firstAssessment.warnings, retryWarnings: [] };
  }

  let second: { result: OcrPageResult; preprocessor: ImagePreprocessor | undefined };
  try {
    second = await runOcrAttempt(imageBytes, pageNumber, pageCount, engine, fallback, limits, options);
  } catch (error) {
    if (isOcrCancelled(error) || options?.signal?.aborted) throw new OcrCancelledError();
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...first,
      qualityWarnings: firstAssessment.warnings,
      retryWarnings: [
        `OCR_RETRY_FAILED: Page ${pageNumber} retry with ${preprocessorKey(fallback)} failed: ${message}`,
      ],
    };
  }

  const chosen = preferAttempt(first, second);
  const chosenAssessment = chosen === first
    ? firstAssessment
    : assessOcrQuality(pageNumber, second.result.textContent, second.result.confidence, options?.ocrQuality);
  return {
    result: chosen.result,
    preprocessor: chosen.preprocessor,
    qualityWarnings: chosenAssessment.warnings,
    retryWarnings: [
      `OCR_RETRY_APPLIED: Page ${pageNumber} was re-OCR'd with ${preprocessorKey(fallback)}; kept ${preprocessorKey(chosen.preprocessor)} (confidence ${formatConfidence(first.result.confidence)} -> ${formatConfidence(second.result.confidence)}).`,
    ],
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
          extractionMethod: "plain-text",
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

/**
 * Standalone PNG/JPEG OCR. There is no embedded-text fallback, so an unavailable
 * engine is a failed extraction rather than a text-less partial result.
 */
export const imageOcrExtractor: Extractor = {
  format: "image",
  id: "builtin-image-ocr",
  version: "1.0.0",
  async extract(bytes, source, options) {
    const limits = resolveLimits(options);
    if (bytes.byteLength > limits.maxInputBytes) {
      return failure(source, this, [
        `IMAGE_SIZE_LIMIT_EXCEEDED: Input is ${bytes.byteLength} bytes; limit is ${limits.maxInputBytes}.`,
      ]);
    }

    const engine = options?.ocrEngine;
    let available = false;
    if (engine) {
      try {
        available = await Promise.resolve(engine.isAvailable());
      } catch {
        available = false;
      }
    }
    if (!engine || !available) {
      return failure(source, this, [
        "OCR_ENGINE_UNAVAILABLE: Standalone image input requires an available OCR engine.",
      ]);
    }

    try {
      throwIfAborted(options?.signal);
      reportProgress(options, { phase: "page-started", pageNumber: 1, pageCount: 1 });
      const memoryWarning = memoryLimitWarning(1, options);
      if (memoryWarning) {
        reportProgress(options, {
          phase: "page-failed",
          pageNumber: 1,
          pageCount: 1,
          message: "process memory limit exceeded",
        });
        return failure(source, this, [memoryWarning], 1);
      }
      const attempt = await runOcrWithQuality(bytes, 1, 1, engine, limits, options);
      const result = attempt.result;
      const text = result.textContent.trim();
      const reviewWarnings = [...attempt.retryWarnings, ...attempt.qualityWarnings];
      if (text.length === 0) {
        reportProgress(options, {
          phase: "page-failed",
          pageNumber: 1,
          pageCount: 1,
          message: "OCR produced no text",
        });
        return failure(source, this, [
          "OCR_PAGE_TEXT_UNAVAILABLE: OCR produced no text for the image.",
          ...reviewWarnings,
        ]);
      }
      const truncated = text.length > limits.maxTextCharactersPerPage;
      const textContent = truncated ? text.slice(0, limits.maxTextCharactersPerPage) : text;
      const warnings = [
        `IMAGE_OCR_APPLIED: Text was produced by ${engine.id} ${engine.version} and may contain recognition errors.`,
        ...reviewWarnings,
        ...(result.warnings ?? []),
        ...(truncated
          ? ["IMAGE_TEXT_TRUNCATED: The text exceeded the per-page character limit."]
          : []),
      ];
      reportProgress(options, { phase: "ocr-completed", pageNumber: 1, pageCount: 1, extractionMethod: "ocr" });
      reportProgress(options, { phase: "page-completed", pageNumber: 1, pageCount: 1, extractionMethod: "ocr" });
      return {
        status: "partial",
        text: textContent,
        pages: [{
          pageNumber: 1,
          textContent,
          startOffset: 0,
          endOffset: textContent.length,
          extractionMethod: "ocr",
          ocrEngineId: engine.id,
          ocrEngineVersion: engine.version,
          ocrLanguage: result.language,
          ocrConfidence: result.confidence,
          ocrPreprocessing: attempt.preprocessor
            ? preprocessorProvenance(attempt.preprocessor)
            : undefined,
          ...(result.boundingBox ? { boundingBox: result.boundingBox } : {}),
          warnings,
        }],
        warnings,
        source,
        extractorId: `${this.id}+${engine.id}`,
        extractorVersion: `${this.version}+${engine.version}`,
        pageCount: 1,
      };
    } catch (error) {
      if (isOcrCancelled(error) || options?.signal?.aborted) {
        reportProgress(options, { phase: "cancelled", pageNumber: 1, pageCount: 1 });
        return cancelled(source, this, [], ["OCR_CANCELLED: Image OCR was cancelled."], 1);
      }
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("OCR_TIMEOUT") ? "OCR_TIMEOUT" : "OCR_PAGE_FAILED";
      reportProgress(options, { phase: "page-failed", pageNumber: 1, pageCount: 1, message });
      return failure(source, this, [`${code}: Image OCR failed: ${message}`]);
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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: string,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = (): void => {
    rejectAbort();
  };
  let rejectAbort: () => void = () => undefined;
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new OcrCancelledError());
    });
    if (signal?.aborted) {
      // The operation promise may already be rejected (for example an engine
      // that aborts its own signal synchronously); mark it handled before throwing.
      promise.catch(() => undefined);
      throw new OcrCancelledError();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    });
    return await Promise.race([promise, timeout, aborted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
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
    const pages: ExtractedPage[] = [];
    const pagesWithoutText: number[] = [];
    let truncated = false;
    let pageCursor = 0;
    let totalPages: number | undefined;
    let memoryStopped = false;
    try {
      throwIfAborted(options?.signal);
      const unpdf = await import("unpdf");
      documentProxy = await withTimeout(
        unpdf.getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 }),
        limits.timeoutMs,
        "PDF_TIMEOUT",
        options?.signal,
      );
      totalPages = documentProxy.numPages;

      if (documentProxy.numPages > limits.maxPages) {
        return failure(source, this, [
          `PDF_PAGE_LIMIT_EXCEEDED: Document has ${documentProxy.numPages} pages; limit is ${limits.maxPages}.`,
        ], documentProxy.numPages);
      }

      const { items } = await withTimeout(
        unpdf.extractTextItems(documentProxy as never),
        limits.timeoutMs,
        "PDF_TIMEOUT",
        options?.signal,
      );

      for (let index = 0; index < documentProxy.numPages; index += 1) {
        throwIfAborted(options?.signal);
        const pageNumber = index + 1;
        pageCursor = pageNumber;
        reportProgress(options, {
          phase: "page-started",
          pageNumber,
          pageCount: documentProxy.numPages,
        });
        const pageItems = (items[index] ?? []) as PdfTextItem[];
        const rawText = pageText(pageItems);
        if (rawText.length === 0) {
          pagesWithoutText.push(pageNumber);
          pages.push({ pageNumber });
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
        if (pageTruncated) truncated = true;
        pages.push({
          pageNumber,
          textContent,
          startOffset: 0,
          endOffset: textContent.length,
          extractionMethod: "embedded-text",
          ...(boundingBox ? { boundingBox } : {}),
          ...(pageWarnings.length > 0 ? { warnings: pageWarnings } : {}),
        });
        reportProgress(options, {
          phase: "page-completed",
          pageNumber,
          pageCount: documentProxy.numPages,
          extractionMethod: "embedded-text",
        });
      }

      // OCR only pages that have no embedded text. Text pages are never re-OCR'd,
      // so mixed PDFs keep their faithful text extraction.
      const ocrEngine = options?.ocrEngine;
      let ocrAttempted = false;
      let ocrUsed = false;
      if (pagesWithoutText.length > 0 && ocrEngine && await Promise.resolve(ocrEngine.isAvailable())) {
        ocrAttempted = true;
        const renderPage = options?.pdfPageRenderer ?? unpdfPageRenderer;
        for (const pageNumber of pagesWithoutText) {
          throwIfAborted(options?.signal);
          pageCursor = pageNumber;
          const memoryWarning = memoryLimitWarning(pageNumber, options);
          if (memoryWarning) {
            memoryStopped = true;
            pages[pageNumber - 1] = { pageNumber, warnings: [memoryWarning] };
            reportProgress(options, {
              phase: "page-failed",
              pageNumber,
              pageCount: documentProxy.numPages,
              message: "process memory limit exceeded",
            });
            break;
          }
          let imageBytes: Uint8Array;
          try {
            imageBytes = await renderPage(documentProxy, pageNumber);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            pages[pageNumber - 1] = {
              pageNumber,
              warnings: [`OCR_RENDER_FAILED: Page ${pageNumber} could not be rendered for OCR: ${message}`],
            };
            reportProgress(options, {
              phase: "page-failed",
              pageNumber,
              pageCount: documentProxy.numPages,
              message,
            });
            continue;
          }
          reportProgress(options, {
            phase: "page-rendered",
            pageNumber,
            pageCount: documentProxy.numPages,
          });
          try {
            throwIfAborted(options?.signal);
            const attempt = await runOcrWithQuality(
              imageBytes,
              pageNumber,
              documentProxy.numPages,
              ocrEngine,
              limits,
              options,
            );
            const ocrResult = attempt.result;
            const reviewWarnings = [...attempt.retryWarnings, ...attempt.qualityWarnings];
            const ocrText = ocrResult.textContent.trim();
            if (ocrText.length === 0) {
              pages[pageNumber - 1] = {
                pageNumber,
                warnings: [
                  `OCR_PAGE_TEXT_UNAVAILABLE: Page ${pageNumber} OCR produced no text.`,
                  ...reviewWarnings,
                ],
              };
              reportProgress(options, {
                phase: "page-failed",
                pageNumber,
                pageCount: documentProxy.numPages,
                message: "OCR produced no text",
              });
              continue;
            }
            const pageTruncated = ocrText.length > limits.maxTextCharactersPerPage;
            const textContent = pageTruncated
              ? ocrText.slice(0, limits.maxTextCharactersPerPage)
              : ocrText;
            const pageWarnings = [
              `PDF_PAGE_OCR_APPLIED: Page ${pageNumber} text was produced by ${ocrEngine.id} ${ocrEngine.version} and may contain recognition errors.`,
              ...reviewWarnings,
              ...(ocrResult.warnings ?? []),
              ...(pageTruncated
                ? [`PDF_TEXT_TRUNCATED: Page ${pageNumber} exceeded the per-page character limit.`]
                : []),
            ];
            if (pageTruncated) truncated = true;
            pages[pageNumber - 1] = {
              pageNumber,
              textContent,
              startOffset: 0,
              endOffset: textContent.length,
              extractionMethod: "ocr",
              ocrEngineId: ocrEngine.id,
              ocrEngineVersion: ocrEngine.version,
              ocrLanguage: ocrResult.language,
              ocrConfidence: ocrResult.confidence,
              ocrPreprocessing: attempt.preprocessor
                ? preprocessorProvenance(attempt.preprocessor)
                : undefined,
              ...(ocrResult.boundingBox ? { boundingBox: ocrResult.boundingBox } : {}),
              warnings: pageWarnings,
            };
            ocrUsed = true;
            reportProgress(options, {
              phase: "ocr-completed",
              pageNumber,
              pageCount: documentProxy.numPages,
              extractionMethod: "ocr",
            });
            reportProgress(options, {
              phase: "page-completed",
              pageNumber,
              pageCount: documentProxy.numPages,
              extractionMethod: "ocr",
            });
          } catch (error) {
            if (isOcrCancelled(error) || options?.signal?.aborted) throw new OcrCancelledError();
            const message = error instanceof Error ? error.message : String(error);
            pages[pageNumber - 1] = {
              pageNumber,
              warnings: [`OCR_PAGE_FAILED: Page ${pageNumber} OCR failed: ${message}`],
            };
            reportProgress(options, {
              phase: "page-failed",
              pageNumber,
              pageCount: documentProxy.numPages,
              message,
            });
          }
        }
      }

      for (const pageNumber of pagesWithoutText) {
        const page = pages[pageNumber - 1]!;
        if (page.textContent !== undefined) continue;
        const reason = memoryStopped
          ? "OCR was stopped because process RSS exceeded the configured memory limit"
          : ocrAttempted
            ? "OCR was attempted but produced no text"
            : ocrEngine
              ? "the OCR engine is unavailable"
              : "no OCR engine is configured";
        page.warnings = [
          ...(page.warnings ?? []),
          `PDF_PAGE_TEXT_UNAVAILABLE: Page ${pageNumber} has no extractable text; ${reason}.`,
        ];
        reportProgress(options, {
          phase: "page-failed",
          pageNumber,
          pageCount: documentProxy.numPages,
          message: reason,
        });
      }

      const warnings = pages.flatMap((page) => page.warnings ?? []);
      const extractedPages = pages.filter(
        (page) => page.textContent !== undefined && page.textContent !== "",
      ).length;

      if (extractedPages === 0) {
        return failure(source, this, [
          ...warnings,
          "PDF_TEXT_UNAVAILABLE_OCR_REQUIRED: The PDF contains no extractable text and OCR produced no text.",
        ], documentProxy.numPages);
      }

      const text = pages
        .map((page) => page.textContent)
        .filter((value): value is string => value !== undefined && value !== "")
        .join("\n\n");
      const status = ocrUsed || warnings.length > 0 || truncated || extractedPages < documentProxy.numPages
        ? "partial"
        : "complete";
      return {
        status,
        text,
        pages,
        warnings,
        source,
        extractorId: ocrUsed && ocrEngine ? `${this.id}+${ocrEngine.id}` : this.id,
        extractorVersion: ocrUsed && ocrEngine ? `${this.version}+${ocrEngine.version}` : this.version,
        pageCount: documentProxy.numPages,
      };
    } catch (error) {
      if (isOcrCancelled(error) || options?.signal?.aborted) {
        reportProgress(options, {
          phase: "cancelled",
          pageNumber: pageCursor,
          ...(totalPages === undefined ? {} : { pageCount: totalPages }),
        });
        const warning = totalPages === undefined
          ? "OCR_CANCELLED: Extraction was cancelled before PDF parsing completed."
          : `OCR_CANCELLED: Extraction was cancelled at page ${pageCursor} of ${totalPages}.`;
        return cancelled(source, this, pages, [...pages.flatMap((page) => page.warnings ?? []), warning], totalPages);
      }
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
  if (options?.signal?.aborted) {
    return cancelled(source, extractor, [], ["OCR_CANCELLED: Extraction was cancelled before it started."]);
  }
  try {
    return await extractor.extract(snapshot, source, options);
  } catch (error) {
    if (isOcrCancelled(error) || options?.signal?.aborted) {
      return cancelled(source, extractor, [], ["OCR_CANCELLED: Extraction was cancelled."]);
    }
    const message = error instanceof Error ? error.message : String(error);
    return failure(source, extractor, [`EXTRACTION_FAILED: ${message}`]);
  }
}

export function defaultRegistry(): ExtractorRegistry {
  const registry = new ExtractorRegistry();
  registry.register(plainTextExtractor);
  registry.register(pdfExtractor);
  registry.register(imageOcrExtractor);
  return registry;
}
