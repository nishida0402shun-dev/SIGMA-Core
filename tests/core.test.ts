import { describe, expect, it } from "./test-shim.ts";
import {
  createSourceRecord,
  detectFormat,
  extractSource,
  ExtractorRegistry,
  plainTextExtractor,
} from "../src/index.ts";

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

  it("detects PNG and JPEG images by signature", () => {
    const png = detectFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "scan.bin");
    expect(png.format).toBe("image");
    expect(png.status).toBe("unverified");
    const jpeg = detectFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "photo.bin");
    expect(jpeg.format).toBe("image");
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

  it("extracts plain text and preserves the input bytes", async () => {
    const bytes = Buffer.from("hello\n世界", "utf8");
    const original = Buffer.from(bytes);
    const result = await extractSource(bytes, "memo.txt");
    expect(result.status).toBe("complete");
    expect(result.text).toBe("hello\n世界");
    expect(result.pages.length).toBe(1);
    expect(result.pages[0]!.pageNumber).toBe(1);
    expect(result.pages[0]!.extractionMethod).toBe("plain-text");
    expect(result.extractorId).toBe("builtin-plain-text");
    expect(bytes.equals(original)).toBe(true);
  });

  it("fails closed for a malformed PDF without stopping other extractions", async () => {
    const result = await extractSource(Buffer.from("%PDF-1.7\nnot a real pdf"), "document.pdf");
    expect(result.status).toBe("failed");
    expect(result.pages.length).toBe(0);
    expect(result.warnings[0]).toContain("PDF_PARSE_FAILED");
  });

  it("rejects duplicate extractor registrations", () => {
    const registry = new ExtractorRegistry();
    registry.register(plainTextExtractor);
    expect(() => registry.register(plainTextExtractor)).toThrow("already registered");
  });

  it("rejects non-positive resource limits", async () => {
    await expect(extractSource(Buffer.from("hello"), "memo.txt", undefined, {
      limits: { maxInputBytes: 0 },
    })).rejects.toThrow("INVALID_EXTRACTION_LIMIT");
  });
});
