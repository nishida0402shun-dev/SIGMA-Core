import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredBlob {
  sha256: string;
  byteLength: number;
  path: string;
  created: boolean;
}

export interface StoredBlobInventoryItem {
  sha256: string;
  byteLength: number;
  path: string;
  integrityValid: boolean;
}

/**
 * Immutable content-addressed storage. Paths are derived only from a validated SHA-256,
 * never from caller-supplied filenames. This adapter does not delete blobs during inventory.
 */
export class LocalBlobStore {
  readonly #root: string;

  constructor(rootDirectory: string) {
    if (!rootDirectory.trim()) throw new Error("rootDirectory must not be empty");
    this.#root = rootDirectory;
  }

  async put(bytes: Uint8Array, expectedSha256?: string): Promise<StoredBlob> {
    const snapshot = Buffer.from(bytes);
    const sha256 = createHash("sha256").update(snapshot).digest("hex");
    if (expectedSha256 !== undefined && expectedSha256 !== sha256) {
      throw new Error("Blob SHA-256 does not match expected hash");
    }

    const destination = this.#pathFor(sha256);
    await mkdir(dirname(destination), { recursive: true });
    try {
      const existing = await readFile(destination);
      this.#verify(existing, sha256);
      return { sha256, byteLength: existing.byteLength, path: destination, created: false };
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    const temporary = join(dirname(destination), ".tmp-" + randomUUID());
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(snapshot);
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await rename(temporary, destination);
      } catch (error) {
        // Another writer may have won the race. Accept only a byte-for-byte valid blob.
        if (!isAlreadyExists(error)) throw error;
        const existing = await readFile(destination);
        this.#verify(existing, sha256);
        return { sha256, byteLength: existing.byteLength, path: destination, created: false };
      }
      const stored = await readFile(destination);
      this.#verify(stored, sha256);
      return { sha256, byteLength: stored.byteLength, path: destination, created: true };
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      // A failed operation may leave a temporary file; cleanup is restricted to this
      // operation's uniquely generated temporary path, never to stored source blobs.
      const { unlink } = await import("node:fs/promises");
      await unlink(temporary).catch(() => undefined);
    }
  }

  async get(sha256: string): Promise<Buffer> {
    const path = this.#pathFor(sha256);
    const bytes = await readFile(path);
    this.#verify(bytes, sha256);
    return bytes;
  }

  async delete(sha256: string): Promise<boolean> {
    // Never accept caller-supplied filesystem paths. Resolve only validated
    // content hashes so path traversal cannot delete files outside the blob root.
    const targetPath = this.#pathFor(sha256);
    try {
      await rm(targetPath, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  async inspect(sha256: string): Promise<{ exists: boolean; byteLength?: number }> {
    const path = this.#pathFor(sha256);
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error("Stored blob path is not a regular file");
      return { exists: true, byteLength: info.size };
    } catch (error) {
      if (isNotFound(error)) return { exists: false };
      throw error;
    }
  }

  /**
   * Enumerates only files in the canonical SHA-256 layout. Temporary files and
   * unexpected paths are intentionally ignored; this method never mutates storage.
   */
  async inventory(): Promise<StoredBlobInventoryItem[]> {
    const items: StoredBlobInventoryItem[] = [];
    let firstLevel;
    try {
      firstLevel = await readdir(this.#root, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }

    for (const first of firstLevel) {
      if (!first.isDirectory() || !/^[a-f0-9]{2}$/.test(first.name)) continue;
      const firstPath = join(this.#root, first.name);
      for (const second of await readdir(firstPath, { withFileTypes: true })) {
        if (!second.isDirectory() || !/^[a-f0-9]{2}$/.test(second.name)) continue;
        const secondPath = join(firstPath, second.name);
        for (const entry of await readdir(secondPath, { withFileTypes: true })) {
          if (!entry.isFile() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
          const sha256 = entry.name;
          if (!sha256.startsWith(first.name + second.name)) continue;
          const path = join(secondPath, entry.name);
          const bytes = await readFile(path);
          const actual = createHash("sha256").update(bytes).digest("hex");
          items.push({
            sha256,
            byteLength: bytes.byteLength,
            path,
            integrityValid: actual === sha256,
          });
        }
      }
    }
    return items.sort((a, b) => a.sha256.localeCompare(b.sha256));
  }

  #pathFor(sha256: string): string {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid SHA-256 value");
    return join(this.#root, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }

  #verify(bytes: Uint8Array, expected: string): void {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) throw new Error("Stored blob integrity check failed");
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error.code === "EEXIST" || error.code === "ENOTEMPTY");
}
