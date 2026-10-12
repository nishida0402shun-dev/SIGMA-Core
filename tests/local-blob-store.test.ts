import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { LocalBlobStore } from "../src/persistence/local-blob-store.js";

const dirs: string[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sigma-blob-test-"));
  dirs.push(dir);
  return { dir, store: new LocalBlobStore(join(dir, "blobs")) };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("LocalBlobStore", () => {
  it("stores original bytes by content hash and verifies them on read", async () => {
    const { store } = setup();
    const bytes = Buffer.from("original bytes\n");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const result = await store.put(bytes, sha);
    expect(result.sha256).toBe(sha);
    expect(result.created).toBe(true);
    expect(await store.get(sha)).toEqual(bytes);
  });

  it("deduplicates identical bytes without changing the original", async () => {
    const { store } = setup();
    const bytes = Buffer.from("same source");
    const first = await store.put(bytes);
    const second = await store.put(bytes);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await store.get(first.sha256)).toEqual(bytes);
  });

  it("rejects a mismatched expected hash and invalid hash paths", async () => {
    const { store } = setup();
    await expect(store.put(Buffer.from("x"), "0".repeat(64))).rejects.toThrow("does not match");
    await expect(store.get("../../etc/passwd")).rejects.toThrow("Invalid SHA-256");
  });

  it("detects corrupted stored content", async () => {
    const { dir, store } = setup();
    const bytes = Buffer.from("not mutable");
    const result = await store.put(bytes);
    writeFileSync(result.path, "tampered");
    await expect(store.get(result.sha256)).rejects.toThrow("integrity check failed");
  });
});
