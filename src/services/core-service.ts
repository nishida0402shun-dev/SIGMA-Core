/**
 * Core Service Layer for SIGMA Core (FR-001 through FR-030).
 * Serves as the single source of truth and unified business logic for UI, API, and MCP adapters.
 */

import { createHash, randomUUID } from "node:crypto";
import type { CoreRepository } from "../persistence/core-repository.ts";
import type { AuthService, AuthContext } from "./auth-service.ts";
import type { BackupService, EncryptedBackupPackage } from "./backup-service.ts";
import type { DeviceQuarantineService, DeviceStatusReport } from "./device-quarantine-service.ts";
import type { LocalBlobStore } from "../persistence/local-blob-store.ts";
import type {
  SourceObject,
  SourceObjectMetadata,
  SourceLocation,
  ExtractedArtifact,
  Workspace,
  SearchQuery,
  SearchHit,
  AuditEvent,
  QuarantineItem,
} from "../models/types.ts";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface IngestObjectInput {
  workspaceId: string;
  name: string;
  bytes: Uint8Array;
  mimeType: string;
  originalPath?: string;
  pages?: Array<{
    pageNumber: number;
    textContent?: string;
    semanticType?: string;
    title?: string;
  }>;
}

export class CoreService {
  readonly #repository: CoreRepository;
  readonly #blobStore: LocalBlobStore;
  readonly #authService: AuthService;
  readonly #backupService: BackupService;
  readonly #deviceQuarantineService: DeviceQuarantineService;

  constructor(
    repository: CoreRepository,
    blobStore: LocalBlobStore,
    authService: AuthService,
    backupService: BackupService,
    deviceQuarantineService: DeviceQuarantineService,
  ) {
    this.#repository = repository;
    this.#blobStore = blobStore;
    this.#authService = authService;
    this.#backupService = backupService;
    this.#deviceQuarantineService = deviceQuarantineService;
  }

  // -------------------------------------------------------------
  // Workspace Operations (FR-005, FR-006)
  // -------------------------------------------------------------
  createWorkspace(auth: AuthContext, workspaceId: string, displayName: string): Workspace {
    if (!workspaceId.trim()) throw new Error("WORKSPACE_ID_REQUIRED");
    const now = new Date().toISOString();
    const ws: Workspace = {
      workspaceId,
      displayName,
      ownerId: auth.subjectId,
      status: "Active",
      createdAt: now,
      updatedAt: now,
    };
    this.#repository.createWorkspace(ws);
    // Grant admin permission to owner
    this.#repository.grantPolicy({
      grantId: `grant_${randomUUID()}`,
      subjectId: auth.subjectId,
      scopeId: workspaceId,
      permission: "admin",
      validFrom: now,
    });
    this.#audit(auth.subjectId, "workspace.create", workspaceId, "Success");
    return ws;
  }

  listWorkspaces(auth: AuthContext): Workspace[] {
    const all = this.#repository.listWorkspaces();
    return all.filter((ws) => this.#authService.hasPermission(auth, ws.workspaceId, "read"));
  }

  // -------------------------------------------------------------
  // Source Object Ingestion (FR-002, FR-003, FR-006, FR-008)
  // -------------------------------------------------------------
  async registerObject(auth: AuthContext, input: IngestObjectInput): Promise<SourceObject> {
    if (!input.workspaceId?.trim()) {
      throw new Error("WORKSPACE_SELECTION_REQUIRED: Explicit workspace selection is mandatory");
    }
    this.#authService.assertPermission(auth, input.workspaceId, "write");

    const contentHash = createHash("sha256").update(input.bytes).digest("hex");
    const existing = this.#repository.findSourceByContentHash(contentHash);
    if (existing && existing.scopeId === input.workspaceId && existing.status === "Active") {
      return existing;
    }

    const objectId = `src_${randomUUID().replace(/-/g, "")}`;
    const now = new Date().toISOString();

    // 1. Store canonical raw bytes
    const blob = await this.#blobStore.put(input.bytes);

    // 2. Register SourceObject
    const metadata: SourceObjectMetadata = {
      name: input.name,
      originalPath: input.originalPath,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      pageCount: input.pages?.length ?? 1,
    };

    const sourceObject: SourceObject = {
      objectId,
      ownerId: auth.subjectId,
      scopeId: input.workspaceId,
      status: "Active",
      version: 1,
      contentHash,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.#repository.saveSourceObject(sourceObject);

    // 3. Register BlobReference
    this.#repository.saveBlobReference({
      blobId: `blob_${randomUUID()}`,
      objectId,
      storageKey: blob.sha256,
      sizeBytes: input.bytes.byteLength,
      mediaType: input.mimeType,
      checksum: contentHash,
      createdAt: now,
    });

    // 4. Save extracted locations & FTS index if pages are provided
    if (input.pages && input.pages.length > 0) {
      const artifactId = `art_${randomUUID()}`;
      const artifact: ExtractedArtifact = {
        artifactId,
        objectId,
        sourceVersion: 1,
        extractorId: "builtin-extractor",
        extractorVersion: "1.0.0",
        status: "complete",
        createdAt: now,
      };

      const locations: SourceLocation[] = input.pages.map((p) => ({
        locationId: `loc_${randomUUID()}`,
        artifactId,
        objectId,
        pageNumber: p.pageNumber,
        textContent: p.textContent,
        semanticType: (p.semanticType as any) || "unknown",
        title: p.title,
        createdAt: now,
      }));

      this.#repository.saveArtifactWithLocations(artifact, locations, input.workspaceId);
    }

    this.#audit(auth.subjectId, "object.register", objectId, "Success", { name: input.name });
    return sourceObject;
  }

  // -------------------------------------------------------------
  // Retrieval & Search (FR-004, FR-007, FR-010, AT-001, AT-002)
  // -------------------------------------------------------------
  search(auth: AuthContext, query: SearchQuery): SearchHit[] {
    this.#authService.assertPermission(auth, query.scopeId, "read");
    // Repository strictly filters for status = 'Active', preventing deleted text leaks
    return this.#repository.searchLocations(query);
  }

  getObject(auth: AuthContext, objectId: string): SourceObject | undefined {
    const object = this.#repository.getSourceObject(objectId);
    if (!object || object.status !== "Active") {
      return undefined; // Fail closed for PendingDeletion and Purged
    }
    this.#authService.assertPermission(auth, object.scopeId, "read");
    return object;
  }

  listObjects(auth: AuthContext, workspaceId: string): SourceObject[] {
    this.#authService.assertPermission(auth, workspaceId, "read");
    return this.#repository.listSourceObjects(workspaceId, ["Active"]);
  }

  async getObjectBytes(auth: AuthContext, objectId: string): Promise<Uint8Array | undefined> {
    const object = this.getObject(auth, objectId);
    if (!object) return undefined;
    const blobRef = this.#repository.getBlobReference(objectId);
    if (!blobRef) return undefined;
    return this.#blobStore.get(blobRef.storageKey);
  }

  getPage(
    auth: AuthContext,
    objectId: string,
    pageNumber: number,
  ): { object: SourceObject; location: SourceLocation } | undefined {
    const object = this.getObject(auth, objectId);
    if (!object) return undefined;
    const location = this.#repository.getPageLocation(objectId, pageNumber);
    if (!location) return undefined;
    return { object, location };
  }

  getSourceLocations(auth: AuthContext, objectId: string): SourceLocation[] {
    const object = this.getObject(auth, objectId);
    if (!object) return [];
    return this.#repository.getSourceLocations(objectId);
  }

  // -------------------------------------------------------------
  // Logical Deletion & 7-Day Restore (FR-012, FR-013, 6.2, AT-001, AT-003, AT-004)
  // -------------------------------------------------------------
  deleteObject(auth: AuthContext, objectId: string, nowUtc = new Date().toISOString()): boolean {
    const object = this.#repository.getSourceObject(objectId);
    if (!object) return false;
    this.#authService.assertPermission(auth, object.scopeId, "delete");

    if (object.status === "PendingDeletion" || object.status === "Purged") {
      return true; // Idempotent
    }

    const updated: SourceObject = {
      ...object,
      status: "PendingDeletion",
      version: object.version + 1,
      updatedAt: nowUtc,
    };
    this.#repository.saveSourceObject(updated);

    this.#audit(auth.subjectId, "object.delete.logical", objectId, "Success");
    return true;
  }

  restoreObject(auth: AuthContext, objectId: string, nowUtc = new Date().toISOString()): boolean {
    const object = this.#repository.getSourceObject(objectId);
    if (!object) return false;
    this.#authService.assertPermission(auth, object.scopeId, "restore");

    if (object.status === "Active") return true; // Idempotent
    if (object.status !== "PendingDeletion") return false;

    // Rule 6.2: Must be within 7-day recovery window
    const deletedTimeMs = new Date(object.updatedAt).getTime();
    const nowMs = new Date(nowUtc).getTime();
    if (nowMs - deletedTimeMs > SEVEN_DAYS_MS) {
      this.#audit(auth.subjectId, "object.restore", objectId, "Denied", { reason: "RESTORE_WINDOW_EXPIRED" });
      throw new Error("RESTORE_WINDOW_EXPIRED: 7-day recovery window has passed; item cannot be restored");
    }

    const updated: SourceObject = {
      ...object,
      status: "Active",
      version: object.version + 1,
      updatedAt: nowUtc,
    };
    this.#repository.saveSourceObject(updated);
    this.#audit(auth.subjectId, "object.restore", objectId, "Success");
    return true;
  }

  // -------------------------------------------------------------
  // Full Purge & Tombstones (FR-014, FR-015, FR-016, FR-017, 6.3, 6.4, AT-005, AT-007)
  // -------------------------------------------------------------
  async purgeObject(auth: AuthContext, objectId: string, nowUtc = new Date().toISOString()): Promise<boolean> {
    const object = this.#repository.getSourceObject(objectId);
    if (!object) return false;
    this.#authService.assertPermission(auth, object.scopeId, "delete");

    // Idempotent after a completed purge; never purge an active object directly.
    if (object.status === "Purged") return true;
    if (object.status !== "PendingDeletion") {
      throw new Error("PURGE_REQUIRES_PENDING_DELETION: Object must be logically deleted first");
    }

    const deletedAtMs = new Date(object.updatedAt).getTime();
    const nowMs = new Date(nowUtc).getTime();
    if (!Number.isFinite(deletedAtMs) || !Number.isFinite(nowMs) || nowMs - deletedAtMs < SEVEN_DAYS_MS) {
      throw new Error("PURGE_RETENTION_NOT_ELAPSED: The 7-day restore window must expire before purge");
    }

    // Delete the blob first. A failed storage deletion must not be hidden or followed
    // by removal of the DB reference; callers can safely retry after fixing storage.
    const blobRef = this.#repository.getBlobReference(objectId);
    if (blobRef) {
      const deleted = await this.#blobStore.delete(blobRef.storageKey);
      if (!deleted) {
        this.#audit(auth.subjectId, "object.purge", objectId, "Failed", { reason: "BLOB_DELETE_FAILED" });
        throw new Error("BLOB_DELETE_FAILED: Source blob could not be deleted; purge remains retryable");
      }
    }

    // Only remove database-derived data after storage confirms deletion.
    this.#repository.purgeObjectData(objectId);

    this.#repository.saveDeletionRecord({
      objectId,
      deletionVersion: object.version,
      deletedAt: nowUtc,
      propagationState: "Pending",
      backupExpiryState: "Active",
    });

    this.#audit(auth.subjectId, "object.purge", objectId, "Success");
    return true;
  }

  // -------------------------------------------------------------
  // Backup & Restore (FR-018, FR-019, AT-006)
  // -------------------------------------------------------------
  async createBackup(auth: AuthContext, encryptionKeyHex: string, scopeId?: string): Promise<EncryptedBackupPackage> {
    if (scopeId) {
      this.#authService.assertPermission(auth, scopeId, "read");
    }
    const backup = await this.#backupService.createEncryptedBackup(encryptionKeyHex, this.#blobStore, scopeId);
    this.#audit(auth.subjectId, "backup.create", scopeId ?? "all", "Success");
    return backup;
  }

  async restoreBackup(auth: AuthContext, backup: EncryptedBackupPackage, encryptionKeyHex: string): Promise<{ restored: number; skipped: number }> {
    const res = await this.#backupService.restoreEncryptedBackup(backup, encryptionKeyHex, this.#blobStore);
    this.#audit(auth.subjectId, "backup.restore", "system", "Success", { ...res });
    return { restored: res.restoredObjectCount, skipped: res.skippedDeletedCount };
  }

  // -------------------------------------------------------------
  // Device & Quarantine (FR-020 to FR-027, AT-009 to AT-018)
  // -------------------------------------------------------------
  syncDevice(deviceId: string, userId: string, nowUtc = new Date().toISOString()): DeviceStatusReport {
    let device = this.#repository.getDevice(deviceId);
    if (!device) {
      device = this.#repository.saveDevice({
        deviceId,
        userId,
        status: "Active",
        lastSuccessfulSyncAt: nowUtc,
        credentialVersion: 1,
      });
    }

    const report = this.#deviceQuarantineService.evaluateDeviceStatus(deviceId, nowUtc);
    if (report.isRevoked) {
      throw new Error(`DEVICE_REVOKED: Device ${deviceId} is revoked and cannot sync.`);
    }

    this.#repository.updateDeviceSyncTime(deviceId, nowUtc);
    return report;
  }

  quarantineData(
    deviceId: string,
    objectId: string,
    version: number,
    payload: Record<string, unknown>,
    nowUtc = new Date().toISOString(),
  ): QuarantineItem {
    return this.#deviceQuarantineService.quarantineIncomingItem(deviceId, objectId, version, payload, nowUtc);
  }

  listQuarantined(auth: AuthContext, deviceId?: string): QuarantineItem[] {
    const items = this.#repository.listQuarantineItems(deviceId, ["Quarantined"]);
    return items.filter((item) => {
      const payloadObject = item.payload.object;
      if (!payloadObject || typeof payloadObject !== "object") return false;
      const scopeId = (payloadObject as { scopeId?: unknown }).scopeId;
      if (typeof scopeId !== "string" || !scopeId) return false;
      return this.#authService.hasPermission(auth, scopeId, "read");
    });
  }

  recoverQuarantinedItem(auth: AuthContext, quarantineId: string, nowUtc = new Date().toISOString()): boolean {
    const item = this.#repository.getQuarantineItem(quarantineId);
    if (!item || item.status !== "Quarantined") return false;
    const payloadObject = item.payload.object;
    if (!payloadObject || typeof payloadObject !== "object") {
      throw new Error("QUARANTINE_SCOPE_UNKNOWN: Cannot recover data without a validated Workspace scope");
    }
    const candidate = payloadObject as { objectId?: unknown; scopeId?: unknown };
    if (candidate.objectId !== item.objectId || typeof candidate.scopeId !== "string" || !candidate.scopeId) {
      throw new Error("QUARANTINE_PAYLOAD_INVALID: Object identity and Workspace scope must match the quarantine record");
    }
    this.#authService.assertPermission(auth, candidate.scopeId, "write");
    const res = this.#deviceQuarantineService.recoverQuarantineItem(quarantineId, nowUtc);
    this.#audit(auth.subjectId, "quarantine.recover", quarantineId, res.success ? "Success" : "Failed", { reason: res.reason });
    return res.success;
  }

  // -------------------------------------------------------------
  // Internal Helpers
  // -------------------------------------------------------------
  #audit(
    actorId: string,
    action: string,
    targetId: string,
    outcome: "Success" | "Denied" | "Failed",
    details?: Record<string, unknown>,
  ): void {
    this.#repository.recordAuditEvent({
      eventId: `aud_${randomUUID()}`,
      actorId,
      action,
      targetId,
      timestamp: new Date().toISOString(),
      outcome,
      details,
    });
  }
}
