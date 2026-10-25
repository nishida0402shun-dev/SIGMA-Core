import type { PdfPageRenderer } from "./ocr.ts";

/** Bounds canvas memory on low-RAM machines; 16 MP is roughly a 4000x4000 page at 1x. */
export const MAX_PDF_RENDER_PIXELS = 16_000_000;
const TARGET_SCALE = 2;

/**
 * Default PDF page rasterizer. Reuses the PDF document already opened by the
 * extractor and renders one page at a time so pages are never all in memory.
 */
export const unpdfPageRenderer: PdfPageRenderer = async (document, pageNumber) => {
  const unpdf = await import("unpdf");
  const pdf = document as Awaited<ReturnType<typeof unpdf.getDocumentProxy>>;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(TARGET_SCALE, Math.sqrt(MAX_PDF_RENDER_PIXELS / (viewport.width * viewport.height)));
  const image = await unpdf.renderPageAsImage(pdf, pageNumber, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale,
  });
  return new Uint8Array(image);
};
