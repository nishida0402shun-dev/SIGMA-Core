/**
 * Client-Side Encrypted Backup & Restore Service for SIGMA Core (FR-018, FR-019, AT-006, AT-008).
 * Uses AES-256-GCM for strong authenticated encryption.
 * Enforces tombstone deletion records on restore to prevent resurrecting deleted objects.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import type { CoreRepository } from "../persistence/core-repository.ts";
import type { SourceObject, BlobReference, ExtractedArtifact, SourceLocation } from "../models/types.ts";
import type { LocalBlobStore } from "../persistence/local-blob-store.ts";

export interface EncryptedBackupPackage {
  version: 1;
  ivHex: string;
  authTagHex: string;
  encryptedDataHex: string;
  backupCreatedAt: string;
  checksumSha256: string;
}

export interface BackupPayload {
  objects: SourceObject[];
  blobs: BlobReference[];
  blobData?: Array<{ objectId: string; checksum: string; bytesBase64: string }>;
  artifacts: ExtractedArtifact[];
  locations: SourceLocation[];
}

export class BackupService {
  readonly #repository: CoreRepository;

  constructor(repository: CoreRepository) {
    this.#repository = repository;
  }

  /**
   * Generates a client-side encrypted backup package using AES-256-GCM.
   */
  async createEncryptedBackup(encryptionKeyHex: string, blobStore: LocalBlobStore, scopeId?: string): Promise<EncryptedBackupPackage> {
    const key = Buffer.from(encryptionKeyHex, "hex");
    if (key.length !== 32) {
      throw new Error("Invalid encryption key length: AES-256 requires 32 bytes (64 hex characters)");
    }

    // Export non-purged source objects (only Active and PendingDeletion)
    const objects = scopeId
      ? this.#repository.listSourceObjects(scopeId, ["Active"])
      : this.#repository.listWorkspaces().flatMap((ws) =>
          this.#repository.listSourceObjects(ws.workspaceId, ["Active"]),
        );

    const blobs: BlobReference[] = [];
    const artifacts: ExtractedArtifact[] = [];
    const locations: SourceLocation[] = [];
    const blobData: NonNullable<BackupPayload["blobData"]> = [];

    for (const obj of objects) {
      const blob = this.#repository.getBlobReference(obj.objectId);
      if (blob) {
        blobs.push(blob);
        const bytes = await blobStore.get(blob.checksum);
        blobData.push({ objectId: obj.objectId, checksum: blob.checksum, bytesBase64: bytes.toString("base64") });
      }
      artifacts.push(...this.#repository.listExtractedArtifacts(obj.objectId));
      const locs = this.#repository.getSourceLocations(obj.objectId);
      locations.push(...locs);
    }

    const payload: BackupPayload = {
      objects,
      blobs,
      blobData,
      artifacts,
      locations,
    };

    const payloadBuffer = Buffer.from(JSON.stringify(payload), "utf-8");
    const checksumSha256 = createHash("sha256").update(payloadBuffer).digest("hex");

    const iv = randomBytes(12); // 96-bit IV for AES-GCM
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(payloadBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const backupCreatedAt = new Date().toISOString();

    return {
      version: 1,
      ivHex: iv.toString("hex"),
      authTagHex: authTag.toString("hex"),
      encryptedDataHex: encrypted.toString("hex"),
      backupCreatedAt,
      checksumSha256,
    };
  }

  /**
   * Restores data from an encrypted backup package.
   * CRITICAL: Applies tombstone records (DeletionRecord) so that deleted data is NOT resurrected!
   */
  async restoreEncryptedBackup(
    backup: EncryptedBackupPackage,
    encryptionKeyHex: string,
    blobStore: LocalBlobStore,
    nowUtc = new Date().toISOString(),
  ): Promise<{ restoredObjectCount: number; skippedDeletedCount: number }> {
    const key = Buffer.from(encryptionKeyHex, "hex");
    const iv = Buffer.from(backup.ivHex, "hex");
    const authTag = Buffer.from(backup.authTagHex, "hex");
    const encrypted = Buffer.from(backup.encryptedDataHex, "hex");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    const actualChecksum = createHash("sha256").update(decrypted).digest("hex");
    if (actualChecksum !== backup.checksumSha256) {
      throw new Error("Backup integrity verification failed: Checksum mismatch");
    }

    const payload = JSON.parse(decrypted.toString("utf-8")) as BackupPayload;

    // Validate the entire package before the first canonical DB write. A valid GCM
    // tag proves possession of the backup key, not that the payload is structurally
    // complete or internally consistent.
    if (
      !payload ||
      !Array.isArray(payload.objects) ||
      !Array.isArray(payload.blobs) ||
      (payload.artifacts !== undefined && !Array.isArray(payload.artifacts)) ||
      (payload.locations !== undefined && !Array.isArray(payload.locations)) ||
      (payload.blobData !== undefined && !Array.isArray(payload.blobData))
    ) {
      throw new Error("BACKUP_PAYLOAD_INVALID: Required backup collections are missing or invalid");
    }

    const objectIds = new Set<string>();
    for (const obj of payload.objects) {
      if (
        !obj || typeof obj.objectId !== "string" || !obj.objectId ||
        typeof obj.scopeId !== "string" || !obj.scopeId ||
        typeof obj.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(obj.contentHash) ||
        !["Active", "PendingDeletion", "Purging", "Purged"].includes(obj.status)
      ) {
        throw new Error("BACKUP_PAYLOAD_INVALID: Source object metadata is invalid");
      }
      if (objectIds.has(obj.objectId)) {
        throw new Error("BACKUP_PAYLOAD_INVALID: Duplicate source object identity");
      }
      objectIds.add(obj.objectId);
    }

    const blobsByObjectId = new Map<string, BlobReference>();
    for (const blob of payload.blobs) {
      if (
        !blob || typeof blob.objectId !== "string" ||
        !objectIds.has(blob.objectId) ||
        typeof blob.checksum !== "string" || !/^[a-f0-9]{64}$/.test(blob.checksum) ||
        blobsByObjectId.has(blob.objectId)
      ) {
        throw new Error("BACKUP_PAYLOAD_INVALID: Blob reference is invalid or duplicated");
      }
      blobsByObjectId.set(blob.objectId, blob);
    }

    const blobDataByObjectId = new Map<string, NonNullable<BackupPayload["blobData"]>[number]>();
    for (const entry of payload.blobData ?? []) {
      if (
        !entry || typeof entry.objectId !== "string" ||
        !objectIds.has(entry.objectId) ||
        typeof entry.checksum !== "string" || !/^[a-f0-9]{64}$/.test(entry.checksum) ||
        typeof entry.bytesBase64 !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.bytesBase64) ||
        blobDataByObjectId.has(entry.objectId)
      ) {
        throw new Error("BACKUP_PAYLOAD_INVALID: Blob data is invalid or duplicated");
      }
      blobDataByObjectId.set(entry.objectId, entry);
    }

    // Every active object that may be restored must have a matching, verified blob.
    // Verify all candidates up front so a later malformed entry cannot leave earlier
    // source objects committed without their binary data.
    const verifiedBlobBytes = new Map<string, Buffer>();
    for (const obj of payload.objects) {
      if (obj.status !== "Active" || this.#repository.getDeletionRecord(obj.objectId) || this.#repository.getSourceObject(obj.objectId)) {
        continue;
      }
      const blob = blobsByObjectId.get(obj.objectId);
      const source = blobDataByObjectId.get(obj.objectId);
      if (!blob || !source || source.checksum !== blob.checksum || blob.checksum !== obj.contentHash) {
        throw new Error(`BACKUP_PAYLOAD_INVALID: Missing or inconsistent blob data for object ${obj.objectId}`);
      }
      const bytes = Buffer.from(source.bytesBase64, "base64");
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash !== blob.checksum) {
        throw new Error(`BACKUP_PAYLOAD_INVALID: Blob checksum mismatch for object ${obj.objectId}`);
      }
      verifiedBlobBytes.set(obj.objectId, bytes);
    }

    let restoredObjectCount = 0;
    let skippedDeletedCount = 0;
    const restoredObjectIds = new Set<string>();

    // Stage verified content-addressed blobs before touching canonical metadata.
    // Filesystem writes may leave harmless unreferenced blobs if the DB transaction
    // fails; canonical metadata, references, artifacts, locations, and FTS updates
    // are committed or rolled back together below.
    const stagedStorageKeys = new Map<string, string>();
    for (const obj of payload.objects) {
      if (obj.status !== "Active" || this.#repository.getDeletionRecord(obj.objectId) || this.#repository.getSourceObject(obj.objectId)) {
        continue;
      }
      const bytes = verifiedBlobBytes.get(obj.objectId);
      const blob = blobsByObjectId.get(obj.objectId);
      if (!bytes || !blob) {
        throw new Error(`BACKUP_PAYLOAD_INVALID: Verified blob unavailable for object ${obj.objectId}`);
      }
      const stored = await blobStore.put(bytes, blob.checksum);
      stagedStorageKeys.set(obj.objectId, stored.sha256);
    }

    this.#repository.transaction(() => {
      // Recheck canonical state inside the transaction to avoid resurrecting a
      // tombstoned object or overwriting an object created after preflight.
      for (const obj of payload.objects) {
        if (obj.status !== "Active") {
          skippedDeletedCount++;
          continue;
        }
        if (this.#repository.getDeletionRecord(obj.objectId) || this.#repository.getSourceObject(obj.objectId)) {
          skippedDeletedCount++;
          continue;
        }

        const storageKey = stagedStorageKeys.get(obj.objectId);
        const blob = blobsByObjectId.get(obj.objectId);
        if (!storageKey || !blob) {
          throw new Error(`BACKUP_PAYLOAD_INVALID: Staged blob unavailable for object ${obj.objectId}`);
        }

        this.#repository.saveSourceObject({ ...obj, updatedAt: nowUtc });
        this.#repository.saveBlobReference({ ...blob, storageKey });
        restoredObjectCount++;
        restoredObjectIds.add(obj.objectId);
      }

      // Child records and their search/provenance updates share the same DB
      // transaction as their parent source objects and blob references.
      for (const artifact of payload.artifacts ?? []) {
        if (!artifact || !restoredObjectIds.has(artifact.objectId)) continue;
        const object = this.#repository.getSourceObject(artifact.objectId);
        if (!object || object.status !== "Active") continue;
        const locations = (payload.locations ?? []).filter((location) =>
          location.objectId === artifact.objectId && location.artifactId === artifact.artifactId,
        );
        this.#repository.saveArtifactWithLocations(artifact, locations, object.scopeId);
      }
    });

    return { restoredObjectCount, skippedDeletedCount };
  }
}
