/**
 * Core SQLite Repository implementing canonical persistence for SIGMA Core.
 * Manages database lifecycle, migrations, and atomic ACID operations across all entities.
 */

import { randomUUID } from "node:crypto";
import { openSqliteDatabase, type SqliteDatabase } from "../db/sqlite-driver.ts";
import { MIGRATIONS } from "../db/migrations.ts";
import type {
  SourceObject,
  SourceObjectMetadata,
  BlobReference,
  ExtractedArtifact,
  SourceLocation,
  DerivedRelation,
  Workspace,
  AccessPolicy,
  DeletionRecord,
  Device,
  QuarantineItem,
  Job,
  AuditEvent,
  SearchQuery,
  SearchHit,
  ObjectStatus,
  DeviceStatus,
  QuarantineStatus,
} from "../models/types.ts";

export class CoreRepository {
  readonly #db: SqliteDatabase;

  constructor(databasePath: string) {
    this.#db = openSqliteDatabase(databasePath);
    try {
      this.#db.pragma("journal_mode = WAL");
      this.#db.pragma("foreign_keys = ON");
      this.#migrate();
    } catch (err) {
      this.#db.close();
      throw err;
    }
  }

  close(): void {
    this.#db.close();
  }

  #migrate(): void {
    const currentVersion = Number(this.#db.pragma("user_version", { simple: true }) ?? 0);
    const latestVersion = MIGRATIONS.at(-1)?.version ?? 0;
    if (!Number.isInteger(currentVersion) || currentVersion < 0) {
      throw new Error("Invalid SQLite schema version");
    }
    if (currentVersion > latestVersion) {
      throw new Error(`Database schema version ${currentVersion} is newer than supported version ${latestVersion}`);
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue;
      this.#db.transaction(() => {
        this.#db.exec(migration.sql);
        this.#db.pragma(`user_version = ${migration.version}`);
      })();
    }
  }

  // -------------------------------------------------------------
  // Workspaces (FR-005, FR-006)
  // -------------------------------------------------------------
  createWorkspace(workspace: Workspace): Workspace {
    this.#db.prepare(`
      INSERT INTO workspaces (workspace_id, display_name, owner_id, status, created_at, updated_at)
      VALUES (@workspaceId, @displayName, @ownerId, @status, @createdAt, @updatedAt)
    `).run({
      workspaceId: workspace.workspaceId,
      displayName: workspace.displayName,
      ownerId: workspace.ownerId,
      status: workspace.status,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    });
    return workspace;
  }

  getWorkspace(workspaceId: string): Workspace | undefined {
    const row = this.#db.prepare("SELECT * FROM workspaces WHERE workspace_id = ?").get(workspaceId);
    if (!row) return undefined;
    return {
      workspaceId: row.workspace_id as string,
      displayName: row.display_name as string,
      ownerId: row.owner_id as string,
      status: row.status as "Active" | "Archived",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  listWorkspaces(): Workspace[] {
    const rows = this.#db.prepare("SELECT * FROM workspaces ORDER BY created_at ASC").all();
    return rows.map((row) => ({
      workspaceId: row.workspace_id as string,
      displayName: row.display_name as string,
      ownerId: row.owner_id as string,
      status: row.status as "Active" | "Archived",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  // -------------------------------------------------------------
  // SourceObjects & Blobs (8. Logical Model, FR-002)
  // -------------------------------------------------------------
  saveSourceObject(object: SourceObject): SourceObject {
    const run = this.#db.transaction(() => {
      const existing = this.getSourceObject(object.objectId);
      if (existing) {
        if (existing.version !== object.version - 1 && existing.version !== object.version) {
          throw new Error(`Optimistic concurrency conflict for object ${object.objectId}`);
        }
        this.#db.prepare(`
          UPDATE source_objects
          SET scope_id = @scopeId,
              status = @status,
              version = @version,
              content_hash = @contentHash,
              metadata_json = @metadataJson,
              updated_at = @updatedAt
          WHERE object_id = @objectId
        `).run({
          objectId: object.objectId,
          scopeId: object.scopeId,
          status: object.status,
          version: object.version,
          contentHash: object.contentHash,
          metadataJson: JSON.stringify(object.metadata),
          updatedAt: object.updatedAt,
        });
      } else {
        this.#db.prepare(`
          INSERT INTO source_objects (object_id, owner_id, scope_id, status, version, content_hash, metadata_json, created_at, updated_at)
          VALUES (@objectId, @ownerId, @scopeId, @status, @version, @contentHash, @metadataJson, @createdAt, @updatedAt)
        `).run({
          objectId: object.objectId,
          ownerId: object.ownerId,
          scopeId: object.scopeId,
          status: object.status,
          version: object.version,
          contentHash: object.contentHash,
          metadataJson: JSON.stringify(object.metadata),
          createdAt: object.createdAt,
          updatedAt: object.updatedAt,
        });
      }
      return object;
    });
    return run();
  }

  getSourceObject(objectId: string): SourceObject | undefined {
    const row = this.#db.prepare("SELECT * FROM source_objects WHERE object_id = ?").get(objectId);
    if (!row) return undefined;
    return {
      objectId: row.object_id as string,
      ownerId: row.owner_id as string,
      scopeId: row.scope_id as string,
      status: row.status as ObjectStatus,
      version: Number(row.version),
      contentHash: row.content_hash as string,
      metadata: JSON.parse(row.metadata_json as string) as SourceObjectMetadata,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  findSourceByContentHash(contentHash: string): SourceObject | undefined {
    const row = this.#db.prepare("SELECT * FROM source_objects WHERE content_hash = ? AND status != 'Purged' LIMIT 1").get(contentHash);
    if (!row) return undefined;
    return {
      objectId: row.object_id as string,
      ownerId: row.owner_id as string,
      scopeId: row.scope_id as string,
      status: row.status as ObjectStatus,
      version: Number(row.version),
      contentHash: row.content_hash as string,
      metadata: JSON.parse(row.metadata_json as string) as SourceObjectMetadata,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  listSourceObjects(scopeId: string, statusFilter: ObjectStatus[] = ["Active"]): SourceObject[] {
    const placeholders = statusFilter.map(() => "?").join(",");
    const rows = this.#db.prepare(`
      SELECT * FROM source_objects
      WHERE scope_id = ? AND status IN (${placeholders})
      ORDER BY created_at DESC
    `).all(scopeId, ...statusFilter);

    return rows.map((row) => ({
      objectId: row.object_id as string,
      ownerId: row.owner_id as string,
      scopeId: row.scope_id as string,
      status: row.status as ObjectStatus,
      version: Number(row.version),
      contentHash: row.content_hash as string,
      metadata: JSON.parse(row.metadata_json as string) as SourceObjectMetadata,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  saveBlobReference(blob: BlobReference): BlobReference {
    this.#db.prepare(`
      INSERT INTO blob_references (blob_id, object_id, storage_key, size_bytes, media_type, checksum, created_at)
      VALUES (@blobId, @objectId, @storageKey, @sizeBytes, @mediaType, @checksum, @createdAt)
    `).run({
      blobId: blob.blobId,
      objectId: blob.objectId,
      storageKey: blob.storageKey,
      sizeBytes: blob.sizeBytes,
      mediaType: blob.mediaType,
      checksum: blob.checksum,
      createdAt: blob.createdAt,
    });
    return blob;
  }

  getBlobReference(objectId: string): BlobReference | undefined {
    const row = this.#db.prepare("SELECT * FROM blob_references WHERE object_id = ? LIMIT 1").get(objectId);
    if (!row) return undefined;
    return {
      blobId: row.blob_id as string,
      objectId: row.object_id as string,
      storageKey: row.storage_key as string,
      sizeBytes: Number(row.size_bytes),
      mediaType: row.media_type as string,
      checksum: row.checksum as string,
      createdAt: row.created_at as string,
    };
  }

  // -------------------------------------------------------------
  // ExtractedArtifacts & SourceLocations & FTS (FR-004, FR-007, FR-008)
  // -------------------------------------------------------------
  saveArtifactWithLocations(
    artifact: ExtractedArtifact,
    locations: SourceLocation[],
    scopeId: string,
  ): void {
    const run = this.#db.transaction(() => {
      this.#db.prepare(`
        INSERT INTO extracted_artifacts (artifact_id, object_id, source_version, extractor_id, extractor_version, status, created_at)
        VALUES (@artifactId, @objectId, @sourceVersion, @extractorId, @extractorVersion, @status, @createdAt)
      `).run({
        artifactId: artifact.artifactId,
        objectId: artifact.objectId,
        sourceVersion: artifact.sourceVersion,
        extractorId: artifact.extractorId,
        extractorVersion: artifact.extractorVersion,
        status: artifact.status,
        createdAt: artifact.createdAt,
      });

      const insertLoc = this.#db.prepare(`
        INSERT INTO source_locations (
          location_id, artifact_id, object_id, page_number, section,
          start_offset, end_offset, text_content, semantic_type, title, bounding_box_json, created_at
        ) VALUES (
          @locationId, @artifactId, @objectId, @pageNumber, @section,
          @startOffset, @endOffset, @textContent, @semanticType, @title, @boundingBoxJson, @createdAt
        )
      `);

      const insertFts = this.#db.prepare(`
        INSERT INTO fts_source_locations (location_id, object_id, scope_id, page_number, title, text_content)
        VALUES (@locationId, @objectId, @scopeId, @pageNumber, @title, @textContent)
      `);

      for (const loc of locations) {
        insertLoc.run({
          locationId: loc.locationId,
          artifactId: loc.artifactId,
          objectId: loc.objectId,
          pageNumber: loc.pageNumber,
          section: loc.section ?? null,
          startOffset: loc.startOffset ?? null,
          endOffset: loc.endOffset ?? null,
          textContent: loc.textContent ?? null,
          semanticType: loc.semanticType,
          title: loc.title ?? null,
          boundingBoxJson: loc.boundingBox ? JSON.stringify(loc.boundingBox) : null,
          createdAt: loc.createdAt,
        });

        if (loc.textContent || loc.title) {
          insertFts.run({
            locationId: loc.locationId,
            objectId: loc.objectId,
            scopeId: scopeId,
            pageNumber: loc.pageNumber,
            title: loc.title ?? "",
            textContent: loc.textContent ?? "",
          });
        }
      }
    });
    run();
  }

  listExtractedArtifacts(objectId: string): ExtractedArtifact[] {
    const rows = this.#db.prepare(`
      SELECT * FROM extracted_artifacts WHERE object_id = ? ORDER BY created_at ASC, artifact_id ASC
    `).all(objectId);
    return rows.map((row) => ({
      artifactId: row.artifact_id as string,
      objectId: row.object_id as string,
      sourceVersion: Number(row.source_version),
      extractorId: row.extractor_id as string,
      extractorVersion: row.extractor_version as string,
      status: row.status as ExtractedArtifact["status"],
      createdAt: row.created_at as string,
    }));
  }

  getSourceLocations(objectId: string): SourceLocation[] {
    const rows = this.#db.prepare(`
      SELECT * FROM source_locations WHERE object_id = ? ORDER BY page_number ASC, location_id ASC
    `).all(objectId);

    return rows.map((row) => ({
      locationId: row.location_id as string,
      artifactId: row.artifact_id as string,
      objectId: row.object_id as string,
      pageNumber: Number(row.page_number),
      section: (row.section as string) || undefined,
      startOffset: row.start_offset != null ? Number(row.start_offset) : undefined,
      endOffset: row.end_offset != null ? Number(row.end_offset) : undefined,
      textContent: (row.text_content as string) || undefined,
      semanticType: row.semantic_type as any,
      title: (row.title as string) || undefined,
      boundingBox: row.bounding_box_json ? JSON.parse(row.bounding_box_json as string) : undefined,
      createdAt: row.created_at as string,
    }));
  }

  getPageLocation(objectId: string, pageNumber: number): SourceLocation | undefined {
    const row = this.#db.prepare(`
      SELECT * FROM source_locations WHERE object_id = ? AND page_number = ? LIMIT 1
    `).get(objectId, pageNumber);
    if (!row) return undefined;
    return {
      locationId: row.location_id as string,
      artifactId: row.artifact_id as string,
      objectId: row.object_id as string,
      pageNumber: Number(row.page_number),
      section: (row.section as string) || undefined,
      startOffset: row.start_offset != null ? Number(row.start_offset) : undefined,
      endOffset: row.end_offset != null ? Number(row.end_offset) : undefined,
      textContent: (row.text_content as string) || undefined,
      semanticType: row.semantic_type as any,
      title: (row.title as string) || undefined,
      boundingBox: row.bounding_box_json ? JSON.parse(row.bounding_box_json as string) : undefined,
      createdAt: row.created_at as string,
    };
  }

  updateLocationSemanticType(locationId: string, semanticType: string, title?: string): void {
    if (title !== undefined) {
      this.#db.prepare(`
        UPDATE source_locations SET semantic_type = ?, title = ? WHERE location_id = ?
      `).run(semanticType, title, locationId);
      this.#db.prepare(`
        UPDATE fts_source_locations SET title = ? WHERE location_id = ?
      `).run(title, locationId);
    } else {
      this.#db.prepare(`
        UPDATE source_locations SET semantic_type = ? WHERE location_id = ?
      `).run(semanticType, locationId);
    }
  }

  // -------------------------------------------------------------
  // Full-Text Search with Provenance & Fail-Closed Status Filter (FR-007, AT-001, AT-002)
  // -------------------------------------------------------------
  searchLocations(query: SearchQuery): SearchHit[] {
    const trimmed = query.query.trim();
    if (!trimmed) return [];
    const limit = Math.max(1, Math.min(query.limit ?? 20, 100));

    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = this.#db.prepare(`
        SELECT
          f.location_id,
          f.object_id,
          f.page_number,
          f.title,
          f.text_content,
          s.metadata_json,
          l.semantic_type,
          snippet(fts_source_locations, 5, '<b>', '</b>', '...', 20) AS snippet_text,
          bm25(fts_source_locations) AS score
        FROM fts_source_locations f
        JOIN source_objects s ON f.object_id = s.object_id
        JOIN source_locations l ON f.location_id = l.location_id
        WHERE f.scope_id = ?
          AND s.status = 'Active'
          AND fts_source_locations MATCH ?
        ORDER BY score ASC
        LIMIT ?
      `).all(query.scopeId, trimmed, limit);
    } catch {
      // If FTS syntax error on special characters, fallback to LIKE
      rows = [];
    }

    // Substring fallback for CJK / non-space separated queries if FTS returned nothing
    if (rows.length === 0) {
      const likePattern = `%${trimmed}%`;
      const likeRows = this.#db.prepare(`
        SELECT
          l.location_id,
          l.object_id,
          l.page_number,
          l.title,
          l.text_content,
          s.metadata_json,
          l.semantic_type,
          l.text_content AS snippet_text,
          1.0 AS score
        FROM source_locations l
        JOIN source_objects s ON l.object_id = s.object_id
        WHERE s.scope_id = ?
          AND s.status = 'Active'
          AND (l.text_content LIKE ? OR l.title LIKE ?)
        ORDER BY l.page_number ASC
        LIMIT ?
      `).all(query.scopeId, likePattern, likePattern, limit);
      rows = likeRows;
    }

    return rows.map((row) => {
      const meta = JSON.parse(row.metadata_json as string) as SourceObjectMetadata;
      return {
        locationId: row.location_id as string,
        objectId: row.object_id as string,
        sourceName: meta.name || (row.object_id as string),
        pageNumber: Number(row.page_number),
        semanticType: row.semantic_type as any,
        title: (row.title as string) || undefined,
        textSnippet: (row.snippet_text as string) || (row.text_content as string) || "",
        score: Math.abs(Number(row.score)),
      };
    });
  }

  // -------------------------------------------------------------
  // Derived Relations (FR-008)
  // -------------------------------------------------------------
  saveDerivedRelation(relation: DerivedRelation): DerivedRelation {
    this.#db.prepare(`
      INSERT INTO derived_relations (derived_id, source_object_id, source_version, relation_type, target_id, target_type, metadata_json, created_at)
      VALUES (@derivedId, @sourceObjectId, @sourceVersion, @relationType, @targetId, @targetType, @metadataJson, @createdAt)
    `).run({
      derivedId: relation.derivedId,
      sourceObjectId: relation.sourceObjectId,
      sourceVersion: relation.sourceVersion,
      relationType: relation.relationType,
      targetId: relation.targetId,
      targetType: relation.targetType,
      metadataJson: relation.metadata ? JSON.stringify(relation.metadata) : null,
      createdAt: relation.createdAt,
    });
    return relation;
  }

  getDerivedRelations(sourceObjectId: string): DerivedRelation[] {
    const rows = this.#db.prepare("SELECT * FROM derived_relations WHERE source_object_id = ?").all(sourceObjectId);
    return rows.map((row) => ({
      derivedId: row.derived_id as string,
      sourceObjectId: row.source_object_id as string,
      sourceVersion: Number(row.source_version),
      relationType: row.relation_type as any,
      targetId: row.target_id as string,
      targetType: row.target_type as string,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json as string) : undefined,
      createdAt: row.created_at as string,
    }));
  }

  // -------------------------------------------------------------
  // Deletion Records & Tombstones (6.4, FR-016, FR-017)
  // -------------------------------------------------------------
  saveDeletionRecord(record: DeletionRecord): void {
    this.#db.prepare(`
      INSERT INTO deletion_records (object_id, deletion_version, deleted_at, propagation_state, backup_expiry_state)
      VALUES (@objectId, @deletionVersion, @deletedAt, @propagationState, @backupExpiryState)
      ON CONFLICT(object_id) DO UPDATE SET
        deletion_version = excluded.deletion_version,
        deleted_at = excluded.deleted_at,
        propagation_state = excluded.propagation_state,
        backup_expiry_state = excluded.backup_expiry_state
    `).run({
      objectId: record.objectId,
      deletionVersion: record.deletionVersion,
      deletedAt: record.deletedAt,
      propagationState: record.propagationState,
      backupExpiryState: record.backupExpiryState,
    });
  }

  getDeletionRecord(objectId: string): DeletionRecord | undefined {
    const row = this.#db.prepare("SELECT * FROM deletion_records WHERE object_id = ?").get(objectId);
    if (!row) return undefined;
    return {
      objectId: row.object_id as string,
      deletionVersion: Number(row.deletion_version),
      deletedAt: row.deleted_at as string,
      propagationState: row.propagation_state as any,
      backupExpiryState: row.backup_expiry_state as any,
    };
  }

  listDeletionRecords(): DeletionRecord[] {
    const rows = this.#db.prepare("SELECT * FROM deletion_records").all();
    return rows.map((row) => ({
      objectId: row.object_id as string,
      deletionVersion: Number(row.deletion_version),
      deletedAt: row.deleted_at as string,
      propagationState: row.propagation_state as any,
      backupExpiryState: row.backup_expiry_state as any,
    }));
  }

  deleteTombstoneIfSafe(objectId: string, nowUtc: string): boolean {
    const record = this.getDeletionRecord(objectId);
    if (!record) return false;
    const deletedDate = new Date(record.deletedAt).getTime();
    const nowDate = new Date(nowUtc).getTime();
    const days180Ms = 180 * 24 * 60 * 60 * 1000;

    // Rule 6.4: Keep for minimum 180 days AND backup expiry AND propagation completed!
    if (nowDate - deletedDate < days180Ms) return false;
    if (record.propagationState !== "Propagated") return false;
    if (record.backupExpiryState !== "Expired") return false;

    this.#db.prepare("DELETE FROM deletion_records WHERE object_id = ?").run(objectId);
    return true;
  }

  // -------------------------------------------------------------
  // Full Purge Removal of Object, Artifacts, Locations, FTS (6.3, FR-014)
  // -------------------------------------------------------------
  purgeObjectData(objectId: string): void {
    const run = this.#db.transaction(() => {
      // 1. Remove from FTS
      this.#db.prepare("DELETE FROM fts_source_locations WHERE object_id = ?").run(objectId);
      // 2. Remove source locations
      this.#db.prepare("DELETE FROM source_locations WHERE object_id = ?").run(objectId);
      // 3. Remove extracted artifacts
      this.#db.prepare("DELETE FROM extracted_artifacts WHERE object_id = ?").run(objectId);
      // 4. Remove blob references
      this.#db.prepare("DELETE FROM blob_references WHERE object_id = ?").run(objectId);
      // 5. Update object status to Purged (retaining minimal metadata row, or remove)
      this.#db.prepare(`
        UPDATE source_objects
        SET status = 'Purged',
            metadata_json = '{}',
            updated_at = ?
        WHERE object_id = ?
      `).run(new Date().toISOString(), objectId);
    });
    run();
  }

  // -------------------------------------------------------------
  // Devices & Synchronization Tracking (7.1, FR-020, FR-021)
  // -------------------------------------------------------------
  saveDevice(device: Device): Device {
    this.#db.prepare(`
      INSERT INTO devices (device_id, user_id, status, last_successful_sync_at, revoked_at, credential_version)
      VALUES (@deviceId, @userId, @status, @lastSync, @revokedAt, @credVer)
      ON CONFLICT(device_id) DO UPDATE SET
        status = excluded.status,
        last_successful_sync_at = excluded.last_successful_sync_at,
        revoked_at = excluded.revoked_at,
        credential_version = excluded.credential_version
    `).run({
      deviceId: device.deviceId,
      userId: device.userId,
      status: device.status,
      lastSync: device.lastSuccessfulSyncAt,
      revokedAt: device.revokedAt ?? null,
      credVer: device.credentialVersion,
    });
    return device;
  }

  getDevice(deviceId: string): Device | undefined {
    const row = this.#db.prepare("SELECT * FROM devices WHERE device_id = ?").get(deviceId);
    if (!row) return undefined;
    return {
      deviceId: row.device_id as string,
      userId: row.user_id as string,
      status: row.status as DeviceStatus,
      lastSuccessfulSyncAt: row.last_successful_sync_at as string,
      revokedAt: (row.revoked_at as string) || undefined,
      credentialVersion: Number(row.credential_version),
    };
  }

  updateDeviceSyncTime(deviceId: string, syncTimeUtc: string): void {
    this.#db.prepare(`
      UPDATE devices
      SET last_successful_sync_at = ?,
          status = 'Active'
      WHERE device_id = ?
        AND status != 'Revoked'
        AND revoked_at IS NULL
    `).run(syncTimeUtc, deviceId);
  }

  // -------------------------------------------------------------
  // Quarantine (7.2, 7.3, FR-023, FR-024, FR-025, FR-027)
  // -------------------------------------------------------------
  saveQuarantineItem(item: QuarantineItem): QuarantineItem {
    this.#db.prepare(`
      INSERT INTO quarantine_items (quarantine_id, device_id, object_id, source_version, status, quarantined_at, expires_at, payload_json)
      VALUES (@quarantineId, @deviceId, @objectId, @sourceVersion, @status, @quarantinedAt, @expiresAt, @payloadJson)
    `).run({
      quarantineId: item.quarantineId,
      deviceId: item.deviceId,
      objectId: item.objectId,
      sourceVersion: item.sourceVersion,
      status: item.status,
      quarantinedAt: item.quarantinedAt,
      expiresAt: item.expiresAt,
      payloadJson: JSON.stringify(item.payload),
    });
    return item;
  }

  getQuarantineItem(quarantineId: string): QuarantineItem | undefined {
    const row = this.#db.prepare("SELECT * FROM quarantine_items WHERE quarantine_id = ?").get(quarantineId);
    if (!row) return undefined;
    return {
      quarantineId: row.quarantine_id as string,
      deviceId: row.device_id as string,
      objectId: row.object_id as string,
      sourceVersion: Number(row.source_version),
      status: row.status as QuarantineStatus,
      quarantinedAt: row.quarantined_at as string,
      expiresAt: row.expires_at as string,
      payload: JSON.parse(row.payload_json as string),
    };
  }

  listQuarantineItems(deviceId?: string, statusFilter?: QuarantineStatus[]): QuarantineItem[] {
    let query = "SELECT * FROM quarantine_items WHERE 1=1";
    const params: unknown[] = [];
    if (deviceId) {
      query += " AND device_id = ?";
      params.push(deviceId);
    }
    if (statusFilter && statusFilter.length > 0) {
      query += ` AND status IN (${statusFilter.map(() => "?").join(",")})`;
      params.push(...statusFilter);
    }
    query += " ORDER BY quarantined_at ASC";
    const rows = this.#db.prepare(query).all(...params);
    return rows.map((row) => ({
      quarantineId: row.quarantine_id as string,
      deviceId: row.device_id as string,
      objectId: row.object_id as string,
      sourceVersion: Number(row.source_version),
      status: row.status as QuarantineStatus,
      quarantinedAt: row.quarantined_at as string,
      expiresAt: row.expires_at as string,
      payload: JSON.parse(row.payload_json as string),
    }));
  }

  updateQuarantineStatus(quarantineId: string, status: QuarantineStatus): void {
    this.#db.prepare("UPDATE quarantine_items SET status = ? WHERE quarantine_id = ?").run(status, quarantineId);
  }

  purgeQuarantineItem(quarantineId: string): void {
    this.#db.prepare("UPDATE quarantine_items SET status = 'Purged', payload_json = '{}' WHERE quarantine_id = ?").run(quarantineId);
  }

  // -------------------------------------------------------------
  // Audit Events (FR-028)
  // -------------------------------------------------------------
  recordAuditEvent(event: AuditEvent): void {
    this.#db.prepare(`
      INSERT INTO audit_events (event_id, actor_id, action, target_id, timestamp, outcome, reason_code, details_json)
      VALUES (@eventId, @actorId, @action, @targetId, @timestamp, @outcome, @reasonCode, @detailsJson)
    `).run({
      eventId: event.eventId,
      actorId: event.actorId,
      action: event.action,
      targetId: event.targetId,
      timestamp: event.timestamp,
      outcome: event.outcome,
      reasonCode: event.reasonCode ?? null,
      detailsJson: event.details ? JSON.stringify(event.details) : null,
    });
  }

  listAuditEvents(targetId?: string, limit = 50): AuditEvent[] {
    let sql = "SELECT * FROM audit_events";
    const params: unknown[] = [];
    if (targetId) {
      sql += " WHERE target_id = ?";
      params.push(targetId);
    }
    sql += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);
    const rows = this.#db.prepare(sql).all(...params);
    return rows.map((row) => ({
      eventId: row.event_id as string,
      actorId: row.actor_id as string,
      action: row.action as string,
      targetId: row.target_id as string,
      timestamp: row.timestamp as string,
      outcome: row.outcome as any,
      reasonCode: (row.reason_code as string) || undefined,
      details: row.details_json ? JSON.parse(row.details_json as string) : undefined,
    }));
  }

  // -------------------------------------------------------------
  // Jobs (FR-029)
  // -------------------------------------------------------------
  saveJob(job: Job): Job {
    this.#db.prepare(`
      INSERT INTO jobs (job_id, job_type, target_id, status, attempt_count, next_attempt_at, last_error_code, created_at, updated_at)
      VALUES (@jobId, @jobType, @targetId, @status, @attemptCount, @nextAttemptAt, @lastErrorCode, @createdAt, @updatedAt)
      ON CONFLICT(job_id) DO UPDATE SET
        status = excluded.status,
        attempt_count = excluded.attempt_count,
        next_attempt_at = excluded.next_attempt_at,
        last_error_code = excluded.last_error_code,
        updated_at = excluded.updated_at
    `).run({
      jobId: job.jobId,
      jobType: job.jobType,
      targetId: job.targetId,
      status: job.status,
      attemptCount: job.attemptCount,
      nextAttemptAt: job.nextAttemptAt ?? null,
      lastErrorCode: job.lastErrorCode ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
    return job;
  }

  getJob(jobId: string): Job | undefined {
    const row = this.#db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId);
    if (!row) return undefined;
    return {
      jobId: row.job_id as string,
      jobType: row.job_type as any,
      targetId: row.target_id as string,
      status: row.status as any,
      attemptCount: Number(row.attempt_count),
      nextAttemptAt: (row.next_attempt_at as string) || undefined,
      lastErrorCode: (row.last_error_code as string) || undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // -------------------------------------------------------------
  // Access Policies (FR-009)
  // -------------------------------------------------------------
  grantPolicy(policy: AccessPolicy): void {
    this.#db.prepare(`
      INSERT INTO access_policies (grant_id, subject_id, scope_id, permission, valid_from, valid_until)
      VALUES (@grantId, @subjectId, @scopeId, @permission, @validFrom, @validUntil)
    `).run({
      grantId: policy.grantId,
      subjectId: policy.subjectId,
      scopeId: policy.scopeId,
      permission: policy.permission,
      validFrom: policy.validFrom,
      validUntil: policy.validUntil ?? null,
    });
  }

  hasPermission(subjectId: string, scopeId: string, permission: string, nowUtc: string): boolean {
    const row = this.#db.prepare(`
      SELECT 1 FROM access_policies
      WHERE subject_id = ?
        AND (scope_id = ? OR scope_id = '*')
        AND (permission = ? OR permission = 'admin')
        AND valid_from <= ?
        AND (valid_until IS NULL OR valid_until > ?)
      LIMIT 1
    `).get(subjectId, scopeId, permission, nowUtc, nowUtc);
    return row !== undefined;
  }
}
