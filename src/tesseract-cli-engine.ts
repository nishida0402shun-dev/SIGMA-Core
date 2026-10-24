import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { OcrEngine, OcrOptions, OcrPageResult } from "./ocr.ts";

export interface TesseractEngineOptions {
  executablePath?: string | undefined;
  defaultTimeoutMs?: number | undefined;
}

/**
 * Lightweight, process-isolated Tesseract OCR engine.
 * Spawns tesseract CLI per page to protect the Core process from crashes/hangs,
 * cleans up temporary files, and enforces timeout limits.
 */
export class TesseractCliEngine implements OcrEngine {
  readonly id = "tesseract-cli";
  readonly version = "5.x";
  readonly #executablePath: string;
  readonly #defaultTimeoutMs: number;

  constructor(options?: TesseractEngineOptions) {
    this.#executablePath = options?.executablePath ?? process.env.TESSERACT_PATH ?? "tesseract";
    this.#defaultTimeoutMs = options?.defaultTimeoutMs ?? 30000;
  }

  isAvailable(): boolean {
    try {
      execFileSync(this.#executablePath, ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  async processPage(
    imageBytes: Uint8Array,
    pageNumber: number,
    options?: OcrOptions,
  ): Promise<OcrPageResult> {
    if (!this.isAvailable()) {
      throw new Error(`OCR_ENGINE_UNAVAILABLE: Tesseract executable '${this.#executablePath}' was not found or is unavailable`);
    }

    const runId = randomUUID();
    const tempInPath = join(tmpdir(), `ocr_in_${runId}.png`);
    const tempOutBase = join(tmpdir(), `ocr_out_${runId}`);
    const tempOutTxt = `${tempOutBase}.txt`;

    try {
      await fs.writeFile(tempInPath, imageBytes);

      const lang = options?.language ?? "jpn+eng";
      const timeout = options?.timeoutMs ?? this.#defaultTimeoutMs;

      execFileSync(this.#executablePath, [tempInPath, tempOutBase, "-l", lang], {
        timeout,
        stdio: "ignore",
      });

      const textContent = await fs.readFile(tempOutTxt, "utf8");
      return {
        pageNumber,
        textContent: textContent.trim(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ETIMEDOUT") || message.includes("timed out")) {
        throw new Error(`OCR_TIMEOUT: Processing page ${pageNumber} timed out`);
      }
      throw new Error(`OCR_EXECUTION_FAILED: Failed to process page ${pageNumber}: ${message}`);
    } finally {
      await Promise.allSettled([
        fs.unlink(tempInPath),
        fs.unlink(tempOutTxt),
      ]);
    }
  }
}
