/**
 * Windows OCR smoke test used by CI. It exercises the real Tesseract CLI and
 * @napi-rs/canvas binary on Windows, which the POSIX test fixtures cannot cover.
 */
import { createCanvas } from "@napi-rs/canvas";
import { extractSource } from "../src/extraction.ts";
import { TesseractCliEngine } from "../src/tesseract-cli-engine.ts";

const canvas = createCanvas(600, 200);
const context = canvas.getContext("2d");
context.fillStyle = "white";
context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = "black";
context.font = "48px sans-serif";
context.fillText("Hello OCR 123", 20, 110);
const png = new Uint8Array(canvas.toBuffer("image/png"));

const engine = new TesseractCliEngine({ defaultLanguage: "eng" });
if (!engine.isAvailable()) {
  throw new Error("Tesseract is not available on PATH; set TESSERACT_PATH for the smoke test");
}

const result = await engine.processPage(png, 1);
const report = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  tesseract: engine.version,
  text: result.textContent,
  language: result.language,
  confidence: result.confidence,
};
console.log(JSON.stringify(report));

if (!/Hello OCR/i.test(result.textContent)) {
  throw new Error(`Unexpected OCR text: ${JSON.stringify(result.textContent)}`);
}
if (result.language !== "eng") {
  throw new Error(`Unexpected OCR language: ${result.language}`);
}
if (result.confidence === undefined || result.confidence < 0 || result.confidence > 1) {
  throw new Error(`Unexpected OCR confidence: ${result.confidence}`);
}

const extraction = await extractSource(png, "windows-smoke.png", undefined, {
  ocrEngine: engine,
  ocrLanguage: "eng",
});
if (extraction.status !== "partial") {
  throw new Error(`Expected partial image OCR status, got ${extraction.status}`);
}
if (extraction.pages[0]?.ocrLanguage !== "eng") {
  throw new Error(`Expected eng provenance, got ${extraction.pages[0]?.ocrLanguage}`);
}
