import { createHash } from "node:crypto";

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

export interface TextExtraction {
  status: "complete" | "partial" | "failed";
  text?: string;
  warnings: string[];
  source: SourceRecord;
}

export interface Extractor {
  readonly format: Format;
  extract(bytes: Uint8Array, source: SourceRecord): TextExtraction;
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
  return {
    sourceId: createHash("sha256").update(snapshot).digest("hex"),
    sha256: createHash("sha256").update(snapshot).digest("hex"),
    byteLength: snapshot.byteLength,
    detected: detectFormat(snapshot, filename),
  };
}

export const plainTextExtractor: Extractor = {
  format: "plain-text",
  extract(bytes, source) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { status: "complete", text, warnings: [], source };
    } catch {
      return {
        status: "failed",
        warnings: ["Input is not valid UTF-8; no text was extracted."],
        source,
      };
    }
  },
};

/** Registry intentionally contains only the extractor whose behavior is implemented and tested. */
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

export function extractSource(
  bytes: Uint8Array,
  filename = "",
  registry: ExtractorRegistry = defaultRegistry(),
): TextExtraction {
  const snapshot = Buffer.from(bytes);
  const source = createSourceRecord(snapshot, filename);
  const extractor = registry.get(source.detected.format);
  if (!extractor) {
    return {
      status: "failed",
      warnings: [`No extractor registered for detected format: ${source.detected.format}`],
      source,
    };
  }
  return extractor.extract(snapshot, source);
}

export function defaultRegistry(): ExtractorRegistry {
  const registry = new ExtractorRegistry();
  registry.register(plainTextExtractor);
  return registry;
}

// Re-export Data Model Types
export * from "./models/types.ts";

// Re-export SQLite Driver & Repositories
export * from "./db/sqlite-driver.ts";
export * from "./persistence/core-repository.ts";
export * from "./persistence/local-blob-store.ts";
export * from "./persistence/sqlite-repository.ts";

// Re-export Services
export * from "./services/auth-service.ts";
export * from "./services/backup-service.ts";
export * from "./services/device-quarantine-service.ts";
export * from "./services/core-service.ts";

// Re-export Adapters
export * from "./adapters/sigma-studio-adapter.ts";
export * from "./mcp/core-mcp-adapter.ts";
export * from "./mcp/stdio-server.ts";

