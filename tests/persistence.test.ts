import { afterEach, describe, expect, it } from "./test-shim.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteCoreRepository } from "../src/persistence/sqlite-repository.ts";
import { ingestFile } from "../src/ingestion-service.ts";

const dirs: string[] = [];
const repositories: SqliteCoreRepository[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sigma-core-test-"));
  dirs.push(dir);
  const repository = new SqliteCoreRepository(join(dir, "core.sqlite"));
  repositories.push(repository);
  return repository;
}
afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SQLite persistence", () => {
  it("writes source and extraction metadata and reads it back", () => {
    const repository = setup();
    const result = ingestFile(repository, Buffer.from("hello"), "note.txt", "job-001");
    const loaded = repository.getImportByKey("job-001");
    expect(loaded?.id).toBe(result.id);
    expect(loaded?.source.sha256).toBe(result.source.sha256);
    expect(loaded?.extraction.text).toBe("hello");
  });
  it("returns the same record for an identical retry", () => {
    const repository = setup();
    const bytes = Buffer.from("retry-safe");
    const first = ingestFile(repository, bytes, "a.txt", "same-key");
    const second = ingestFile(repository, bytes, "a.txt", "same-key");
    expect(second.id).toBe(first.id);
  });
  it("rejects a key reused for different source bytes", () => {
    const repository = setup();
    ingestFile(repository, Buffer.from("first"), "a.txt", "same-key");
    expect(() => ingestFile(repository, Buffer.from("second"), "a.txt", "same-key"))
      .toThrow("Idempotency key conflict");
  });
  it("records PDF as failed until a PDF extractor exists", () => {
    const repository = setup();
    const result = ingestFile(repository, Buffer.from("%PDF-1.7"), "document.pdf", "pdf-job");
    expect(result.extraction.status).toBe("failed");
    expect(result.extraction.text).toBeUndefined();
  });
});
