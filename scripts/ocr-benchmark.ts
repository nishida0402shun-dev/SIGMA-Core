/**
 * OCR regression benchmark for synthetic and caller-supplied cases.
 *
 * Usage:
 *   node --experimental-strip-types scripts/ocr-benchmark.ts
 *   node --experimental-strip-types scripts/ocr-benchmark.ts --write
 *   node --experimental-strip-types scripts/ocr-benchmark.ts --preprocess
 *   node --experimental-strip-types scripts/ocr-benchmark.ts --preprocess=contrast,deskew
 *   node --experimental-strip-types scripts/ocr-benchmark.ts --manifest path/to/cases.json
 *   node --experimental-strip-types scripts/ocr-benchmark.ts --case en-table-clean
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
import {
  createCanvasImagePreprocessor,
  type ImagePreprocessOptions,
} from "../src/image-preprocessor.ts";
import { cer, mean, normalizeForCer, pearson, spearman, wer } from "./lib/ocr-metrics.ts";

type Variant = "clean" | "low-res" | "rotate-2" | "blur-1" | "noise" | "low-contrast";
type Category =
  | "printed-document"
  | "table"
  | "multi-column"
  | "formula"
  | "photo"
  | "handwriting-proxy";
type CanvasLayout = "text" | "table" | "columns" | "formula" | "photo" | "handwriting-proxy";

interface BaseCase {
  id: string;
  variant: Variant;
  language: string;
  wer?: boolean;
  category?: Category;
}

interface PdfCase extends BaseCase {
  kind: "pdf";
  pdf: string;
  page: number;
}

interface CanvasCase extends BaseCase {
  kind: "canvas";
  text: string;
  layout?: CanvasLayout;
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
  category: Category;
  kind: BenchmarkCase["kind"];
  variant: Variant;
  language: string;
  preprocessing: string;
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

interface CategorySummary {
  cases: number;
  meanCer: number;
  meanWer: number | null;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const defaultManifest = resolve(repoRoot, "benchmarks/ocr/cases.json");
const resultsDir = resolve(repoRoot, "benchmarks/ocr/results");

const layoutCategories: Record<CanvasLayout, Category> = {
  text: "printed-document",
  table: "table",
  columns: "multi-column",
  formula: "formula",
  photo: "photo",
  "handwriting-proxy": "handwriting-proxy",
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

interface PreprocessSelection {
  options: ImagePreprocessOptions;
  label: string;
  suffix: string;
}

function parsePreprocessSelection(): PreprocessSelection | undefined {
  const argument = process.argv.find((value) => value === "--preprocess" || value.startsWith("--preprocess="));
  if (!argument) return undefined;
  const raw = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : "all";
  const tokens = raw.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0 || tokens.includes("all")) {
    const preprocessor = createCanvasImagePreprocessor();
    return {
      options: {},
      label: preprocessor.settings!,
      suffix: preprocessor.settings!.replace(/\+/g, "-"),
    };
  }
  const allowed = new Set(["upscale", "contrast", "deskew"]);
  for (const token of tokens) {
    if (!allowed.has(token)) {
      throw new Error(`PREPROCESS_OPTION_INVALID: Unknown option '${token}'. Use upscale, contrast, deskew, or all.`);
    }
  }
  const options: ImagePreprocessOptions = {
    upscale: tokens.includes("upscale"),
    contrast: tokens.includes("contrast"),
    deskew: tokens.includes("deskew"),
  };
  const preprocessor = createCanvasImagePreprocessor(options);
  return {
    options,
    label: preprocessor.settings!,
    suffix: preprocessor.settings === "none" ? "none" : preprocessor.settings!.replace(/\+/g, "-"),
  };
}

async function canvasPng(benchmarkCase: CanvasCase): Promise<Buffer> {
  const layout = benchmarkCase.layout ?? "text";
  const width = 900;
  const height = layout === "table" ? 420 : layout === "photo" ? 360 : layout === "columns" ? 360 : 300;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  if (layout === "photo") {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#1d232b");
    gradient.addColorStop(0.55, "#4a545f");
    gradient.addColorStop(1, "#9aa1a8");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = "white";
    context.font = "bold 56px sans-serif";
    const lines = benchmarkCase.text.split("\n");
    lines.forEach((line, index) => context.fillText(line, 80, 170 + index * 90));
  } else {
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "black";

    if (layout === "table") {
      context.font = "40px sans-serif";
      const rows = benchmarkCase.text.split("\n");
      const columns = [40, 320, 560];
      rows.forEach((row, rowIndex) => {
        const cells = row.split("\t");
        cells.forEach((cell, columnIndex) => {
          context.fillText(cell, columns[columnIndex] ?? columns[0]! + columnIndex * 240, 80 + rowIndex * 80);
        });
      });
      context.strokeStyle = "#333333";
      context.lineWidth = 2;
      for (let row = 0; row <= rows.length; row += 1) {
        const y = 40 + row * 80;
        context.beginPath();
        context.moveTo(20, y);
        context.lineTo(width - 20, y);
        context.stroke();
      }
      for (const x of [20, 300, 520, width - 20]) {
        context.beginPath();
        context.moveTo(x, 40);
        context.lineTo(x, 40 + rows.length * 80);
        context.stroke();
      }
    } else if (layout === "columns") {
      context.font = "44px sans-serif";
      const lines = benchmarkCase.text.split("\n");
      const split = Math.ceil(lines.length / 2);
      lines.forEach((line, index) => {
        const inRight = index >= split;
        context.fillText(line, inRight ? 480 : 40, 80 + (index % split) * 70);
      });
      context.strokeStyle = "#bbbbbb";
      context.beginPath();
      context.moveTo(450, 40);
      context.lineTo(450, height - 40);
      context.stroke();
    } else if (layout === "formula") {
      context.font = "48px sans-serif";
      const lines = benchmarkCase.text.split("\n");
      lines.forEach((line, index) => context.fillText(line, 60, 100 + index * 80));
    } else if (layout === "handwriting-proxy") {
      context.font = "italic 50px serif";
      let x = 50;
      for (const [index, character] of Array.from(benchmarkCase.text).entries()) {
        const jitterY = ((index * 7) % 5) - 2;
        const rotation = (((index * 11) % 7) - 3) * 0.004;
        context.save();
        context.translate(x, 170 + jitterY);
        context.rotate(rotation);
        context.fillText(character, 0, 0);
        context.restore();
        x += context.measureText(character).width;
      }
    } else {
      context.font = "56px sans-serif";
      const lines = benchmarkCase.text.split("\n");
      lines.forEach((line, index) => context.fillText(line, 40, 110 + index * 80));
    }
  }

  return transform(canvas.toBuffer("image/png"), benchmarkCase.variant, `${benchmarkCase.text}:${benchmarkCase.variant}`);
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
    for (const character of seedText) seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
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
      png: await canvasPng(benchmarkCase),
      reference: benchmarkCase.text.replace(/\t/g, " "),
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

function categoryFor(benchmarkCase: BenchmarkCase): Category {
  if (benchmarkCase.category) return benchmarkCase.category;
  if (benchmarkCase.kind === "canvas") return layoutCategories[benchmarkCase.layout ?? "text"];
  return "printed-document";
}

function markdown(result: {
  generatedAt: string;
  environment: Record<string, string | number>;
  description: string;
  preprocessing: string;
  cases: CaseResult[];
  summary: {
    meanCer: number;
    meanWer: number | null;
    pearson: number | null;
    spearman: number | null;
    totalMs: number;
    peakRssMb: number;
    byCategory: Record<string, CategorySummary>;
  };
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
    "| Case | Category | Language | CER | WER | Confidence | ms |",
    "|---|---|---|---:|---:|---:|---:|",
    ...result.cases.map((item) =>
      `| ${item.id} | ${item.category} | ${item.language} | ${(item.cer * 100).toFixed(2)}% | ${item.wer === null ? "n/a" : `${(item.wer * 100).toFixed(2)}%`} | ${item.confidence === null ? "n/a" : item.confidence.toFixed(4)} | ${item.ms.toFixed(0)} |`,
    ),
    "",
    "## Category summary",
    "",
    "| Category | Cases | Mean CER | Mean WER |",
    "|---|---:|---:|---:|",
    ...Object.entries(result.summary.byCategory).map(([category, summary]) =>
      `| ${category} | ${summary.cases} | ${(summary.meanCer * 100).toFixed(2)}% | ${summary.meanWer === null ? "n/a" : `${(summary.meanWer * 100).toFixed(2)}%`} |`,
    ),
    "",
    `- Mean CER: ${(result.summary.meanCer * 100).toFixed(2)}%`,
    `- Mean WER (English cases): ${result.summary.meanWer == null ? "n/a" : `${(result.summary.meanWer * 100).toFixed(2)}%`}`,
    `- Confidence vs CER: Pearson ${result.summary.pearson == null ? "n/a" : result.summary.pearson.toFixed(3)}, Spearman ${result.summary.spearman == null ? "n/a" : result.summary.spearman.toFixed(3)} (n=${result.cases.length})`,
    `- Total OCR time: ${result.summary.totalMs.toFixed(0)} ms`,
    `- Peak RSS: ${result.summary.peakRssMb.toFixed(1)} MiB`,
    "",
    "Synthetic cases are regression signals. Table, column, formula, photo, and handwriting proxies are rendered with system fonts and distortions; they do not establish accuracy on representative scans or target hardware.",
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const manifestPath = resolve(repoRoot, argValue("--manifest") ?? defaultManifest);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const selection = parsePreprocessSelection();
  const preprocessing = selection?.label ?? "none";
  const preprocessor = selection
    ? createCanvasImagePreprocessor(selection.options)
    : undefined;
  const engine = new TesseractCliEngine();
  if (!engine.isAvailable()) {
    throw new Error("Tesseract is not available; install it or set TESSERACT_PATH before running the benchmark");
  }

  const caseFilter = argValue("--case");
  const selectedCases = caseFilter
    ? manifest.cases.filter((candidate) => candidate.id === caseFilter)
    : manifest.cases;
  if (selectedCases.length === 0) {
    throw new Error(`No benchmark cases matched${caseFilter ? ` --case ${caseFilter}` : ""}`);
  }

  const pdfCache = new Map<string, Uint8Array>();
  const results: CaseResult[] = [];
  for (const benchmarkCase of selectedCases) {
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
    const imageForOcr = preprocessor ? await preprocessor.process(png, 1) : png;
    const ocr = await engine.processPage(imageForOcr, benchmarkCase.kind === "pdf" ? benchmarkCase.page : 1, {
      language: benchmarkCase.language,
    });
    const ms = performance.now() - started;
    results.push({
      id: benchmarkCase.id,
      category: categoryFor(benchmarkCase),
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

  const byCategory = new Map<string, CaseResult[]>();
  for (const item of results) {
    const group = byCategory.get(item.category) ?? [];
    group.push(item);
    byCategory.set(item.category, group);
  }
  const categorySummary: Record<string, CategorySummary> = {};
  for (const [category, items] of byCategory) {
    const werCases = items.filter((item) => item.wer !== null);
    categorySummary[category] = {
      cases: items.length,
      meanCer: mean(items.map((item) => item.cer))!,
      meanWer: mean(werCases.map((item) => item.wer!)),
    };
  }

  const withConfidence = results.filter((item) => item.confidence !== null);
  const werCases = results.filter((item) => item.wer !== null);
  const summary = {
    meanCer: mean(results.map((item) => item.cer))!,
    meanWer: mean(werCases.map((item) => item.wer!)),
    pearson: pearson(withConfidence.map((item) => item.confidence!), withConfidence.map((item) => item.cer)),
    spearman: spearman(withConfidence.map((item) => item.confidence!), withConfidence.map((item) => item.cer)),
    totalMs: results.reduce((sum, item) => sum + item.ms, 0),
    peakRssMb: process.resourceUsage().maxRSS / 1024,
    byCategory: categorySummary,
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
    const suffix = selection ? `-${selection.suffix}` : "";
    await mkdir(resultsDir, { recursive: true });
    await writeFile(resolve(resultsDir, `latest${suffix}.json`), `${JSON.stringify(output, null, 2)}\n`);
    await writeFile(resolve(resultsDir, `latest${suffix}.md`), markdown(output));
    console.log(`Wrote ${resolve(resultsDir, `latest${suffix}.json`)} and latest${suffix}.md`);
  }
}

await main();
