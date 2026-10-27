import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OcrEngine, OcrOptions, OcrPageResult } from "./ocr.ts";

const execFileAsync = promisify(execFile);

/** Tesseract is CPU-bound; reject images that would dominate memory before spawning it. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Mean Tesseract word confidence (0..1). A missing or malformed TSV only means
 * confidence is unavailable; it must not fail an otherwise successful OCR run.
 */
async function readConfidence(tsvPath: string): Promise<number | undefined> {
  let tsv: string;
  try {
    tsv = await fs.readFile(tsvPath, "utf8");
  } catch {
    return undefined;
  }
  const scores: number[] = [];
  for (const line of tsv.split(/\r?\n/)) {
    const columns = line.split("\t");
    if (columns.length < 12 || columns[0] !== "5") continue;
    // Tesseract can emit word rows with empty text and a high score on blank
    // or noise-only regions. They are not recognized words and must not inflate
    // the page confidence.
    if (columns.slice(11).join("\t").trim() === "") continue;
    const score = Number(columns[10]);
    if (Number.isFinite(score) && score >= 0) scores.push(score);
  }
  if (scores.length === 0) return undefined;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length / 100;
}

export interface TesseractEngineOptions {
  executablePath?: string | undefined;
  defaultTimeoutMs?: number | undefined;
  /** Language specification used when a page does not override it. */
  defaultLanguage?: string | undefined;
}

/**
 * Lightweight, process-isolated Tesseract OCR engine.
 * Spawns tesseract CLI per page to protect the Core process from crashes/hangs,
 * cleans up temporary files, and enforces timeout limits.
 */
export class TesseractCliEngine implements OcrEngine {
  readonly id = "tesseract-cli";
  readonly #executablePath: string;
  readonly #defaultTimeoutMs: number;
  readonly #defaultLanguage: string;
  #available: boolean | undefined;
  #version = "unknown";

  constructor(options?: TesseractEngineOptions) {
    this.#executablePath = options?.executablePath ?? process.env.TESSERACT_PATH ?? "tesseract";
    this.#defaultTimeoutMs = options?.defaultTimeoutMs ?? 30000;
    this.#defaultLanguage = options?.defaultLanguage ?? process.env.SIGMA_OCR_LANGUAGE ?? "jpn+eng";
  }

  get version(): string {
    return this.#version;
  }

  isAvailable(): boolean {
    if (this.#available !== undefined) return this.#available;
    try {
      const probe = spawnSync(this.#executablePath, ["--version"], { encoding: "utf8", timeout: 5000 });
      if (probe.error || probe.status !== 0) throw probe.error ?? new Error("version probe failed");
      this.#version = /tesseract\s+v?(\d+\.\d+\.\d+)/i.exec(`${probe.stdout}${probe.stderr}`)?.[1] ?? "unknown";
      this.#available = true;
    } catch {
      this.#available = false;
    }
    return this.#available;
  }

  async processPage(
    imageBytes: Uint8Array,
    pageNumber: number,
    options?: OcrOptions,
  ): Promise<OcrPageResult> {
    if (!this.isAvailable()) {
      throw new Error(`OCR_ENGINE_UNAVAILABLE: Tesseract executable '${this.#executablePath}' was not found or is unavailable`);
    }
    if (imageBytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`OCR_IMAGE_TOO_LARGE: Page ${pageNumber} image is ${imageBytes.byteLength} bytes; limit is ${MAX_IMAGE_BYTES}.`);
    }

    const lang = options?.language ?? this.#defaultLanguage;
    if (!/^[a-z0-9_]+(?:\+[a-z0-9_]+)*$/i.test(lang)) {
      throw new Error(`OCR_INVALID_LANGUAGE: Unsupported language specification '${lang}'`);
    }

    const tempDir = await fs.mkdtemp(join(tmpdir(), "sigma-ocr-"));
    const tempInPath = join(tempDir, `page-${pageNumber}.png`);
    const tempOutBase = join(tempDir, "output");

    try {
      await fs.writeFile(tempInPath, imageBytes);

      await execFileAsync(this.#executablePath, [tempInPath, tempOutBase, "-l", lang, "txt", "tsv"], {
        timeout: options?.timeoutMs ?? this.#defaultTimeoutMs,
        windowsHide: true,
      });

      const [textContent, confidence] = await Promise.all([
        fs.readFile(`${tempOutBase}.txt`, "utf8"),
        readConfidence(`${tempOutBase}.tsv`),
      ]);
      return {
        pageNumber,
        textContent: textContent.trim(),
        confidence,
        language: lang,
      };
    } catch (error) {
      const details = error as { killed?: boolean; signal?: string | null; message?: string };
      if (details.killed || details.signal) {
        throw new Error(`OCR_TIMEOUT: Processing page ${pageNumber} timed out`);
      }
      throw new Error(`OCR_EXECUTION_FAILED: Failed to process page ${pageNumber}: ${details.message ?? String(error)}`);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
