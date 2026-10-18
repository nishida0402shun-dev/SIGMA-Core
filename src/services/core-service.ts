/**
 * Core Service Layer for SIGMA Core (FR-001 through FR-030).
 * Serves as the single source of truth and unified business logic for UI, API, and MCP adapters.
 */

import { createHash, randomUUID } from "node:crypto";
import { extractSource } from "../extraction.ts";
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

    // Caller-provided pages are accepted for compatibility but are explicitly marked as
    // externally supplied. If pages are omitted, only a registered, tested extractor may
    // produce indexed text; currently that means valid UTF-8 plain text (not PDF extraction).
    const extraction = input.pages === undefined ? extractSource(input.bytes, input.name) : undefined;
    const pages = input.pages ?? (
      extraction?.status === "complete" && extraction.text?.trim()
        ? [{ pageNumber: 1, textContent: extraction.text, semanticType: "unknown" }]
        : undefined
    );
    const extractorId = input.pages !== undefined
      ? "caller-provided-pages"
      : extraction?.status === "complete" && pages?.length
        ? `builtin-${extraction.source.detected.format}`
        : undefined;

    const contentHash = createHash("sha256").update(input.bytes).digest("hex");
    const existing = this.#repository.findSourceByContentHash(contentHash);
    if (existing && existing.scopeId === input.workspaceId && existing.status === "Active") {
      return existing;
    }

    const objectId = `src_${randomUUID().replace(/-/g, "")}`;
    const now = new Date().toISOString();

    // 1. Store canonical raw bytes
    const blob = await this.#blobStore.put(input.bytes);

    // Keep all canonical metadata in one SQLite transaction. The blob write is
    // intentionally outside this transaction because filesystem and SQLite cannot
    // share an atomic commit; a failed DB transaction may leave an unreferenced blob,
    // but it must never leave a partially registered source object.
    const registeredObject = this.#repository.transaction(() => {
      // 2. Register SourceObject
      const metadata: SourceObjectMetadata = {
        name: input.name,
        originalPath: input.originalPath,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        pageCount: pages?.length ?? 0,
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

      // 4. Save extracted locations & FTS index with explicit provenance.
      if (pages && pages.length > 0 && extractorId) {
        const artifactId = `art_${randomUUID()}`;
        const artifact: ExtractedArtifact = {
          artifactId,
          objectId,
          sourceVersion: 1,
          extractorId,
          extractorVersion: extractorId === "caller-provided-pages" ? "external-1" : "1.0.0",
          status: "complete",
          createdAt: now,
        };

        const locations: SourceLocation[] = pages.map((p) => ({
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
    });
    return registeredObject;
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
    } else if (!auth?.isSuperAdmin) {
      throw new Error("SUPER_ADMIN_REQUIRED: System-wide backup requires super-admin authorization");
    }
    const backup = await this.#backupService.createEncryptedBackup(encryptionKeyHex, this.#blobStore, scopeId);
    this.#audit(auth.subjectId, "backup.create", scopeId ?? "all", "Success");
    return backup;
  }

  async restoreBackup(auth: AuthContext, backup: EncryptedBackupPackage, encryptionKeyHex: string): Promise<{ restored: number; skipped: number }> {
    // A backup package has no trusted scope binding, and restore mutates canonical data.
    // Require a super-admin until scoped restore packages and impact checks are implemented.
    if (!auth?.isSuperAdmin) {
      throw new Error("SUPER_ADMIN_REQUIRED: Backup restore requires super-admin authorization");
    }
    const res = await this.#backupService.restoreEncryptedBackup(backup, encryptionKeyHex, this.#blobStore);
    this.#audit(auth.subjectId, "backup.restore", "system", "Success", { ...res });
    return { restored: res.restoredObjectCount, skipped: res.skippedDeletedCount };
  }

  // -------------------------------------------------------------
  // Device & Quarantine (FR-020 to FR-027, AT-009 to AT-018)
  // -------------------------------------------------------------
  syncDevice(auth: AuthContext, deviceId: string, userId: string, nowUtc = new Date().toISOString()): DeviceStatusReport {
    if (!auth?.subjectId?.trim()) {
      throw new Error("AUTHENTICATION_REQUIRED");
    }
    if (!deviceId?.trim() || !userId?.trim()) {
      throw new Error("DEVICE_ID_AND_USER_ID_REQUIRED");
    }
    if (auth.subjectId !== userId) {
      this.#audit(auth.subjectId, "device.sync", deviceId, "Denied", { reason: "AUTHENTICATED_USER_MISMATCH" });
      throw new Error("AUTHENTICATED_USER_MISMATCH: userId must match the authenticated subject");
    }

    let device = this.#repository.getDevice(deviceId);
    if (device && device.userId !== userId) {
      // Do not allow a caller to refresh another user's device merely by
      // presenting its device ID. Authentication of userId still belongs to
      // the trusted transport/identity boundary and must be verified there.
      this.#audit("unverified-device-sync", "device.sync", deviceId, "Denied", { reason: "DEVICE_OWNER_MISMATCH" });
      throw new Error("DEVICE_OWNER_MISMATCH: Device does not belong to the supplied user");
    }

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
    auth: AuthContext,
    deviceId: string,
    objectId: string,
    version: number,
    payload: Record<string, unknown>,
    nowUtc = new Date().toISOString(),
  ): QuarantineItem {
    if (!auth?.subjectId?.trim()) {
      throw new Error("AUTHENTICATION_REQUIRED");
    }
    if (!deviceId?.trim() || !objectId?.trim() || !Number.isInteger(version) || version < 1) {
      throw new Error("QUARANTINE_REQUEST_INVALID: Device, object, and positive integer source version are required");
    }

    const device = this.#repository.getDevice(deviceId);
    if (!device) {
      throw new Error("DEVICE_NOT_REGISTERED");
    }
    if (device.userId !== auth.subjectId) {
      this.#audit(auth.subjectId, "quarantine.register", deviceId, "Denied", { reason: "DEVICE_OWNER_MISMATCH" });
      throw new Error("DEVICE_OWNER_MISMATCH: Device does not belong to the authenticated subject");
    }

    const object = payload?.object;
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      throw new Error("QUARANTINE_PAYLOAD_INVALID: Object metadata is required");
    }
    const candidate = object as { objectId?: unknown; scopeId?: unknown };
    if (candidate.objectId !== objectId || typeof candidate.scopeId !== "string" || !candidate.scopeId.trim()) {
      throw new Error("QUARANTINE_PAYLOAD_INVALID: Object identity and Workspace scope must match the quarantine request");
    }
    this.#authService.assertPermission(auth, candidate.scopeId, "write");

    const item = this.#deviceQuarantineService.quarantineIncomingItem(deviceId, objectId, version, payload, nowUtc);
    this.#audit(auth.subjectId, "quarantine.register", item.quarantineId, "Success", { deviceId, objectId, scopeId: candidate.scopeId });
    return item;
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

  async recoverQuarantinedItem(auth: AuthContext, quarantineId: string, nowUtc = new Date().toISOString()): Promise<boolean> {
    if (!Number.isFinite(new Date(nowUtc).getTime())) throw new Error("INVALID_NOW_UTC");
    const item = this.#repository.getQuarantineItem(quarantineId);
    if (!item || item.status !== "Quarantined") return false;

    const payloadObject = item.payload.object;
    if (!payloadObject || typeof payloadObject !== "object" || Array.isArray(payloadObject)) {
      throw new Error("QUARANTINE_SCOPE_UNKNOWN: Cannot recover data without validated object metadata");
    }
    const candidate = payloadObject as Record<string, unknown>;
    if (candidate.objectId !== item.objectId || typeof candidate.scopeId !== "string" || !candidate.scopeId.trim()) {
      throw new Error("QUARANTINE_PAYLOAD_INVALID: Object identity and Workspace scope must match the quarantine record");
    }
    const scopeId = candidate.scopeId;
    if (!this.#repository.getWorkspace(scopeId)) {
      throw new Error("QUARANTINE_WORKSPACE_NOT_FOUND: Recovery target Workspace does not exist");
    }
    this.#authService.assertPermission(auth, scopeId, "write");

    // A metadata-only payload is insufficient to restore a source. Require the original
    // bytes and verify them against the canonical content hash before staging any writes.
    const bytesBase64 = item.payload.bytesBase64;
    if (typeof bytesBase64 !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bytesBase64)) {
      throw new Error("QUARANTINE_PAYLOAD_INCOMPLETE: Original bytes are missing or invalid");
    }
    const bytes = Buffer.from(bytesBase64, "base64");
    if (bytes.toString("base64") !== bytesBase64) {
      throw new Error("QUARANTINE_PAYLOAD_INVALID: Original bytes are not canonical base64");
    }
    const metadata = candidate.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new Error("QUARANTINE_PAYLOAD_INVALID: Source metadata is missing");
    }
    const sourceMetadata = metadata as Record<string, unknown>;
    if (typeof sourceMetadata.name !== "string" || !sourceMetadata.name.trim() ||
        typeof sourceMetadata.mimeType !== "string" || !sourceMetadata.mimeType.trim() ||
        sourceMetadata.sizeBytes !== bytes.byteLength ||
        typeof candidate.contentHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(candidate.contentHash) ||
        createHash("sha256").update(bytes).digest("hex") !== candidate.contentHash ||
        !Number.isInteger(candidate.version) ||
        (candidate.version as number) < 1 ||
        !Number.isInteger(item.sourceVersion) || item.sourceVersion < 1 ||
        candidate.version !== item.sourceVersion) {
      throw new Error("QUARANTINE_PAYLOAD_INVALID: Source metadata, version, size, or SHA-256 does not match the original bytes");
    }

    const suppliedPages = item.payload.pages;
    if (suppliedPages !== undefined && !Array.isArray(suppliedPages)) {
      throw new Error("QUARANTINE_PAYLOAD_INVALID: pages must be an array when provided");
    }
    const extraction = suppliedPages === undefined ? extractSource(bytes, sourceMetadata.name) : undefined;
    const pages = suppliedPages ?? (
      extraction?.status === "complete" && extraction.text?.trim()
        ? [{ pageNumber: 1, textContent: extraction.text, semanticType: "unknown" }]
        : undefined
    );
    const extractorId = suppliedPages !== undefined
      ? "caller-provided-pages"
      : extraction?.status === "complete" && pages?.length
        ? `builtin-${extraction.source.detected.format}`
        : undefined;
    const allowedSemanticTypes = new Set([
      "problem", "example", "explanation", "column", "definition", "theorem", "answer", "figure", "unknown",
    ]);
    if (pages?.some((page) =>
      !page || !Number.isInteger(page.pageNumber) || page.pageNumber < 1 ||
      (page.textContent !== undefined && typeof page.textContent !== "string") ||
      (page.title !== undefined && typeof page.title !== "string") ||
      (page.semanticType !== undefined && !allowedSemanticTypes.has(page.semanticType))
    )) {
      throw new Error("QUARANTINE_PAYLOAD_INVALID: Page data contains invalid fields");
    }

    // Stage immutable bytes before the SQLite transaction. Filesystem writes cannot
    // participate in SQLite rollback; on a later DB failure an unreferenced blob may
    // remain, but no canonical metadata is committed and original blobs are never deleted.
    const blob = await this.#blobStore.put(bytes, candidate.contentHash);
    const now = nowUtc;
    const sourceObject: SourceObject = {
      objectId: item.objectId,
      ownerId: auth.subjectId,
      scopeId,
      status: "Active",
      version: item.sourceVersion,
      contentHash: candidate.contentHash,
      metadata: {
        name: sourceMetadata.name,
        originalPath: typeof sourceMetadata.originalPath === "string" ? sourceMetadata.originalPath : undefined,
        mimeType: sourceMetadata.mimeType,
        sizeBytes: bytes.byteLength,
        pageCount: pages?.length ?? 0,
      },
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : item.quarantinedAt,
      updatedAt: now,
    };
    const artifactId = pages && pages.length > 0 && extractorId ? `art_${randomUUID()}` : undefined;
    const artifact: ExtractedArtifact | undefined = artifactId ? {
      artifactId,
      objectId: item.objectId,
      sourceVersion: item.sourceVersion,
      extractorId: extractorId!,
      extractorVersion: extractorId === "caller-provided-pages" ? "external-1" : "1.0.0",
      status: "complete",
      createdAt: now,
    } : undefined;
    const locations: SourceLocation[] = artifactId && pages
      ? pages.map((page) => ({
          locationId: `loc_${randomUUID()}`,
          artifactId,
          objectId: item.objectId,
          pageNumber: page.pageNumber,
          textContent: page.textContent,
          semanticType: (page.semanticType as SourceLocation["semanticType"] | undefined) ?? "unknown",
          title: page.title,
          createdAt: now,
        }))
      : [];

    const res = this.#deviceQuarantineService.recoverQuarantineItem(quarantineId, nowUtc, () => {
      this.#repository.saveSourceObject(sourceObject);
      this.#repository.saveBlobReference({
        blobId: `blob_${randomUUID()}`,
        objectId: item.objectId,
        storageKey: blob.sha256,
        sizeBytes: bytes.byteLength,
        mediaType: sourceMetadata.mimeType as string,
        checksum: candidate.contentHash as string,
        createdAt: now,
      });
      if (artifact) this.#repository.saveArtifactWithLocations(artifact, locations, scopeId);
    });
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
