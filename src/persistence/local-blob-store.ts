import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredBlob {
  sha256: string;
  byteLength: number;
  path: string;
  created: boolean;
}

/**
 * Immutable content-addressed storage. Paths are derived only from a validated SHA-256,
 * never from caller-supplied filenames. This adapter does not delete blobs.
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
