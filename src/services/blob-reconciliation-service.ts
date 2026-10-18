import type { CoreRepository } from "../persistence/core-repository.ts";
import type { LocalBlobStore } from "../persistence/local-blob-store.ts";

export interface BlobReconciliationReport {
  generatedAt: string;
  referencedBlobCount: number;
  storedBlobCount: number;
  unreferencedBlobs: Array<{ sha256: string; byteLength: number; path: string }>;
  missingBlobs: string[];
  corruptedBlobs: Array<{ sha256: string; byteLength: number; path: string }>;
}

/**
 * Read-only consistency report for the SQLite blob references and local content store.
 * This service deliberately never deletes, rewrites, or repairs files or database rows.
 */
export class BlobReconciliationService {
  readonly #repository: Pick<CoreRepository, "listBlobStorageKeys">;
  readonly #blobStore: Pick<LocalBlobStore, "inventory">;

  constructor(
    repository: Pick<CoreRepository, "listBlobStorageKeys">,
    blobStore: Pick<LocalBlobStore, "inventory">,
  ) {
    this.#repository = repository;
    this.#blobStore = blobStore;
  }

  async report(): Promise<BlobReconciliationReport> {
    const [referencedKeys, storedBlobs] = await Promise.all([
      Promise.resolve(this.#repository.listBlobStorageKeys()),
      this.#blobStore.inventory(),
    ]);
    const referenced = new Set(referencedKeys);
    const storedByHash = new Map(storedBlobs.map((blob) => [blob.sha256, blob]));

    return {
      generatedAt: new Date().toISOString(),
      referencedBlobCount: referenced.size,
      storedBlobCount: storedBlobs.length,
      unreferencedBlobs: storedBlobs
        .filter((blob) => !referenced.has(blob.sha256))
        .map(({ sha256, byteLength, path }) => ({ sha256, byteLength, path })),
      missingBlobs: [...referenced]
        .filter((sha256) => !storedByHash.has(sha256))
        .sort(),
      corruptedBlobs: storedBlobs
        .filter((blob) => !blob.integrityValid)
        .map(({ sha256, byteLength, path }) => ({ sha256, byteLength, path })),
    };
  }
}
