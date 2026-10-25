import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OcrEngine, OcrPageResult } from "../src/ocr.ts";
import { TesseractCliEngine } from "../src/tesseract-cli-engine.ts";

describe("OCR engine contract", () => {
  it("declares standard engine contract and page result structures", async () => {
    const mockEngine: OcrEngine = {
      id: "mock-ocr",
      version: "1.0.0",
      isAvailable: async () => true,
      processPage: async (_bytes: Uint8Array, pageNumber: number): Promise<OcrPageResult> => ({
        pageNumber,
        textContent: "サンプルテキスト",
        confidence: 0.95,
        boundingBox: { x: 0, y: 0, width: 100, height: 50 },
      }),
    };

    assert.equal(mockEngine.id, "mock-ocr");
    assert.equal(mockEngine.version, "1.0.0");
    assert.equal(await mockEngine.isAvailable(), true);

    const result = await mockEngine.processPage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 1);
    assert.equal(result.pageNumber, 1);
    assert.equal(result.textContent, "サンプルテキスト");
    assert.equal(result.confidence, 0.95);
    assert.deepEqual(result.boundingBox, { x: 0, y: 0, width: 100, height: 50 });
  });

  it("handles unavailable engine state gracefully", async () => {
    const unavailableEngine: OcrEngine = {
      id: "tesseract-cli",
      version: "5.0.0",
      isAvailable: () => false,
      processPage: async () => {
        throw new Error("OCR_ENGINE_UNAVAILABLE: Tesseract is not installed or not found on PATH");
      },
    };

    assert.equal(await unavailableEngine.isAvailable(), false);
    await assert.rejects(
      () => unavailableEngine.processPage(new Uint8Array([]), 1),
      /OCR_ENGINE_UNAVAILABLE/,
    );
  });

  it("TesseractCliEngine gracefully fails when executable does not exist", async () => {
    const engine = new TesseractCliEngine({ executablePath: "non-existent-tesseract-bin" });
    assert.equal(engine.isAvailable(), false);
    await assert.rejects(
      () => engine.processPage(new Uint8Array([1, 2, 3]), 1),
      /OCR_ENGINE_UNAVAILABLE/,
    );
  });

  it("extractSource falls back to OCR engine when PDF has no extractable text", async () => {
    const { extractSource } = await import("../src/extraction.ts");
    const { makePdf } = await import("./pdf-fixture.ts");

    const blankPdf = makePdf({ pages: [null, null] });
    const mockOcrEngine: OcrEngine = {
      id: "test-ocr-engine",
      version: "1.0.0",
      isAvailable: () => true,
      processPage: async (_bytes, pageNumber) => ({
        pageNumber,
        textContent: `OCR抽出されたページ ${pageNumber}`,
      }),
    };

    const result = await extractSource(blankPdf, "scanned-sample.pdf", undefined, {
      ocrEngine: mockOcrEngine,
    });

    assert.equal(result.status, "complete");
    assert.equal(result.extractorId, "builtin-pdf+test-ocr-engine");
    assert.equal(result.pageCount, 2);
    assert.equal(result.pages.length, 2);
    assert.equal(result.pages[0]?.textContent, "OCR抽出されたページ 1");
    assert.equal(result.pages[1]?.textContent, "OCR抽出されたページ 2");
    assert.ok(result.text?.includes("OCR抽出されたページ 1"));
    assert.ok(result.text?.includes("OCR抽出されたページ 2"));
  });
});
