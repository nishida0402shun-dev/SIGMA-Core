import { extractSource } from "./index.ts";
import { SqliteCoreRepository, type PersistedImport } from "./persistence/sqlite-repository.ts";

export function ingestFile(repository: SqliteCoreRepository, bytes: Uint8Array, filename: string, idempotencyKey: string): PersistedImport {
  const extraction = extractSource(bytes, filename);
  return repository.saveImport({
    idempotencyKey,
    source: extraction.source,
    extraction,
    extractorId: extraction.status === "complete" ? "plain-text" : "no-matching-extractor",
    extractorVersion: "0.1.0",
  });
}
