import type { BoundingBox } from "./models/types.ts";

/**
 * Common result of an OCR execution for a single page or image.
 * Follows the SIGMA Core OCR Implementation Plan contract.
 */
export interface OcrPageResult {
  pageNumber: number;
  textContent: string;
  confidence?: number | undefined;
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
