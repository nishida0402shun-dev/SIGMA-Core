#!/usr/bin/env node
/**
 * Electron / native-module readiness probe.
 *
 * Run under plain Node to validate the native modules and PDF renderer:
 *   node scripts/electron-native-probe.mjs --write
 *
 * Run under Electron on the target machine (after packaging/rebuild):
 *   npx electron scripts/electron-native-probe.mjs --write
 *
 * The probe never loads or uploads document content. It only renders the
 * repository's test fixture when that file is present.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const resultsDir = resolve(repoRoot, "benchmarks/ocr/results");
const require = createRequire(import.meta.url);
const checks = [];

function record(id, required, fn) {
  try {
    const detail = fn();
    checks.push({ id, required, ok: true, detail: detail ?? "ok" });
  } catch (error) {
    checks.push({ id, required, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

record("electron-runtime", false, () => {
  const electron = process.versions.electron;
  return electron
    ? `Electron ${electron}, Node ${process.versions.node}, ABI ${process.versions.modules}`
    : `plain Node ${process.versions.node}, ABI ${process.versions.modules} (run under Electron for the packaged check)`;
});

record("native-canvas", true, () => {
  const { createCanvas } = require("@napi-rs/canvas");
  const canvas = createCanvas(24, 24);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 24, 24);
  context.fillStyle = "black";
  context.fillText("A", 2, 18);
  const png = canvas.toBuffer("image/png");
  if (png.length < 9 || png[0] !== 0x89 || png[1] !== 0x50) throw new Error("canvas did not emit a PNG");
  return `PNG ${png.length} bytes, ABI ${process.versions.modules}`;
});

record("sqlite-driver", true, () => {
  let driver;
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(":memory:");
    const version = db.prepare("SELECT sqlite_version() AS version").get().version;
    const fts5 = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS fts5").get().fts5;
    db.close();
    if (!fts5) throw new Error("node:sqlite lacks FTS5");
    driver = `node:sqlite ${version} with FTS5`;
  } catch (nodeSqliteError) {
    try {
      const BetterSqlite3 = require("better-sqlite3");
      const db = new BetterSqlite3(":memory:");
      const version = db.prepare("SELECT sqlite_version() AS version").get().version;
      const fts5 = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS fts5").get().fts5;
      db.close();
      if (!fts5) throw new Error("better-sqlite3 lacks FTS5");
      driver = `better-sqlite3 ${version} with FTS5`;
    } catch (betterSqliteError) {
      throw new Error(
        `no SQLite driver: node:sqlite (${nodeSqliteError.message}); better-sqlite3 (${betterSqliteError.message})`,
      );
    }
  }
  return driver;
});

record("tesseract-cli", false, () => {
  const executable = process.env.TESSERACT_PATH ?? "tesseract";
  const probe = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (probe.error || probe.status !== 0) {
    throw new Error(`executable '${executable}' unavailable; bundle Tesseract as extraResources and set TESSERACT_PATH`);
  }
  const version = /tesseract\s+v?(\d+\.\d+\.\d+)/i.exec(`${probe.stdout}${probe.stderr}`)?.[1] ?? "unknown";
  return `${executable} ${version}`;
});

const fixture = resolve(repoRoot, "tests/fixtures/japanese-two-pages.pdf");
if (existsSync(fixture)) {
  try {
    const unpdf = await import("unpdf");
    const bytes = await readFile(fixture);
    const document = await unpdf.getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
    const rendered = new Uint8Array(await unpdf.renderPageAsImage(document, 1, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale,
    }));
    const ok = rendered.length > 8 && rendered[0] === 0x89 && rendered[1] === 0x50;
    checks.push({
      id: "pdf-rasterization",
      required: true,
      ok,
      detail: ok ? `PNG ${rendered.byteLength} bytes` : "renderer did not return a PNG",
    });
  } catch (error) {
    checks.push({
      id: "pdf-rasterization",
      required: true,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

const markdown = [
  "# Electron / native-module probe",
  "",
  `- Generated: ${new Date().toISOString()}`,
  `- Platform: ${process.platform} ${process.arch}`,
  `- Electron: ${process.versions.electron ?? "not running under Electron"}`,
  "",
  "| Check | Required | Status | Detail |",
  "|---|---|---|---|",
  ...checks.map((check) =>
    `| ${check.id} | ${check.required ? "yes" : "no"} | ${check.ok ? "PASS" : "FAIL"} | ${check.detail} |`,
  ),
  "",
  "A plain-Node pass does not prove packaged Electron startup. Run this script under the packaged Electron binary on the target machine and verify `app.asar.unpacked` native binaries and `extraResources` Tesseract paths.",
  "",
].join("\n");

console.log(markdown);
if (process.argv.includes("--write")) {
  await mkdir(resultsDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron ?? null,
    node: process.versions.node,
    abi: process.versions.modules,
    checks,
  };
  await writeFile(resolve(resultsDir, "electron-native-latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(resultsDir, "electron-native-latest.md"), markdown);
  console.log(`Wrote ${resolve(resultsDir, "electron-native-latest.json")} and electron-native-latest.md`);
}

const failed = checks.filter((check) => check.required && !check.ok);
if (failed.length > 0) {
  process.exitCode = 1;
  console.error(`ELECTRON_NATIVE_CHECK_FAILED: ${failed.map((check) => check.id).join(", ")}`);
}
