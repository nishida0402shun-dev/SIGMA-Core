import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { OcrEngine, OcrOptions, OcrPageResult } from "../src/ocr.ts";
import { OcrCancelledError } from "../src/ocr.ts";
import { TesseractCliEngine } from "../src/tesseract-cli-engine.ts";
import { createCanvasImagePreprocessor, preprocessImageForOcr } from "../src/image-preprocessor.ts";
import type { ExtractionProgress } from "../src/extraction.ts";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { extractSource } from "../src/extraction.ts";
import { CoreRepository } from "../src/persistence/core-repository.ts";
import { LocalBlobStore } from "../src/persistence/local-blob-store.ts";
import { AuthService, type AuthContext } from "../src/services/auth-service.ts";
import { BackupService } from "../src/services/backup-service.ts";
import { DeviceQuarantineService } from "../src/services/device-quarantine-service.ts";
import { CoreService } from "../src/services/core-service.ts";
import { SigmaStudioAdapter } from "../src/adapters/sigma-studio-adapter.ts";
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

  it("applies an injected image preprocessor to each rendered PDF page", async () => {
    const blankPdf = makePdf({ pages: [null, null] });
    const preprocessedBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xaa]);
    const preprocessorPages: number[] = [];
    const received: Uint8Array[] = [];
    const engine = mockEngine(async (bytes, pageNumber) => {
      received.push(bytes);
      return { pageNumber, textContent: `OCR page ${pageNumber}` };
    });

    const result = await extractSource(blankPdf, "scanned.pdf", undefined, {
      ocrEngine: engine,
      pdfPageRenderer: async (_document, pageNumber) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, pageNumber]),
      imagePreprocessor: {
        id: "test-preprocessor",
        version: "2.0.0",
        process: async (_bytes, pageNumber) => {
          preprocessorPages.push(pageNumber);
          return preprocessedBytes;
        },
      },
    });

    assert.deepEqual(preprocessorPages, [1, 2]);
    assert.deepEqual(received.map((bytes) => Array.from(bytes)), [
      Array.from(preprocessedBytes),
      Array.from(preprocessedBytes),
    ]);
    assert.equal(result.pages[0]?.ocrPreprocessing, "test-preprocessor@2.0.0");
    assert.equal(result.pages[1]?.ocrPreprocessing, "test-preprocessor@2.0.0");
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
      const engine = mockEngine(async (_bytes, pageNumber, options) => ({
        pageNumber,
        textContent: "OCRで抽出した本文",
        language: options?.language ?? "jpn+eng",
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
        ocrLanguage: "eng",
      });

      const artifact = core.getExtractionArtifacts(auth, object.objectId)[0];
      assert.equal(artifact?.status, "partial");
      assert.equal(artifact?.extractorId, "builtin-pdf+test-ocr-engine");
      assert.ok(artifact?.warnings.some((warning) => warning.includes("PDF_PAGE_OCR_APPLIED")));

      const range = core.getPageRange(auth, object.objectId, 1, 1);
      assert.equal(range.pages[0]?.extractionMethod, "ocr");
      assert.equal(range.pages[0]?.ocrEngineId, "test-ocr-engine");
      assert.equal(range.pages[0]?.ocrEngineVersion, "1.0.0");
      assert.equal(range.pages[0]?.ocrLanguage, "eng");
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

  it("forwards per-file OCR language through the Studio adapter", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sigma-ocr-adapter-"));
    const repo = new CoreRepository(join(tempDir, "core.sqlite"));
    try {
      const auth: AuthContext = { subjectId: "ocr-admin", isSuperAdmin: true };
      let receivedLanguage: string | undefined;
      const engine = mockEngine(async (_bytes, pageNumber, options) => {
        receivedLanguage = options?.language;
        return {
          pageNumber,
          textContent: "adapter OCR text",
          language: options?.language ?? "jpn+eng",
          confidence: 0.9,
        };
      });
      const core = new CoreService(
        repo,
        new LocalBlobStore(join(tempDir, "blobs")),
        new AuthService(repo),
        new BackupService(repo),
        new DeviceQuarantineService(repo),
        engine,
      );
      core.createWorkspace(auth, "adapter-ocr-workspace", "Adapter OCR tests");
      const adapter = new SigmaStudioAdapter(core, repo, auth);

      const added = await adapter.addFiles("adapter-ocr-workspace", [{
        name: "scan.pdf",
        bytes: makePdf({ pages: [null] }),
        ocrLanguage: "eng",
      }]);

      assert.equal(receivedLanguage, "eng");
      const range = core.getPageRange(auth, added[0]!.id, 1, 1);
      assert.equal(range.pages[0]?.ocrLanguage, "eng");
    } finally {
      repo.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
  it("persists preprocessing provenance through the Studio adapter", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sigma-ocr-preprocess-adapter-"));
    const repo = new CoreRepository(join(tempDir, "core.sqlite"));
    try {
      const auth: AuthContext = { subjectId: "ocr-admin", isSuperAdmin: true };
      const engine = mockEngine(async (_bytes, pageNumber) => ({
        pageNumber,
        textContent: "preprocessed adapter text",
        confidence: 0.7,
      }));
      const core = new CoreService(
        repo,
        new LocalBlobStore(join(tempDir, "blobs")),
        new AuthService(repo),
        new BackupService(repo),
        new DeviceQuarantineService(repo),
        engine,
      );
      core.createWorkspace(auth, "adapter-preprocess-workspace", "Adapter preprocessing tests");
      const adapter = new SigmaStudioAdapter(core, repo, auth);

      const added = await adapter.addFiles("adapter-preprocess-workspace", [{
        name: "scan.png",
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
        imagePreprocessor: {
          id: "test-preprocessor",
          version: "1.2.3",
          process: async (bytes) => bytes,
        },
      }]);

      assert.equal(added[0]?.pages[0]?.ocrPreprocessing, "test-preprocessor@1.2.3");
      const page = core.getPage(auth, added[0]!.id, 1);
      assert.equal(page?.location.ocrPreprocessing, "test-preprocessor@1.2.3");
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

  it("applies an injected image preprocessor before OCR", async () => {
    const preprocessedBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x99]);
    let receivedPage: number | undefined;
    const engine = mockEngine(async (bytes, pageNumber) => {
      assert.deepEqual(Array.from(bytes), Array.from(preprocessedBytes));
      receivedPage = pageNumber;
      return { pageNumber, textContent: "preprocessed text", confidence: 0.8 };
    });

    const result = await extractSource(pngBytes, "scan.png", undefined, {
      ocrEngine: engine,
      imagePreprocessor: {
        id: "test-preprocessor",
        version: "1.0.0",
        process: async (_bytes, pageNumber) => {
          assert.equal(pageNumber, 1);
          return preprocessedBytes;
        },
      },
    });

    assert.equal(receivedPage, 1);
    assert.equal(result.status, "partial");
    assert.equal(result.pages[0]?.textContent, "preprocessed text");
    assert.equal(result.pages[0]?.ocrPreprocessing, "test-preprocessor@1.0.0");
  });

  it("fails closed when the image preprocessor throws", async () => {
    let engineCalled = false;
    const engine = mockEngine(async (_bytes, pageNumber) => {
      engineCalled = true;
      return { pageNumber, textContent: "unexpected" };
    });

    const result = await extractSource(pngBytes, "scan.png", undefined, {
      ocrEngine: engine,
      imagePreprocessor: {
        id: "broken-preprocessor",
        version: "1.0.0",
        process: async () => {
          throw new Error("image decode failed");
        },
      },
    });

    assert.equal(engineCalled, false);
    assert.equal(result.status, "failed");
    assert.ok(result.warnings.some((warning) => warning.includes("OCR_PAGE_FAILED")));
    assert.ok(result.warnings.some((warning) => warning.includes("image decode failed")));
  });

  it("upscales a narrow image without turning it into a solid color", async () => {
    const canvas = createCanvas(100, 50);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    context.font = "20px sans-serif";
    context.fillText("OCR", 10, 30);

    const output = await preprocessImageForOcr(new Uint8Array(canvas.toBuffer("image/png")));
    const image = await loadImage(Buffer.from(output));
    assert.ok(image.width >= 1000);

    const check = createCanvas(image.width, image.height);
    const checkContext = check.getContext("2d");
    checkContext.drawImage(image, 0, 0);
    const data = checkContext.getImageData(0, 0, check.width, check.height).data;
    let black = 0;
    let white = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! < 50) black += 1;
      if (data[i]! > 200) white += 1;
    }
    assert.ok(black > 0);
    assert.ok(white > 0);
  });

  it("does not amplify background noise when text is sparse", async () => {
    const canvas = createCanvas(800, 600);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    context.font = "20px sans-serif";
    context.fillText("OCR", 40, 60);

    const noisy = context.getImageData(0, 0, canvas.width, canvas.height);
    let seed = 12345;
    for (let i = 0; i < noisy.data.length; i += 4) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const delta = (seed % 41) - 20;
      for (let channel = 0; channel < 3; channel += 1) {
        noisy.data[i + channel] = Math.max(0, Math.min(255, noisy.data[i + channel]! + delta));
      }
    }
    context.putImageData(noisy, 0, 0);

    const output = await preprocessImageForOcr(
      new Uint8Array(canvas.toBuffer("image/png")),
      { deskew: false, upscale: false, contrast: true },
    );
    const image = await loadImage(Buffer.from(output));
    const check = createCanvas(image.width, image.height);
    const checkContext = check.getContext("2d");
    checkContext.drawImage(image, 0, 0);
    const data = checkContext.getImageData(0, 0, check.width, check.height).data;
    let black = 0;
    const total = check.width * check.height;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! < 50) black += 1;
    }

    assert.ok(black > 0, "text pixels should remain dark");
    assert.ok(black / total < 0.05, "noise must not be stretched into a large black region");
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
      `if [ "$1" = "--version" ]; then echo "tesseract 5.0.0"; exit 0; fi\nprintf 'stub OCR text' > "$2.txt"\nprintf 'level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n5\\t1\\t1\\t1\\t1\\t1\\t0\\t0\\t10\\t10\\t90\\tHello\\n5\\t1\\t1\\t1\\t1\\t2\\t0\\t0\\t10\\t10\\t70\\tworld\\n5\\t1\\t1\\t1\\t1\\t3\\t0\\t0\\t10\\t10\\t100\\t\\n' > "$2.tsv"`,
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

  it("kills the OCR process when its signal aborts", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX shell fixture");
      return;
    }
    const scriptPath = await writeScript(
      `if [ "$1" = "--version" ]; then exit 0; fi\nsleep 5`,
    );
    try {
      const controller = new AbortController();
      const engine = new TesseractCliEngine({ executablePath: scriptPath, defaultTimeoutMs: 10_000 });
      const pending = engine.processPage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 1, {
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 100);
      await assert.rejects(pending, /OCR_CANCELLED/);
    } finally {
      await fs.rm(dirname(scriptPath), { recursive: true, force: true });
    }
  });
});

describe("OCR cancellation and progress", () => {
  it("cancels a scanned PDF after the first page and keeps partial provenance", async () => {
    const controller = new AbortController();
    const processed: number[] = [];
    const engine = mockEngine(async (_bytes, pageNumber) => {
      processed.push(pageNumber);
      controller.abort();
      throw new OcrCancelledError();
    });

    const result = await extractSource(makePdf({ pages: [null, null] }), "scan.pdf", undefined, {
      ocrEngine: engine,
      signal: controller.signal,
      pdfPageRenderer: async (_document, pageNumber) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, pageNumber]),
    });

    assert.equal(result.status, "cancelled");
    assert.deepEqual(processed, [1]);
    assert.equal(result.pageCount, 2);
    assert.ok(result.warnings.some((warning) => warning.includes("OCR_CANCELLED")));
  });

  it("does not call the engine when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    let engineCalled = false;
    const engine = mockEngine(async (_bytes, pageNumber) => {
      engineCalled = true;
      return { pageNumber, textContent: "unexpected" };
    });

    const result = await extractSource(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      "scan.png",
      undefined,
      { ocrEngine: engine, signal: controller.signal },
    );

    assert.equal(result.status, "cancelled");
    assert.equal(engineCalled, false);
    assert.ok(result.warnings.some((warning) => warning.includes("OCR_CANCELLED")));
  });

  it("emits page-level progress for embedded text and OCR pages", async () => {
    const events: ExtractionProgress[] = [];
    const engine = mockEngine(async (_bytes, pageNumber) => ({
      pageNumber,
      textContent: "OCR page text",
    }));

    const result = await extractSource(
      makePdf({ pages: ["Embedded text", null] }),
      "mixed.pdf",
      undefined,
      {
        ocrEngine: engine,
        onProgress: (event) => events.push(event),
        pdfPageRenderer: async (_document, pageNumber) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, pageNumber]),
      },
    );

    assert.equal(result.status, "partial");
    assert.deepEqual(
      events.map((event) => `${event.phase}:${event.pageNumber}:${event.extractionMethod ?? ""}`),
      [
        "page-started:1:",
        "page-completed:1:embedded-text",
        "page-started:2:",
        "page-rendered:2:",
        "ocr-completed:2:ocr",
        "page-completed:2:ocr",
      ],
    );
    assert.ok(events.every((event) => event.pageCount === 2));
  });

  it("records enabled preprocessing settings in provenance", async () => {
    const preprocessor = createCanvasImagePreprocessor({ deskew: false, upscale: true, contrast: true });
    assert.equal(preprocessor.settings, "upscale+contrast");

    const canvas = createCanvas(200, 100);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 200, 100);
    context.fillStyle = "black";
    context.font = "20px sans-serif";
    context.fillText("OCR", 10, 50);

    const engine = mockEngine(async (_bytes, pageNumber) => ({
      pageNumber,
      textContent: "preprocessed text",
    }));
    const result = await extractSource(
      new Uint8Array(canvas.toBuffer("image/png")),
      "scan.png",
      undefined,
      { ocrEngine: engine, imagePreprocessor: preprocessor },
    );

    assert.equal(result.pages[0]?.ocrPreprocessing, "canvas-deskew-contrast@1.1.1+upscale+contrast");
  });
});

describe("OCR quality review, retry, and memory guard", () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  it("flags low-confidence and short text without changing it", async () => {
    const engine = mockEngine(async (_bytes, pageNumber) => ({
      pageNumber,
      textContent: "short",
      confidence: 0.3,
    }));

    const result = await extractSource(pngBytes, "scan.png", undefined, {
      ocrEngine: engine,
      ocrQuality: { minConfidence: 0.6, minCharacters: 10 },
    });

    assert.equal(result.pages[0]?.textContent, "short");
    assert.equal(result.pages[0]?.ocrConfidence, 0.3);
    assert.ok(result.warnings.some((warning) => warning.startsWith("OCR_LOW_CONFIDENCE")));
    assert.ok(result.warnings.some((warning) => warning.startsWith("OCR_TEXT_TOO_SHORT")));
  });

  it("retries once with the fallback preprocessor and keeps the better attempt", async () => {
    const primaryBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01]);
    const fallbackBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x02]);
    const received: number[] = [];
    const engine = mockEngine(async (bytes, pageNumber) => {
      received.push(bytes[bytes.length - 1]!);
      return bytes[bytes.length - 1] === 2
        ? { pageNumber, textContent: "recovered text", confidence: 0.92 }
        : { pageNumber, textContent: "weak text", confidence: 0.2 };
    });

    const result = await extractSource(pngBytes, "scan.png", undefined, {
      ocrEngine: engine,
      imagePreprocessor: {
        id: "primary",
        version: "1.0.0",
        settings: "contrast",
        process: async () => primaryBytes,
      },
      ocrFallbackPreprocessor: {
        id: "fallback",
        version: "1.0.0",
        settings: "upscale",
        process: async () => fallbackBytes,
      },
      ocrQuality: { minConfidence: 0.6 },
    });

    assert.deepEqual(received, [1, 2]);
    assert.equal(result.pages[0]?.textContent, "recovered text");
    assert.equal(result.pages[0]?.ocrConfidence, 0.92);
    assert.equal(result.pages[0]?.ocrPreprocessing, "fallback@1.0.0+upscale");
    assert.ok(result.warnings.some((warning) => warning.startsWith("OCR_RETRY_APPLIED")));
    assert.ok(!result.warnings.some((warning) => warning.startsWith("OCR_LOW_CONFIDENCE")));
  });

  it("does not retry when the first attempt passes", async () => {
    let fallbackCalls = 0;
    const engine = mockEngine(async (_bytes, pageNumber) => ({
      pageNumber,
      textContent: "clear text",
      confidence: 0.95,
    }));

    const result = await extractSource(pngBytes, "scan.png", undefined, {
      ocrEngine: engine,
      ocrFallbackPreprocessor: {
        id: "fallback",
        version: "1.0.0",
        process: async () => {
          fallbackCalls += 1;
          return pngBytes;
        },
      },
      ocrQuality: { minConfidence: 0.6 },
    });

    assert.equal(fallbackCalls, 0);
    assert.equal(result.pages[0]?.textContent, "clear text");
    assert.ok(!result.warnings.some((warning) => warning.startsWith("OCR_RETRY_APPLIED")));
  });

  it("keeps the first attempt when the retry fails", async () => {
    const engine = mockEngine(async (_bytes, pageNumber) => ({
      pageNumber,
      textContent: "first text",
      confidence: 0.2,
    }));

    const result = await extractSource(pngBytes, "scan.png", undefined, {
      ocrEngine: engine,
      ocrFallbackPreprocessor: {
        id: "fallback",
        version: "1.0.0",
        process: async () => {
          throw new Error("decode failed");
        },
      },
      ocrQuality: { minConfidence: 0.6 },
    });

    assert.equal(result.pages[0]?.textContent, "first text");
    assert.ok(result.warnings.some((warning) => warning.startsWith("OCR_RETRY_FAILED")));
    assert.ok(result.warnings.some((warning) => warning.startsWith("OCR_LOW_CONFIDENCE")));
  });

  it("does not start OCR when process RSS exceeds the configured limit", async () => {
    let engineCalled = false;
    const engine = mockEngine(async (_bytes, pageNumber) => {
      engineCalled = true;
      return { pageNumber, textContent: "unexpected" };
    });

    const result = await extractSource(pngBytes, "scan.png", undefined, {
      ocrEngine: engine,
      ocrMemoryLimitMiB: 1,
    });

    assert.equal(engineCalled, false);
    assert.equal(result.status, "failed");
    assert.ok(result.warnings.some((warning) => warning.startsWith("OCR_MEMORY_LIMIT")));
  });

  it("stops PDF OCR at the memory limit and reports remaining pages", async () => {
    const rendered: number[] = [];
    const result = await extractSource(makePdf({ pages: [null, null] }), "scan.pdf", undefined, {
      ocrEngine: mockEngine(async (_bytes, pageNumber) => ({
        pageNumber,
        textContent: "unexpected",
      })),
      ocrMemoryLimitMiB: 1,
      pdfPageRenderer: async (_document, pageNumber) => {
        rendered.push(pageNumber);
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47, pageNumber]);
      },
    });

    assert.deepEqual(rendered, []);
    assert.equal(result.status, "failed");
    assert.ok(result.warnings.some((warning) => warning.startsWith("OCR_MEMORY_LIMIT")));
    assert.ok(result.warnings.some((warning) => warning.includes("process RSS exceeded")));
  });
});

describe("CoreService OCR queueing and deduplication", () => {
  function makeCore(repo: CoreRepository, tempDir: string, engine: OcrEngine): CoreService {
    return new CoreService(
      repo,
      new LocalBlobStore(join(tempDir, "blobs")),
      new AuthService(repo),
      new BackupService(repo),
      new DeviceQuarantineService(repo),
      engine,
    );
  }

  it("extracts identical concurrent uploads once and returns one object", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sigma-ocr-dedup-"));
    const repo = new CoreRepository(join(tempDir, "core.sqlite"));
    try {
      const auth: AuthContext = { subjectId: "ocr-admin", isSuperAdmin: true };
      let calls = 0;
      const engine = mockEngine(async (_bytes, pageNumber) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { pageNumber, textContent: "deduplicated OCR text" };
      });
      const core = makeCore(repo, tempDir, engine);
      core.createWorkspace(auth, "dedup-workspace", "Dedup tests");

      const bytes = makePdf({ pages: [null] });
      const [first, second] = await Promise.all([
        core.registerObject(auth, {
          workspaceId: "dedup-workspace",
          name: "scan.pdf",
          bytes,
          mimeType: "application/pdf",
        }),
        core.registerObject(auth, {
          workspaceId: "dedup-workspace",
          name: "scan-copy.pdf",
          bytes,
          mimeType: "application/pdf",
        }),
      ]);

      assert.equal(calls, 1);
      assert.equal(first.objectId, second.objectId);
      assert.equal(core.listObjects(auth, "dedup-workspace").length, 1);
      assert.equal(core.getOcrQueueStats().completed, 1);
    } finally {
      repo.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("stores nothing when ingestion is cancelled", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sigma-ocr-cancel-"));
    const repo = new CoreRepository(join(tempDir, "core.sqlite"));
    try {
      const auth: AuthContext = { subjectId: "ocr-admin", isSuperAdmin: true };
      const engine = mockEngine(async (_bytes, pageNumber) => ({
        pageNumber,
        textContent: "unexpected",
      }));
      const core = makeCore(repo, tempDir, engine);
      core.createWorkspace(auth, "cancel-workspace", "Cancellation tests");

      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        () => core.registerObject(auth, {
          workspaceId: "cancel-workspace",
          name: "scan.pdf",
          bytes: makePdf({ pages: [null] }),
          mimeType: "application/pdf",
          signal: controller.signal,
        }),
        /OCR_CANCELLED/,
      );

      assert.equal(core.listObjects(auth, "cancel-workspace").length, 0);
      assert.equal(core.getOcrQueueStats().cancelled, 1);
    } finally {
      repo.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("forwards progress through the Studio adapter", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sigma-ocr-progress-"));
    const repo = new CoreRepository(join(tempDir, "core.sqlite"));
    try {
      const auth: AuthContext = { subjectId: "ocr-admin", isSuperAdmin: true };
      const engine = mockEngine(async (_bytes, pageNumber) => ({
        pageNumber,
        textContent: "progress text",
      }));
      const core = makeCore(repo, tempDir, engine);
      core.createWorkspace(auth, "progress-workspace", "Progress tests");
      const adapter = new SigmaStudioAdapter(core, repo, auth);

      const events: ExtractionProgress[] = [];
      await adapter.addFiles("progress-workspace", [{
        name: "scan.pdf",
        bytes: makePdf({ pages: [null] }),
        onProgress: (event) => events.push(event),
      }]);

      assert.ok(events.some((event) => event.phase === "page-started" && event.pageNumber === 1));
      assert.ok(events.some((event) => event.phase === "ocr-completed" && event.extractionMethod === "ocr"));
      assert.ok(events.some((event) => event.phase === "page-completed" && event.pageNumber === 1));
    } finally {
      repo.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("persists OCR quality review warnings through the Studio adapter", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sigma-ocr-quality-"));
    const repo = new CoreRepository(join(tempDir, "core.sqlite"));
    try {
      const auth: AuthContext = { subjectId: "ocr-admin", isSuperAdmin: true };
      const engine = mockEngine(async (_bytes, pageNumber) => ({
        pageNumber,
        textContent: "low confidence text",
        confidence: 0.2,
      }));
      const core = makeCore(repo, tempDir, engine);
      core.createWorkspace(auth, "quality-workspace", "Quality tests");
      const adapter = new SigmaStudioAdapter(core, repo, auth);

      await adapter.addFiles("quality-workspace", [{
        name: "scan.pdf",
        bytes: makePdf({ pages: [null] }),
        ocrQuality: { minConfidence: 0.6 },
      }]);

      const object = core.listObjects(auth, "quality-workspace")[0]!;
      const artifact = core.getExtractionArtifacts(auth, object.objectId)[0];
      assert.ok(artifact?.warnings.some((warning) => warning.startsWith("OCR_LOW_CONFIDENCE")));
      const page = core.getPage(auth, object.objectId, 1);
      assert.ok(page?.location.warnings?.some((warning) => warning.startsWith("OCR_LOW_CONFIDENCE")));
    } finally {
      repo.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
