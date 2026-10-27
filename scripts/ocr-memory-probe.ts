/**
 * Long-document OCR memory probe.
 *
 * Generates an image-only PDF (JPEG page reused across pages), runs the real
 * PDF extractor + Tesseract CLI engine, and samples process RSS while pages are
 * rendered and OCR'd one at a time.
 *
 * Usage:
 *   node --experimental-strip-types scripts/ocr-memory-probe.ts --write
 *   node --experimental-strip-types scripts/ocr-memory-probe.ts --pages 30 --dpi 200 --write
 *   node --experimental-strip-types scripts/ocr-memory-probe.ts --pages 12 --preprocess
 *
 * This measures this machine and this Node build. It is not a claim about
 * low-RAM target hardware.
 */
import { createCanvas } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { extractSource, type ExtractionProgress } from "../src/extraction.ts";
import { unpdfPageRenderer } from "../src/pdf-page-renderer.ts";
import { TesseractCliEngine } from "../src/tesseract-cli-engine.ts";
import { createCanvasImagePreprocessor } from "../src/image-preprocessor.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const resultsDir = resolve(repoRoot, "benchmarks/ocr/results");
const SAMPLE_INTERVAL_MS = 100;

interface MemorySample {
  atMs: number;
  rssMb: number;
  heapUsedMb: number;
  externalMb: number;
  pageNumber?: number | undefined;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function intArg(name: string, fallback: number): number {
  const value = argValue(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`ARGUMENT_INVALID: ${name} expects a positive integer`);
  }
  return parsed;
}

function rssMb(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

function heapUsedMb(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

function externalMb(): number {
  return process.memoryUsage().external / (1024 * 1024);
}

const forceGc = (globalThis as { gc?: () => void }).gc;

function collectGarbage(): void {
  forceGc?.();
}

/** Builds a PDF whose pages each paint one shared JPEG image. */
function makeScannedPdf(jpeg: Buffer, imageWidth: number, imageHeight: number, pages: number): Buffer {
  const pdfWidth = 612;
  const pdfHeight = 792;
  const pageIds = Array.from({ length: pages }, (_, index) => 3 + index);
  const imageId = 3 + pages;
  const contentStart = imageId + 1;
  const objects: Array<Buffer | undefined> = [];

  objects[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1");
  objects[2] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`,
    "latin1",
  );
  pageIds.forEach((pageId, index) => {
    const contentId = contentStart + index;
    objects[pageId] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfWidth} ${pdfHeight}] ` +
      `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      "latin1",
    );
    const content = `q ${pdfWidth} 0 0 ${pdfHeight} 0 0 cm /Im0 Do Q`;
    objects[contentId] = Buffer.concat([
      Buffer.from(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n`, "latin1"),
      Buffer.from(content, "latin1"),
      Buffer.from("\nendstream", "latin1"),
    ]);
  });
  objects[imageId] = Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      "latin1",
    ),
    jpeg,
    Buffer.from("\nendstream", "latin1"),
  ]);

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  let offset = parts[0]!.length;
  const offsets: number[] = [];
  for (let index = 1; index < objects.length; index += 1) {
    const object = objects[index];
    if (!object) throw new Error(`Missing PDF object ${index}`);
    offsets[index] = offset;
    const header = Buffer.from(`${index} 0 obj\n`, "latin1");
    const footer = Buffer.from("\nendobj\n", "latin1");
    parts.push(header, object, footer);
    offset += header.length + object.length + footer.length;
  }
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

function scannedJpeg(dpi: number): { jpeg: Buffer; width: number; height: number } {
  const width = Math.round((8.5 * dpi));
  const height = Math.round((11 * dpi));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "black";
  context.font = `${Math.max(24, Math.round(width / 32))}px sans-serif`;
  const lines = [
    "SIGMA Core long document memory probe",
    "This page is rasterized and OCR'd one page at a time.",
    "The extractor must not retain previous page images.",
    "Page body line four with numbers 12345 and 67890.",
    "Page body line five for layout and memory sampling.",
  ];
  lines.forEach((line, index) => {
    context.fillText(line, Math.round(width * 0.06), Math.round(height * 0.08) + index * Math.round(height * 0.045));
  });
  const jpeg = canvas.toBuffer("image/jpeg", 0.85);
  return { jpeg, width, height };
}

function markdown(output: {
  generatedAt: string;
  environment: Record<string, string | number>;
  pages: number;
  ocrPages: number;
  status: string;
  preprocess: string;
  durationMs: number;
  perPageMs: number;
  baselineRssMb: number;
  peakRssMb: number;
  finalRssMb: number;
  peakHeapUsedMb: number;
  peakExternalMb: number;
  gcForced: boolean;
  samples: MemorySample[];
  warnings: string[];
}): string {
  const retainedMb = output.finalRssMb - output.baselineRssMb;
  return [
    "# OCR long-document memory probe",
    "",
    `- Generated: ${output.generatedAt}`,
    `- Dataset: ${output.pages} rasterized pages (${output.ocrPages} OCR'd)`,
    `- Preprocessing: ${output.preprocess}`,
    `- Status: ${output.status}`,
    `- Platform: ${output.environment.platform} ${output.environment.arch}`,
    `- Node.js: ${output.environment.node}`,
    `- Tesseract: ${output.environment.tesseract}`,
    `- Language: ${output.environment.language}`,
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Duration | ${(output.durationMs / 1000).toFixed(1)} s |`,
    `| Per page | ${output.perPageMs.toFixed(0)} ms |`,
    `| Baseline RSS | ${output.baselineRssMb.toFixed(1)} MiB |`,
    `| Peak RSS | ${output.peakRssMb.toFixed(1)} MiB |`,
    `| Final RSS | ${output.finalRssMb.toFixed(1)} MiB |`,
    `| RSS change (final - baseline) | ${retainedMb.toFixed(1)} MiB |`,
    `| Peak heap used | ${output.peakHeapUsedMb.toFixed(1)} MiB |`,
    `| Peak external | ${output.peakExternalMb.toFixed(1)} MiB |`,
    `| Forced GC | ${output.gcForced ? "yes" : "no"} |`,
    `| Samples | ${output.samples.length} every ${SAMPLE_INTERVAL_MS} ms |`,
    "",
    ...(output.warnings.length > 0
      ? ["## Warnings", "", ...output.warnings.map((warning) => `- ${warning}`), ""]
      : []),
    "RSS is sampled from this Node process. Native canvas and child-process memory may not be fully attributed; run with `--expose-gc` and a larger page count on target hardware for production sizing.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const pages = intArg("--pages", 12);
  const dpi = intArg("--dpi", 150);
  const language = argValue("--language") ?? "eng";
  const preprocess = process.argv.includes("--preprocess");
  const write = process.argv.includes("--write");
  const engine = new TesseractCliEngine();
  if (!engine.isAvailable()) {
    throw new Error("Tesseract is not available; install it or set TESSERACT_PATH before running the probe");
  }

  const { jpeg, width, height } = scannedJpeg(dpi);
  const pdfBytes = makeScannedPdf(jpeg, width, height, pages);
  const preprocessor = preprocess ? createCanvasImagePreprocessor() : undefined;

  const samples: MemorySample[] = [];
  const warnings: string[] = [];
  const started = performance.now();
  collectGarbage();
  const baselineRssMb = rssMb();

  let timer: NodeJS.Timeout | undefined;
  const sample = (pageNumber?: number): void => {
    samples.push({
      atMs: performance.now() - started,
      rssMb: rssMb(),
      heapUsedMb: heapUsedMb(),
      externalMb: externalMb(),
      pageNumber,
    });
  };
  timer = setInterval(() => sample(), SAMPLE_INTERVAL_MS);
  timer.unref();

  let result;
  try {
    result = await extractSource(pdfBytes, "memory-probe.pdf", undefined, {
      ocrEngine: engine,
      ocrLanguage: language,
      pdfPageRenderer: unpdfPageRenderer,
      ...(preprocessor ? { imagePreprocessor: preprocessor } : {}),
      onProgress: (progress: ExtractionProgress) => {
        if (progress.phase === "page-completed" || progress.phase === "page-failed") {
          sample(progress.pageNumber);
        }
        if (progress.phase === "page-failed" && progress.message) {
          warnings.push(`page ${progress.pageNumber}: ${progress.message}`);
        }
      },
    });
  } finally {
    if (timer) clearInterval(timer);
    collectGarbage();
    sample();
  }
  const durationMs = performance.now() - started;

  const ocrPages = result.pages.filter((page) => page.extractionMethod === "ocr").length;
  const peakRss = Math.max(...samples.map((item) => item.rssMb), baselineRssMb);
  const output = {
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      tesseract: engine.version,
      language,
    },
    pages,
    ocrPages,
    status: result.status,
    preprocess: preprocessor ? `${preprocessor.id}@${preprocessor.version}+${preprocessor.settings}` : "none",
    durationMs,
    perPageMs: durationMs / Math.max(1, ocrPages),
    baselineRssMb,
    peakRssMb: peakRss,
    finalRssMb: rssMb(),
    peakHeapUsedMb: Math.max(...samples.map((item) => item.heapUsedMb)),
    peakExternalMb: Math.max(...samples.map((item) => item.externalMb)),
    gcForced: Boolean(forceGc),
    samples,
    warnings: [...new Set([...warnings, ...result.warnings])],
  };

  console.log(markdown(output));
  if (write) {
    await mkdir(resultsDir, { recursive: true });
    await writeFile(resolve(resultsDir, "memory-latest.json"), `${JSON.stringify(output, null, 2)}\n`);
    await writeFile(resolve(resultsDir, "memory-latest.md"), markdown(output));
    console.log(`Wrote ${resolve(resultsDir, "memory-latest.json")} and memory-latest.md`);
  }
}

await main();
