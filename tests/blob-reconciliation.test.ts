import { afterEach, describe, expect, it } from "./test-shim.ts";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalBlobStore } from "../src/persistence/local-blob-store.ts";
import { BlobReconciliationService } from "../src/services/blob-reconciliation-service.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sigma-reconcile-test-"));
  dirs.push(dir);
  return { dir, store: new LocalBlobStore(join(dir, "blobs")) };
}

describe("BlobReconciliationService", () => {
  it("reports orphaned, missing, and corrupted blobs without mutating storage", async () => {
    const { dir, store } = setup();
    const referencedBytes = Buffer.from("referenced");
    const orphanBytes = Buffer.from("orphan");
    const referencedHash = createHash("sha256").update(referencedBytes).digest("hex");
    const orphanHash = createHash("sha256").update(orphanBytes).digest("hex");
    const corruptedBytes = Buffer.from("original");
    const corruptedHash = createHash("sha256").update(corruptedBytes).digest("hex");

    await store.put(referencedBytes);
    const orphan = await store.put(orphanBytes);
    const corrupted = await store.put(corruptedBytes);
    writeFileSync(corrupted.path, "tampered");

    const missingHash = "f".repeat(64);
    const repository = {
      listBlobStorageKeys: () => [referencedHash, missingHash, corruptedHash],
    };
    const before = await store.inventory();
    const report = await new BlobReconciliationService(repository, store).report();
    const after = await store.inventory();

    expect(report.referencedBlobCount).toBe(3);
    expect(report.storedBlobCount).toBe(3);
    expect(report.unreferencedBlobs.map((blob) => blob.sha256)).toEqual([orphanHash]);
    expect(report.missingBlobs).toEqual([missingHash]);
    expect(report.corruptedBlobs.map((blob) => blob.sha256)).toEqual([corruptedHash]);
    expect(before).toEqual(after);
    expect((await store.inspect(orphanHash)).exists).toBe(true);
    expect((await store.inspect(referencedHash)).exists).toBe(true);
    expect((await store.inspect(corruptedHash)).exists).toBe(true);
    expect(report.generatedAt.length).toBeGreaterThan(0);
    expect(dir.length).toBeGreaterThan(0);
  });

  it("returns an empty report when no blob directory or references exist", async () => {
    const { store } = setup();
    const repository = { listBlobStorageKeys: () => [] };
    const report = await new BlobReconciliationService(repository, store).report();

    expect(report.referencedBlobCount).toBe(0);
    expect(report.storedBlobCount).toBe(0);
    expect(report.unreferencedBlobs).toEqual([]);
    expect(report.missingBlobs).toEqual([]);
    expect(report.corruptedBlobs).toEqual([]);
  });
});
