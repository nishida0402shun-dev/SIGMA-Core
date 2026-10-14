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
    let restoredObjectCount = 0;
    let skippedDeletedCount = 0;
    const restoredObjectIds = new Set<string>();

    for (const obj of payload.objects) {
      // A backup must never reactivate an object that was already pending deletion.
      if (obj.status !== "Active") {
        skippedDeletedCount++;
        continue;
      }

      // Check DeletionRecord (Tombstone)
      const tombstone = this.#repository.getDeletionRecord(obj.objectId);
      if (tombstone) {
        // If a deletion record exists, do NOT revive the object!
        skippedDeletedCount++;
        continue;
      }

      // Check current state in DB if exists
      const existing = this.#repository.getSourceObject(obj.objectId);
      if (existing) {
        // Never overwrite an existing canonical object or duplicate its child rows.
        skippedDeletedCount++;
        continue;
      }

      this.#repository.saveSourceObject({
        ...obj,
        updatedAt: nowUtc,
      });
      restoredObjectCount++;
      restoredObjectIds.add(obj.objectId);
    }

    const blobDataByObjectId = new Map((payload.blobData ?? []).map((entry) => [entry.objectId, entry]));
    for (const blob of payload.blobs) {
      if (!restoredObjectIds.has(blob.objectId)) continue;
      const source = blobDataByObjectId.get(blob.objectId);
      if (!source || source.checksum !== blob.checksum) {
        throw new Error(`Backup blob payload missing or checksum mismatch for object ${blob.objectId}`);
      }
      const bytes = Buffer.from(source.bytesBase64, "base64");
      const stored = await blobStore.put(bytes, blob.checksum);
      this.#repository.saveBlobReference({ ...blob, storageKey: stored.path });
    }

    // Restore extracted artifact metadata and page-level provenance after the
    // canonical object is restored. Payloads from older backups may omit these arrays.
    for (const artifact of payload.artifacts ?? []) {
      if (!restoredObjectIds.has(artifact.objectId)) continue;
      const object = this.#repository.getSourceObject(artifact.objectId);
      if (!object || object.status !== "Active") continue;
      const locations = (payload.locations ?? []).filter((location) =>
        location.objectId === artifact.objectId && location.artifactId === artifact.artifactId,
      );
      this.#repository.saveArtifactWithLocations(artifact, locations, object.scopeId);
    }

    return { restoredObjectCount, skippedDeletedCount };
  }
}
