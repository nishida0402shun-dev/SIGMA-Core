import { describe, expect, it } from "vitest";
import {
  createSourceRecord,
  detectFormat,
  extractSource,
  ExtractorRegistry,
  plainTextExtractor,
} from "../src/index.js";

describe("format detection", () => {
  it("recognizes UTF-8 text", () => {
    expect(detectFormat(Buffer.from("hello"), "note.txt").format).toBe("plain-text");
  });

  it("detects PDF by signature, not extension", () => {
    expect(detectFormat(Buffer.from("%PDF-1.7"), "wrong.bin").format).toBe("pdf");
  });

  it("detects ZIP containers without claiming their contents are supported", () => {
    const result = detectFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04]), "archive.zip");
    expect(result.format).toBe("zip");
    expect(result.status).toBe("unverified");
  });

  it("does not treat an extension as proof of text content", () => {
    expect(detectFormat(Buffer.from([0xff, 0x00, 0xfe]), "file.txt").format).toBe("unknown");
  });
});

describe("source records and extraction", () => {
  it("records a stable content hash and byte length", () => {
    const bytes = Buffer.from("SIGMA Core");
    const record = createSourceRecord(bytes, "source.txt");
    expect(record.sourceId).toBe(record.sha256);
    expect(record.byteLength).toBe(bytes.length);
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("extracts plain text and preserves the input bytes", () => {
    const bytes = Buffer.from("hello\n世界", "utf8");
    const original = Buffer.from(bytes);
    const result = extractSource(bytes, "memo.txt");
    expect(result.status).toBe("complete");
    expect(result.text).toBe("hello\n世界");
    expect(bytes.equals(original)).toBe(true);
  });

  it("fails closed for a format without an extractor", () => {
    const result = extractSource(Buffer.from("%PDF-1.7"), "document.pdf");
    expect(result.status).toBe("failed");
    expect(result.warnings[0]).toContain("No extractor registered");
  });

  it("rejects duplicate extractor registrations", () => {
    const registry = new ExtractorRegistry();
    registry.register(plainTextExtractor);
    expect(() => registry.register(plainTextExtractor)).toThrow("already registered");
  });
});
