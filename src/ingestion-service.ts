import { extractSource } from "./index.ts";
import { SqliteCoreRepository, type PersistedImport } from "./persistence/sqlite-repository.ts";

export async function ingestFile(
  repository: SqliteCoreRepository,
  bytes: Uint8Array,
  filename: string,
  idempotencyKey: string,
  ocrLanguage?: string,
): Promise<PersistedImport> {
  const extraction = await extractSource(bytes, filename, undefined, { ocrLanguage });
  return repository.saveImport({
    idempotencyKey,
    source: extraction.source,
    extraction,
    extractorId: extraction.extractorId ?? "no-matching-extractor",
    extractorVersion: extraction.extractorVersion ?? "0.0.0",
  });
}
