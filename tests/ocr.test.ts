import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OcrEngine, OcrPageResult } from "../src/ocr.ts";

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
});
