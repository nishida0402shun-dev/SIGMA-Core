/**
 * OCR regression benchmark for synthetic and caller-supplied cases.
 *
 * Usage:
 *   node --experimental-strip-types scripts/ocr-benchmark.ts
 *   node --experimental-strip-types scripts/ocr-benchmark.ts --write
 *   node --experimental-strip-types scripts/ocr-benchmark.ts --manifest path/to/cases.json
 *
 * The checked-in manifest is synthetic. It is a regression signal, not a
 * substitute for representative scans or target-hardware validation.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { extractSource } from "../src/extraction.ts";
import { unpdfPageRenderer } from "../src/pdf-page-renderer.ts";
import { TesseractCliEngine } from "../src/tesseract-cli-engine.ts";
import { canvasImagePreprocessor } from "../src/image-preprocessor.ts";

type Variant = "clean" | "low-res" | "rotate-2" | "blur-1" | "noise" | "low-contrast";

interface BaseCase {
  id: string;
  variant: Variant;
  language: string;
  wer?: boolean;
}

interface PdfCase extends BaseCase {
  kind: "pdf";
  pdf: string;
  page: number;
}

interface CanvasCase extends BaseCase {
  kind: "canvas";
  text: string;
}

interface ImageCase extends BaseCase {
  kind: "image";
  path: string;
  groundTruth: string;
}

type BenchmarkCase = PdfCase | CanvasCase | ImageCase;

interface Manifest {
  version: number;
  description: string;
  cases: BenchmarkCase[];
}

interface CaseResult {
  id: string;
  kind: BenchmarkCase["kind"];
  variant: Variant;
  language: string;
  preprocessing: "none" | "deskew+upscale+contrast";
  page: number;
  referenceText: string;
  recognizedText: string;
  referenceChars: number;
  recognizedChars: number;
  cer: number;
  wer: number | null;
  confidence: number | null;
  ms: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const defaultManifest = resolve(repoRoot, "benchmarks/ocr/cases.json");
const resultsDir = resolve(repoRoot, "benchmarks/ocr/results");

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeForCer(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "");
}

function normalizeForWer(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function editDistance<T>(reference: T[], hypothesis: T[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let i = 1; i <= reference.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= hypothesis.length; j += 1) {
      const substitution = previous[j - 1]! + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
    }
    previous = current;
  }
  return previous[hypothesis.length]!;
}

function cer(reference: string, hypothesis: string): number {
  const ref = Array.from(normalizeForCer(reference));
  const hyp = Array.from(normalizeForCer(hypothesis));
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return editDistance(ref, hyp) / ref.length;
}

function wer(reference: string, hypothesis: string): number {
  const ref = normalizeForWer(reference).split(" ").filter(Boolean);
  const hyp = normalizeForWer(hypothesis).split(" ").filter(Boolean);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return editDistance(ref, hyp) / ref.length;
}

function rank(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j += 1;
    const average = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k]!.index] = average;
    i = j + 1;
  }
  return ranks;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) return null;
  return numerator / Math.sqrt(denomX * denomY);
}

function spearman(xs: number[], ys: number[]): number | null {
  return pearson(rank(xs), rank(ys));
}

async function canvasPng(text: string, variant: Variant): Promise<Buffer> {
  const width = 900;
  const height = 300;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "black";
  context.font = "56px sans-serif";
  const lines = text.split("\n");
  lines.forEach((line, index) => context.fillText(line, 40, 110 + index * 80));
  return transform(canvas.toBuffer("image/png"), variant, `${text}:${variant}`);
}

async function transform(png: Uint8Array, variant: Variant, seedText: string): Promise<Buffer> {
  if (variant === "clean") return Buffer.from(png);
  const image = await loadImage(Buffer.from(png));
  if (variant === "low-res") {
    const scale = 0.5;
    const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toBuffer("image/png");
  }
  if (variant === "rotate-2") {
    const angle = (2 * Math.PI) / 180;
    const padding = 20;
    const width = Math.ceil(image.width * Math.cos(angle) + image.height * Math.sin(angle)) + padding * 2;
    const height = Math.ceil(image.height * Math.cos(angle) + image.width * Math.sin(angle)) + padding * 2;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.translate(width / 2, height / 2);
    context.rotate(angle);
    context.drawImage(image, -image.width / 2, -image.height / 2);
    return canvas.toBuffer("image/png");
  }
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  if (variant === "blur-1") context.filter = "blur(1px)";
  context.drawImage(image, 0, 0);
  context.filter = "none";

  if (variant === "noise" || variant === "low-contrast") {
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    let seed = 0;
    for (const char of seedText) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    for (let i = 0; i < data.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        let value = data.data[i + channel]!;
        if (variant === "noise") {
          seed = (1664525 * seed + 1013904223) >>> 0;
          value += (seed % 41) - 20;
        } else {
          value = 128 + (value - 128) * 0.35;
        }
        data.data[i + channel] = Math.max(0, Math.min(255, Math.round(value)));
      }
    }
    context.putImageData(data, 0, 0);
  }
  return canvas.toBuffer("image/png");
}

async function referenceForPdf(pdfBytes: Uint8Array, page: number): Promise<string> {
  const extraction = await extractSource(pdfBytes, "benchmark.pdf");
  const text = extraction.pages.find((candidate) => candidate.pageNumber === page)?.textContent;
  if (text === undefined || text.trim() === "") {
    throw new Error(`No embedded text for PDF page ${page}; cannot use it as benchmark ground truth`);
  }
  return text;
}

async function imageForCase(benchmarkCase: BenchmarkCase, pdfBytes: Uint8Array | undefined): Promise<{ png: Buffer; reference: string }> {
  if (benchmarkCase.kind === "canvas") {
    return {
      png: await canvasPng(benchmarkCase.text, benchmarkCase.variant),
      reference: benchmarkCase.text,
    };
  }
  if (benchmarkCase.kind === "image") {
    const original = await readFile(resolve(repoRoot, benchmarkCase.path));
    return { png: await transform(original, benchmarkCase.variant, benchmarkCase.id), reference: benchmarkCase.groundTruth };
  }
  if (pdfBytes === undefined) throw new Error("PDF bytes are missing");
  const unpdf = await import("unpdf");
  const document = await unpdf.getDocumentProxy(new Uint8Array(pdfBytes), { verbosity: 0 });
  const rendered = await unpdfPageRenderer(document, benchmarkCase.page);
  return {
    png: await transform(rendered, benchmarkCase.variant, benchmarkCase.id),
    reference: await referenceForPdf(pdfBytes, benchmarkCase.page),
  };
}

function markdown(result: {
  generatedAt: string;
  environment: Record<string, string | number>;
  description: string;
  preprocessing: "none" | "deskew+upscale+contrast";
  cases: CaseResult[];
  summary: Record<string, number | null>;
}): string {
  const lines = [
    "# OCR benchmark",
    "",
    `- Generated: ${result.generatedAt}`,
    `- Dataset: ${result.description}`,
    `- Preprocessing: ${result.preprocessing}`,
    `- Platform: ${result.environment.platform} ${result.environment.arch}`,
    `- Node.js: ${result.environment.node}`,
    `- Tesseract: ${result.environment.tesseract}`,
    "",
    "| Case | Language | CER | WER | Confidence | ms |",
    "|---|---|---:|---:|---:|---:|",
    ...result.cases.map((item) =>
      `| ${item.id} | ${item.language} | ${(item.cer * 100).toFixed(2)}% | ${item.wer === null ? "n/a" : `${(item.wer * 100).toFixed(2)}%`} | ${item.confidence === null ? "n/a" : item.confidence.toFixed(4)} | ${item.ms.toFixed(0)} |`,
    ),
    "",
    `- Mean CER: ${(result.summary.meanCer! * 100).toFixed(2)}%`,
    `- Mean WER (English cases): ${result.summary.meanWer == null ? "n/a" : `${(result.summary.meanWer * 100).toFixed(2)}%`}`,
    `- Confidence vs CER: Pearson ${result.summary.pearson == null ? "n/a" : result.summary.pearson.toFixed(3)}, Spearman ${result.summary.spearman == null ? "n/a" : result.summary.spearman.toFixed(3)} (n=${result.cases.length})`,
    `- Total OCR time: ${result.summary.totalMs!.toFixed(0)} ms`,
    `- Peak RSS: ${result.summary.peakRssMb!.toFixed(1)} MiB`,
    "",
    "Synthetic cases are regression signals. They do not establish accuracy on representative scans or target hardware.",
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const manifestPath = resolve(repoRoot, argValue("--manifest") ?? defaultManifest);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const preprocess = process.argv.includes("--preprocess");
  const preprocessing: "none" | "deskew+upscale+contrast" = preprocess ? "deskew+upscale+contrast" : "none";
  const engine = new TesseractCliEngine();
  if (!engine.isAvailable()) {
    throw new Error("Tesseract is not available; install it or set TESSERACT_PATH before running the benchmark");
  }

  const pdfCache = new Map<string, Uint8Array>();
  const results: CaseResult[] = [];
  for (const benchmarkCase of manifest.cases) {
    let pdfBytes: Uint8Array | undefined;
    if (benchmarkCase.kind === "pdf") {
      pdfBytes = pdfCache.get(benchmarkCase.pdf);
      if (pdfBytes === undefined) {
        pdfBytes = await readFile(resolve(repoRoot, benchmarkCase.pdf));
        pdfCache.set(benchmarkCase.pdf, pdfBytes);
      }
    }
    const { png, reference } = await imageForCase(benchmarkCase, pdfBytes);
    const started = performance.now();
    const imageForOcr = preprocess ? await canvasImagePreprocessor.process(png, 1) : png;
    const ocr = await engine.processPage(imageForOcr, benchmarkCase.kind === "pdf" ? benchmarkCase.page : 1, {
      language: benchmarkCase.language,
    });
    const ms = performance.now() - started;
    results.push({
      id: benchmarkCase.id,
      kind: benchmarkCase.kind,
      variant: benchmarkCase.variant,
      language: ocr.language ?? benchmarkCase.language,
      preprocessing,
      page: ocr.pageNumber,
      referenceText: reference,
      recognizedText: ocr.textContent,
      referenceChars: Array.from(normalizeForCer(reference)).length,
      recognizedChars: Array.from(normalizeForCer(ocr.textContent)).length,
      cer: cer(reference, ocr.textContent),
      wer: benchmarkCase.wer === true ? wer(reference, ocr.textContent) : null,
      confidence: ocr.confidence ?? null,
      ms,
    });
  }

  const withConfidence = results.filter((item) => item.confidence !== null);
  const werCases = results.filter((item) => item.wer !== null);
  const summary = {
    meanCer: results.reduce((sum, item) => sum + item.cer, 0) / results.length,
    meanWer: werCases.length === 0 ? null : werCases.reduce((sum, item) => sum + item.wer!, 0) / werCases.length,
    pearson: pearson(withConfidence.map((item) => item.confidence!), withConfidence.map((item) => item.cer)),
    spearman: spearman(withConfidence.map((item) => item.confidence!), withConfidence.map((item) => item.cer)),
    totalMs: results.reduce((sum, item) => sum + item.ms, 0),
    peakRssMb: process.resourceUsage().maxRSS / 1024,
  };
  const output = {
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      tesseract: engine.version,
    },
    description: manifest.description,
    preprocessing,
    cases: results,
    summary,
  };

  console.log(markdown(output));
  if (process.argv.includes("--write")) {
    const suffix = preprocess ? "-preprocessed" : "";
    await mkdir(resultsDir, { recursive: true });
    await writeFile(resolve(resultsDir, `latest${suffix}.json`), `${JSON.stringify(output, null, 2)}\n`);
    await writeFile(resolve(resultsDir, `latest${suffix}.md`), markdown(output));
    console.log(`Wrote ${resolve(resultsDir, `latest${suffix}.json`)} and latest${suffix}.md`);
  }
}

await main();
