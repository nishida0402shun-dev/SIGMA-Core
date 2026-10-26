import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { OcrEngine, OcrOptions, OcrPageResult } from "../src/ocr.ts";
import { TesseractCliEngine } from "../src/tesseract-cli-engine.ts";
import { extractSource } from "../src/extraction.ts";
import { CoreRepository } from "../src/persistence/core-repository.ts";
import { LocalBlobStore } from "../src/persistence/local-blob-store.ts";
import { AuthService, type AuthContext } from "../src/services/auth-service.ts";
import { BackupService } from "../src/services/backup-service.ts";
import { DeviceQuarantineService } from "../src/services/device-quarantine-service.ts";
import { CoreService } from "../src/services/core-service.ts";
import { makePdf } from "./pdf-fixture.ts";

function mockEngine(
  processPage: (bytes: Uint8Array, pageNumber: number, options?: OcrOptions) => Promise<OcrPageResult>,
  available = true,
): OcrEngine {
  return {
    id: "test-ocr-engine",
    version: "1.0.0",
    isAvailable: () => available,
    processPage,
  };
}

describe("OCR engine contract", () => {
  it("declares standard engine contract and page result structures", async () => {
    const engine = mockEngine(async (_bytes, pageNumber) => ({
      pageNumber,
      textContent: "サンプルテキスト",
      confidence: 0.95,
      boundingBox: { x: 0, y: 0, width: 100, height: 50 },
    }));

    assert.equal(engine.id, "test-ocr-engine");
    assert.equal(engine.version, "1.0.0");
    assert.equal(await engine.isAvailable(), true);

    const result = await engine.processPage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 1);
    assert.equal(result.pageNumber, 1);
    assert.equal(result.textContent, "サンプルテキスト");
    assert.equal(result.confidence, 0.95);
    assert.deepEqual(result.boundingBox, { x: 0, y: 0, width: 100, height: 50 });
  });

  it("TesseractCliEngine gracefully fails when executable does not exist", async () => {
    const engine = new TesseractCliEngine({ executablePath: "non-existent-tesseract-bin" });
    assert.equal(engine.isAvailable(), false);
    await assert.rejects(
      () => engine.processPage(new Uint8Array([1, 2, 3]), 1),
      /OCR_ENGINE_UNAVAILABLE/,
    );
  });
});

describe("scanned PDF OCR routing", () => {
  it("renders and OCRs every page when the PDF has no text", async () => {
    const blankPdf = makePdf({ pages: [null, null] });
    const rendered: number[] = [];
    const processed: number[] = [];
    const engine = mockEngine(async (_bytes, pageNumber) => {
      processed.push(pageNumber);
      return { pageNumber, textContent: `OCR抽出されたページ ${pageNumber}` };
    });

    const result = await extractSource(blankPdf, "scanned-sample.pdf", undefined, {
      ocrEngine: engine,
      pdfPageRenderer: async (_document, pageNumber) => {
        rendered.push(pageNumber);
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      },
    });

    assert.deepEqual(rendered, [1, 2]);
    assert.deepEqual(processed, [1, 2]);
    assert.equal(result.status, "partial");
    assert.equal(result.extractorId, "builtin-pdf+test-ocr-engine");
    assert.equal(result.extractorVersion, "1.0.0+1.0.0");
    assert.equal(result.pageCount, 2);
    assert.equal(result.pages[0]?.textContent, "OCR抽出されたページ 1");
    assert.equal(result.pages[1]?.textContent, "OCR抽出されたページ 2");
    assert.ok(result.warnings.some((warning) => warning.includes("PDF_PAGE_OCR_APPLIED")));
    assert.ok(result.text?.includes("OCR抽出されたページ 2"));
  });

  it("OCR only pages without embedded text in a mixed PDF", async () => {
    const mixedPdf = makePdf({ pages: ["Embedded page text", null] });
    const rendered: number[] = [];
    const processed: number[] = [];
    let receivedLanguage: string | undefined;
    const engine = mockEngine(async (_bytes, pageNumber, options) => {
      processed.push(pageNumber);
      receivedLanguage = options?.language;
      return {
        pageNumber,
        textContent: "OCR page text",
        language: options?.language ?? "jpn+eng",
        confidence: 0.9,
      };
    });

    const result = await extractSource(mixedPdf, "mixed.pdf", undefined, {
      ocrEngine: engine,
      ocrLanguage: "eng",
      pdfPageRenderer: async (_document, pageNumber) => {
        rendered.push(pageNumber);
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      },
    });

    assert.deepEqual(rendered, [2]);
    assert.deepEqual(processed, [2]);
    assert.equal(receivedLanguage, "eng");
    assert.equal(result.pages[0]?.textContent, "Embedded page text");
    assert.equal(result.pages[0]?.extractionMethod, "embedded-text");
    assert.equal(result.pages[1]?.textContent, "OCR page text");
    assert.equal(result.pages[1]?.extractionMethod, "ocr");
    assert.equal(result.pages[1]?.ocrEngineId, "test-ocr-engine");
    assert.equal(result.pages[1]?.ocrEngineVersion, "1.0.0");
    assert.equal(result.pages[1]?.ocrLanguage, "eng");
    assert.equal(result.pages[1]?.ocrConfidence, 0.9);
    assert.equal(result.status, "partial");
    assert.equal(result.extractorId, "builtin-pdf+test-ocr-engine");
  });

  it("fails closed and reports the render error when rasterization fails", async () => {
    const blankPdf = makePdf({ pages: [null] });
    let engineCalled = false;
    const engine = mockEngine(async (_bytes, pageNumber) => {
      engineCalled = true;
      return { pageNumber, textContent: "unexpected" };
    });

    const result = await extractSource(blankPdf, "scanned.pdf", undefined, {
      ocrEngine: engine,
      pdfPageRenderer: async () => {
        throw new Error("canvas unavailable");
      },
    });

    assert.equal(engineCalled, false);
    assert.equal(result.status, "failed");
    assert.equal(result.pages.length, 0);
    assert.ok(result.warnings.some((warning) => warning.includes("OCR_RENDER_FAILED")));
    assert.ok(result.warnings.some((warning) => warning.includes("PDF_TEXT_UNAVAILABLE_OCR_REQUIRED")));
  });

  it("does not render when the OCR engine is unavailable", async () => {
    const blankPdf = makePdf({ pages: [null] });
    let renderCalled = false;
    const engine = mockEngine(async (_bytes, pageNumber) => ({ pageNumber, textContent: "text" }), false);

    const result = await extractSource(blankPdf, "scanned.pdf", undefined, {
      ocrEngine: engine,
      pdfPageRenderer: async () => {
        renderCalled = true;
        return new Uint8Array();
      },
    });

    assert.equal(renderCalled, false);
    assert.equal(result.status, "failed");
    assert.ok(result.warnings.some((warning) => warning.includes("OCR engine is unavailable")));
    assert.ok(result.warnings.some((warning) => warning.includes("PDF_TEXT_UNAVAILABLE_OCR_REQUIRED")));
  });

  it("renders a real PDF page to PNG with the default renderer", async (t) => {    try {
      await import("@napi-rs/canvas");
    } catch {
      t.skip("@napi-rs/canvas is not installed");
      return;
    }

    const blankPdf = makePdf({ pages: [null] });
    let pngBytes: Uint8Array | undefined;
    const engine = mockEngine(async (bytes, pageNumber) => {
      pngBytes = bytes;
      return { pageNumber, textContent: "rendered page" };
    });

    const result = await extractSource(blankPdf, "scanned.pdf", undefined, { ocrEngine: engine });

    assert.equal(result.status, "partial");
    assert.equal(result.pages[0]?.textContent, "rendered page");
    assert.ok(pngBytes && pngBytes.byteLength > 0);
    assert.deepEqual(Array.from(pngBytes!.subarray(0, 4)), [0x89, 0x50, 0x4e, 0x47]);
  });

  it("stores OCR text as searchable page provenance through CoreService", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sigma-ocr-core-"));
    const repo = new CoreRepository(join(tempDir, "core.sqlite"));
    try {
      const auth: AuthContext = { subjectId: "ocr-admin", isSuperAdmin: true };
      const engine = mockEngine(async (_bytes, pageNumber) => ({
        pageNumber,
        textContent: "OCRで抽出した本文",
        language: "jpn+eng",
        confidence: 0.88,
      }));
      const core = new CoreService(
        repo,
        new LocalBlobStore(join(tempDir, "blobs")),
        new AuthService(repo),
        new BackupService(repo),
        new DeviceQuarantineService(repo),
        engine,
      );
      core.createWorkspace(auth, "ocr-workspace", "OCR tests");

      const object = await core.registerObject(auth, {
        workspaceId: "ocr-workspace",
        name: "scan.pdf",
        bytes: makePdf({ pages: [null] }),
        mimeType: "application/pdf",
      });

      const artifact = core.getExtractionArtifacts(auth, object.objectId)[0];
      assert.equal(artifact?.status, "partial");
      assert.equal(artifact?.extractorId, "builtin-pdf+test-ocr-engine");
      assert.ok(artifact?.warnings.some((warning) => warning.includes("PDF_PAGE_OCR_APPLIED")));

      const range = core.getPageRange(auth, object.objectId, 1, 1);
      assert.equal(range.pages[0]?.extractionMethod, "ocr");
      assert.equal(range.pages[0]?.ocrEngineId, "test-ocr-engine");
      assert.equal(range.pages[0]?.ocrEngineVersion, "1.0.0");
      assert.equal(range.pages[0]?.ocrLanguage, "jpn+eng");
      assert.equal(range.pages[0]?.ocrConfidence, 0.88);
      assert.ok(range.pages[0]?.warnings?.some((warning) => warning.includes("PDF_PAGE_OCR_APPLIED")));

      const page = core.getPage(auth, object.objectId, 1);
      assert.equal(page?.location.extractionMethod, "ocr");

      const hits = core.search(auth, { scopeId: "ocr-workspace", query: "OCRで抽出した本文" });
      assert.ok(hits.some((hit) => hit.objectId === object.objectId && hit.pageNumber === 1));
    } finally {
      repo.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("standalone image OCR", () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  it("OCRs a PNG and records page provenance", async () => {
    let receivedLanguage: string | undefined;
    const engine = mockEngine(async (bytes, pageNumber, options) => {
      assert.deepEqual(Array.from(bytes), Array.from(pngBytes));
      receivedLanguage = options?.language;
      return {
        pageNumber,
        textContent: "画像の本文\n",
        language: options?.language ?? "jpn+eng",
        confidence: 0.75,
        boundingBox: { x: 1, y: 2, width: 30, height: 40 },
      };
    });

    const result = await extractSource(pngBytes, "scan.png", undefined, {
      ocrEngine: engine,
      ocrLanguage: "eng",
    });

    assert.equal(receivedLanguage, "eng");
    assert.equal(result.status, "partial");
    assert.equal(result.text, "画像の本文");
    assert.equal(result.pageCount, 1);
    assert.equal(result.extractorId, "builtin-image-ocr+test-ocr-engine");
    assert.equal(result.extractorVersion, "1.0.0+1.0.0");
    assert.equal(result.pages[0]?.textContent, "画像の本文");
    assert.equal(result.pages[0]?.extractionMethod, "ocr");
    assert.equal(result.pages[0]?.ocrEngineId, "test-ocr-engine");
    assert.equal(result.pages[0]?.ocrEngineVersion, "1.0.0");
    assert.equal(result.pages[0]?.ocrLanguage, "eng");
    assert.equal(result.pages[0]?.ocrConfidence, 0.75);
    assert.deepEqual(result.pages[0]?.boundingBox, { x: 1, y: 2, width: 30, height: 40 });
    assert.ok(result.warnings.some((warning) => warning.includes("IMAGE_OCR_APPLIED")));
  });

  it("fails closed when no OCR engine is available", async () => {
    const result = await extractSource(pngBytes, "scan.png");
    assert.equal(result.status, "failed");
    assert.equal(result.pages.length, 0);
    assert.ok(result.warnings[0]?.includes("OCR_ENGINE_UNAVAILABLE"));
  });

  it("fails closed when OCR produces no text", async () => {
    const engine = mockEngine(async (_bytes, pageNumber) => ({
      pageNumber,
      textContent: "   ",
    }));
    const result = await extractSource(pngBytes, "scan.png", undefined, { ocrEngine: engine });
    assert.equal(result.status, "failed");
    assert.equal(result.pages.length, 0);
    assert.ok(result.warnings[0]?.includes("OCR_PAGE_TEXT_UNAVAILABLE"));
  });

  it("fails closed when OCR execution fails or times out", async () => {
    const failing = mockEngine(async () => {
      throw new Error("engine crashed");
    });
    const failed = await extractSource(pngBytes, "scan.png", undefined, { ocrEngine: failing });
    assert.equal(failed.status, "failed");
    assert.ok(failed.warnings[0]?.includes("OCR_PAGE_FAILED"));

    const hanging = mockEngine(() => new Promise<OcrPageResult>(() => undefined));
    const timedOut = await extractSource(pngBytes, "scan.png", undefined, {
      ocrEngine: hanging,
      limits: { timeoutMs: 5 },
    });
    assert.equal(timedOut.status, "failed");
    assert.ok(timedOut.warnings[0]?.includes("OCR_TIMEOUT"));
  });
});

describe("Tesseract CLI execution", () => {
  async function writeScript(body: string): Promise<string> {
    const dir = await fs.mkdtemp(join(tmpdir(), "sigma-ocr-test-"));
    const scriptPath = join(dir, "fake-tesseract.sh");
    await fs.writeFile(scriptPath, `#!/bin/sh\n${body}\n`, "utf8");
    await fs.chmod(scriptPath, 0o755);
    return scriptPath;
  }

  it("passes arguments safely and reads the output file", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX shell fixture");
      return;
    }
    const scriptPath = await writeScript(
      `if [ "$1" = "--version" ]; then echo "tesseract 5.0.0"; exit 0; fi\nprintf 'stub OCR text' > "$2.txt"\nprintf 'level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n5\\t1\\t1\\t1\\t1\\t1\\t0\\t0\\t10\\t10\\t90\\tHello\\n5\\t1\\t1\\t1\\t1\\t2\\t0\\t0\\t10\\t10\\t70\\tworld\\n' > "$2.tsv"`,
    );
    try {
      const engine = new TesseractCliEngine({ executablePath: scriptPath });
      assert.equal(engine.isAvailable(), true);
      assert.equal(engine.version, "5.0.0");
      const result = await engine.processPage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 3);
      assert.equal(result.pageNumber, 3);
      assert.equal(result.textContent, "stub OCR text");
      assert.equal(result.language, "jpn+eng");
      assert.equal(result.confidence, 0.8);

      const english = await engine.processPage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 3, {
        language: "eng",
      });
      assert.equal(english.language, "eng");

      const defaulted = new TesseractCliEngine({ executablePath: scriptPath, defaultLanguage: "eng" });
      const defaultedResult = await defaulted.processPage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 1);
      assert.equal(defaultedResult.language, "eng");
    } finally {
      await fs.rm(dirname(scriptPath), { recursive: true, force: true });
    }
  });

  it("reports a timeout instead of hanging the Core process", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX shell fixture");
      return;
    }
    const scriptPath = await writeScript(
      `if [ "$1" = "--version" ]; then exit 0; fi\nsleep 5`,
    );
    try {
      const engine = new TesseractCliEngine({ executablePath: scriptPath, defaultTimeoutMs: 200 });
      await assert.rejects(
        () => engine.processPage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 1),
        /OCR_TIMEOUT/,
      );
    } finally {
      await fs.rm(dirname(scriptPath), { recursive: true, force: true });
    }
  });

  it("rejects an invalid language argument without spawning", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX shell fixture");
      return;
    }
    const scriptPath = await writeScript(
      `if [ "$1" = "--version" ]; then exit 0; fi\nprintf 'text' > "$2.txt"`,
    );
    try {
      const engine = new TesseractCliEngine({ executablePath: scriptPath });
      await assert.rejects(
        () => engine.processPage(new Uint8Array([1]), 1, { language: "--user-whitelist" }),
        /OCR_INVALID_LANGUAGE/,
      );
    } finally {
      await fs.rm(dirname(scriptPath), { recursive: true, force: true });
    }
  });
});
