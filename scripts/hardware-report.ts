/**
 * Target-hardware readiness report.
 *
 * Collects OS/CPU/RAM, Node, Tesseract languages, SQLite FTS5, native canvas,
 * PDF rasterization, and a small OCR smoke test. Intended to be run on the
 * Windows 11 / Ryzen 5 4500U / 8 GB target machine before accepting OCR.
 *
 * Usage:
 *   node --experimental-strip-types scripts/hardware-report.ts --write
 *   node --experimental-strip-types scripts/hardware-report.ts --language jpn+eng --write
 *
 * The report contains no document text beyond a fixed smoke-test phrase.
 */
import { createRequire } from "node:module";
import { existsSync, statfsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import * as os from "node:os";
import { createCanvas } from "@napi-rs/canvas";
import { TesseractCliEngine } from "../src/tesseract-cli-engine.ts";
import { openSqliteDatabase } from "../src/db/sqlite-driver.ts";
import { unpdfPageRenderer } from "../src/pdf-page-renderer.ts";
import { cer, normalizeForCer } from "./lib/ocr-metrics.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const resultsDir = resolve(repoRoot, "benchmarks/ocr/results");
const require = createRequire(import.meta.url);

interface Check {
  id: string;
  ok: boolean;
  required: boolean;
  ms?: number | undefined;
  detail: string;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function mib(bytes: number): number {
  return bytes / (1024 * 1024);
}

function tesseractLanguages(executable: string): string[] {
  const probe = spawnSync(executable, ["--list-langs"], { encoding: "utf8", timeout: 10_000 });
  if (probe.error || probe.status !== 0) return [];
  return `${probe.stdout}${probe.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^list of available languages/i.test(line) && !line.endsWith(":"));
}

function sqliteInfo(): { driver: string; version: string; fts5: boolean } {
  let driver = "unknown";
  try {
    require("node:sqlite");
    driver = "node:sqlite";
  } catch {
    try {
      require("better-sqlite3");
      driver = "better-sqlite3";
    } catch {
      driver = "unavailable";
    }
  }
  const db = openSqliteDatabase(":memory:");
  try {
    const version = db.prepare("SELECT sqlite_version() AS version").get()?.version;
    const fts5 = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS fts5").get()?.fts5;
    return { driver, version: String(version ?? "unknown"), fts5: Boolean(fts5) };
  } finally {
    db.close();
  }
}

async function ocrSmoke(language: string): Promise<Check & { text?: string | undefined; confidence?: number | undefined; cer?: number | undefined }> {
  const expected = "SIGMA hardware check 12345";
  const canvas = createCanvas(900, 220);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "52px sans-serif";
  context.fillText(expected, 40, 130);
  const png = new Uint8Array(canvas.toBuffer("image/png"));
  const engine = new TesseractCliEngine({ defaultLanguage: language, defaultTimeoutMs: 120_000 });
  if (!engine.isAvailable()) {
    return { id: "ocr-smoke", ok: false, required: true, detail: "Tesseract is not available" };
  }
  const started = performance.now();
  try {
    const result = await engine.processPage(png, 1, { language, timeoutMs: 120_000 });
    const ms = performance.now() - started;
    const measured = cer(expected, result.textContent);
    const ok = Array.from(normalizeForCer(result.textContent)).length > 0 && measured <= 0.25;
    return {
      id: "ocr-smoke",
      ok,
      required: true,
      ms,
      detail: `language=${result.language}, confidence=${result.confidence?.toFixed(4) ?? "n/a"}`,
      text: result.textContent,
      confidence: result.confidence,
      cer: measured,
    };
  } catch (error) {
    return {
      id: "ocr-smoke",
      ok: false,
      required: true,
      ms: performance.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pdfRenderSmoke(): Promise<Check> {
  const fixture = resolve(repoRoot, "tests/fixtures/japanese-two-pages.pdf");
  if (!existsSync(fixture)) {
    return { id: "pdf-render", ok: false, required: false, detail: "fixture not found" };
  }
  const started = performance.now();
  try {
    const bytes = await readFile(fixture);
    const unpdf = await import("unpdf");
    const document = await unpdf.getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    const rendered = await unpdfPageRenderer(document, 1);
    const ms = performance.now() - started;
    const signature = rendered.length > 8
      && rendered[0] === 0x89 && rendered[1] === 0x50 && rendered[2] === 0x4e && rendered[3] === 0x47;
    return {
      id: "pdf-render",
      ok: signature,
      required: true,
      ms,
      detail: signature ? `PNG ${rendered.byteLength} bytes` : "renderer did not return a PNG",
    };
  } catch (error) {
    return {
      id: "pdf-render",
      ok: false,
      required: true,
      ms: performance.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function markdown(report: {
  generatedAt: string;
  os: Record<string, string | number>;
  hardware: Record<string, string | number>;
  runtime: Record<string, string | number>;
  tesseract: Record<string, string | number>;
  checks: Check[];
  warnings: string[];
}): string {
  return [
    "# Target hardware readiness report",
    "",
    `- Generated: ${report.generatedAt}`,
    "",
    "| Field | Value |",
    "|---|---|",
    ...Object.entries(report.os).map(([key, value]) => `| os.${key} | ${value} |`),
    ...Object.entries(report.hardware).map(([key, value]) => `| hardware.${key} | ${value} |`),
    ...Object.entries(report.runtime).map(([key, value]) => `| runtime.${key} | ${value} |`),
    ...Object.entries(report.tesseract).map(([key, value]) => `| tesseract.${key} | ${value} |`),
    "",
    "## Checks",
    "",
    "| Check | Required | Status | ms | Detail |",
    "|---|---|---|---:|---|",
    ...report.checks.map((check) =>
      `| ${check.id} | ${check.required ? "yes" : "no"} | ${check.ok ? "PASS" : "FAIL"} | ${check.ms === undefined ? "n/a" : check.ms.toFixed(0)} | ${check.detail} |`,
    ),
    "",
    ...(report.warnings.length > 0
      ? ["## Warnings", "", ...report.warnings.map((warning) => `- ${warning}`), ""]
      : []),
    "This report proves the local runtime can execute the OCR path. It does not measure representative-scan accuracy; use `scripts/ocr-benchmark.ts` with real, consented data for that.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const language = argValue("--language") ?? "eng";
  const executable = process.env.TESSERACT_PATH ?? "tesseract";
  const warnings: string[] = [];
  const checks: Check[] = [];

  let diskTotal = 0;
  let diskFree = 0;
  try {
    const stats = statfsSync(repoRoot);
    diskTotal = stats.blocks * stats.bsize;
    diskFree = stats.bavail * stats.bsize;
  } catch {
    warnings.push("Could not read free disk space");
  }

  let canvasCheck: Check;
  try {
    const canvas = createCanvas(10, 10);
    canvas.getContext("2d").fillRect(0, 0, 10, 10);
    const png = canvas.toBuffer("image/png");
    canvasCheck = {
      id: "native-canvas",
      ok: png.length > 8,
      required: true,
      detail: `PNG ${png.length} bytes`,
    };
  } catch (error) {
    canvasCheck = {
      id: "native-canvas",
      ok: false,
      required: true,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  checks.push(canvasCheck);

  const sqlite = sqliteInfo();
  checks.push({
    id: "sqlite-fts5",
    ok: sqlite.driver !== "unavailable" && sqlite.fts5,
    required: true,
    detail: `driver=${sqlite.driver}, sqlite=${sqlite.version}, fts5=${sqlite.fts5}`,
  });

  const engine = new TesseractCliEngine({ defaultLanguage: language });
  const available = engine.isAvailable();
  const languages = available ? tesseractLanguages(executable) : [];
  const requested = language.split("+");
  const missing = requested.filter((item) => !languages.includes(item));
  if (missing.length > 0) {
    warnings.push(`Tesseract is missing requested language(s): ${missing.join(", ")}`);
  }
  checks.push({
    id: "tesseract",
    ok: available,
    required: true,
    detail: available
      ? `version=${engine.version}, languages=${languages.join(",") || "unknown"}`
      : `executable '${executable}' unavailable`,
  });

  checks.push(await pdfRenderSmoke());
  const smoke = await ocrSmoke(language);
  checks.push(smoke);
  if (smoke.text !== undefined) {
    warnings.push(`OCR smoke text: ${JSON.stringify(smoke.text)} (CER ${((smoke.cer ?? 1) * 100).toFixed(2)}%)`);
  }
  if (missing.length > 0 && smoke.ok) {
    checks.push({
      id: "requested-language",
      ok: false,
      required: false,
      detail: `OCR succeeded with the installed model set, but required language data is missing: ${missing.join(", ")}`,
    });
  }

  const cpus = os.cpus();
  const report = {
    generatedAt: new Date().toISOString(),
    os: {
      platform: process.platform,
      release: os.release(),
      version: os.version(),
      arch: process.arch,
      hostname: os.hostname(),
    },
    hardware: {
      cpu: cpus[0]?.model.trim() ?? "unknown",
      logicalCpus: cpus.length,
      totalRamMiB: Number(mib(os.totalmem()).toFixed(1)),
      freeRamMiB: Number(mib(os.freemem()).toFixed(1)),
      diskTotalGiB: Number((diskTotal / (1024 ** 3)).toFixed(1)),
      diskFreeGiB: Number((diskFree / (1024 ** 3)).toFixed(1)),
    },
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      modules: process.versions.modules,
      canvas: canvasCheck.ok ? "loaded" : "failed",
    },
    tesseract: {
      executable,
      version: engine.version,
      languages: languages.join(",") || "unknown",
      requestedLanguage: language,
    },
    checks,
    warnings,
  };

  console.log(markdown(report));
  if (process.argv.includes("--write")) {
    await mkdir(resultsDir, { recursive: true });
    await writeFile(resolve(resultsDir, "hardware-latest.json"), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(resolve(resultsDir, "hardware-latest.md"), markdown(report));
    console.log(`Wrote ${resolve(resultsDir, "hardware-latest.json")} and hardware-latest.md`);
  }

  const failedRequired = checks.filter((check) => check.required && !check.ok);
  if (failedRequired.length > 0) {
    process.exitCode = 1;
    console.error(`HARDWARE_CHECK_FAILED: ${failedRequired.map((check) => check.id).join(", ")}`);
  }
}

await main();
