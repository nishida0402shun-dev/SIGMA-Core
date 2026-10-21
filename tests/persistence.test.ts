import { afterEach, describe, expect, it } from "./test-shim.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteCoreRepository } from "../src/persistence/sqlite-repository.ts";
import { ingestFile } from "../src/ingestion-service.ts";
import { makePdf } from "./pdf-fixture.ts";

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
  it("writes source and extraction metadata and reads it back", async () => {
    const repository = setup();
    const result = await ingestFile(repository, Buffer.from("hello"), "note.txt", "job-001");
    const loaded = repository.getImportByKey("job-001");
    expect(loaded?.id).toBe(result.id);
    expect(loaded?.source.sha256).toBe(result.source.sha256);
    expect(loaded?.extraction.text).toBe("hello");
  });
  it("returns the same record for an identical retry", async () => {
    const repository = setup();
    const bytes = Buffer.from("retry-safe");
    const first = await ingestFile(repository, bytes, "a.txt", "same-key");
    const second = await ingestFile(repository, bytes, "a.txt", "same-key");
    expect(second.id).toBe(first.id);
  });
  it("rejects a key reused for different source bytes", async () => {
    const repository = setup();
    await ingestFile(repository, Buffer.from("first"), "a.txt", "same-key");
    await expect(ingestFile(repository, Buffer.from("second"), "a.txt", "same-key"))
      .rejects.toThrow("Idempotency key conflict");
  });
  it("extracts and persists merged PDF text through the legacy import repository", async () => {
    const repository = setup();
    const result = await ingestFile(
      repository,
      makePdf({ pages: ["persisted page one", "persisted page two"] }),
      "document.pdf",
      "pdf-job",
    );
    expect(result.extraction.status).toBe("complete");
    // The legacy import repository stores merged text only; page provenance is
    // available from CoreService/CoreRepository, not from this compatibility table.
    expect(result.extraction.pages.length).toBe(0);
    expect(result.extractorId).toBe("builtin-pdf");
    expect(result.extraction.text?.includes("persisted page two")).toBe(true);
  });
  it("records a malformed PDF as failed without throwing through the caller", async () => {
    const repository = setup();
    const result = await ingestFile(repository, Buffer.from("%PDF-1.7"), "document.pdf", "pdf-broken");
    expect(result.extraction.status).toBe("failed");
    expect(result.extraction.text).toBeUndefined();
    expect(result.extractorId).toBe("builtin-pdf");
  });
});
