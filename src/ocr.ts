import type { BoundingBox } from "./models/types.ts";

/**
 * Common result of an OCR execution for a single page or image.
 * Follows the SIGMA Core OCR Implementation Plan contract.
 */
export interface OcrPageResult {
  pageNumber: number;
  textContent: string;
  /** Engine-reported confidence in 0..1, when available. Not an accuracy measurement. */
  confidence?: number | undefined;
  /** Language specification actually used by the engine (for example "jpn+eng"). */
  language?: string | undefined;
  boundingBox?: BoundingBox | undefined;
  warnings?: string[] | undefined;
}

export interface OcrResult {
  status: "complete" | "partial" | "failed";
  engineId: string;
  engineVersion: string;
  pages: OcrPageResult[];
  warnings: string[];
}

export interface OcrOptions {
  timeoutMs?: number | undefined;
  language?: string | undefined;
}

export interface OcrEngine {
  readonly id: string;
  readonly version: string;
  isAvailable(): Promise<boolean> | boolean;
  processPage(imageBytes: Uint8Array, pageNumber: number, options?: OcrOptions): Promise<OcrPageResult>;
}

/**
 * Renders one PDF page to PNG bytes. Injected so tests and hosts can supply
 * their own rasterizer instead of the default unpdf/canvas implementation.
 */
export type PdfPageRenderer = (document: unknown, pageNumber: number) => Promise<Uint8Array>;

/**
 * Optional image cleanup applied immediately before OCR. It receives PNG bytes
 * and must return PNG bytes. Preprocessing is opt-in because it can reduce
 * accuracy on some scans; callers should compare it with the original.
 */
export interface ImagePreprocessor {
  readonly id: string;
  readonly version: string;
  process(imageBytes: Uint8Array, pageNumber: number): Promise<Uint8Array>;
}
