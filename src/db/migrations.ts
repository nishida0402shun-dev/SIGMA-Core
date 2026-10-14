/**
 * Database schema migrations for SIGMA Core.
 */

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sources (
        sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
        byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
        detected_format TEXT NOT NULL,
        detection_status TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS extractions (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) > 0),
        source_sha256 TEXT NOT NULL REFERENCES sources(sha256),
        extraction_status TEXT NOT NULL,
        extracted_text TEXT,
        warnings_json TEXT NOT NULL,
        extractor_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_extractions_source ON extractions(source_sha256);
    `,
  },
  {
    version: 2,
    sql: `
      -- Workspaces (FR-005, FR-006)
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('Active', 'Archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- SourceObject: Canonical metadata (8. Logical Model, FR-002)
      CREATE TABLE IF NOT EXISTS source_objects (
        object_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('Active', 'PendingDeletion', 'Purging', 'Purged')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        content_hash TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_source_objects_scope_status ON source_objects(scope_id, status);
      CREATE INDEX IF NOT EXISTS idx_source_objects_hash ON source_objects(content_hash);

      -- BlobReference: Binary payload references (FR-002)
      CREATE TABLE IF NOT EXISTS blob_references (
        blob_id TEXT PRIMARY KEY,
        object_id TEXT NOT NULL REFERENCES source_objects(object_id) ON DELETE CASCADE,
        storage_key TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        media_type TEXT NOT NULL,
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_blob_references_object ON blob_references(object_id);

      -- ExtractedArtifact (FR-003, FR-008)
      CREATE TABLE IF NOT EXISTS extracted_artifacts (
        artifact_id TEXT PRIMARY KEY,
        object_id TEXT NOT NULL REFERENCES source_objects(object_id) ON DELETE CASCADE,
        source_version INTEGER NOT NULL,
        extractor_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'failed')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_extracted_artifacts_object ON extracted_artifacts(object_id);

      -- SourceLocation: Page/region/offset positions with provenance (FR-004, FR-008)
      CREATE TABLE IF NOT EXISTS source_locations (
        location_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES extracted_artifacts(artifact_id) ON DELETE CASCADE,
        object_id TEXT NOT NULL REFERENCES source_objects(object_id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL CHECK (page_number >= 1),
        section TEXT,
        start_offset INTEGER,
        end_offset INTEGER,
        text_content TEXT,
        semantic_type TEXT NOT NULL DEFAULT 'unknown',
        title TEXT,
        bounding_box_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_source_locations_object_page ON source_locations(object_id, page_number);

      -- DerivedRelation: Provenance tracking (FR-008)
      CREATE TABLE IF NOT EXISTS derived_relations (
        derived_id TEXT PRIMARY KEY,
        source_object_id TEXT NOT NULL REFERENCES source_objects(object_id) ON DELETE CASCADE,
        source_version INTEGER NOT NULL,
        relation_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_derived_relations_source ON derived_relations(source_object_id);

      -- AccessPolicy: Common authorization policies (FR-009)
      CREATE TABLE IF NOT EXISTS access_policies (
        grant_id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_until TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_access_policies_subject_scope ON access_policies(subject_id, scope_id);

      -- DeletionRecord (Tombstone): 180-day retention against revive (6.4, FR-016, FR-017)
      CREATE TABLE IF NOT EXISTS deletion_records (
        object_id TEXT PRIMARY KEY,
        deletion_version INTEGER NOT NULL,
        deleted_at TEXT NOT NULL,
        propagation_state TEXT NOT NULL DEFAULT 'Pending',
        backup_expiry_state TEXT NOT NULL DEFAULT 'Active'
      );
      CREATE INDEX IF NOT EXISTS idx_deletion_records_deleted_at ON deletion_records(deleted_at);

      -- Device: Synchronization & Revocation tracking (7.1, FR-020, FR-021)
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('Active', 'Warning1', 'FinalWarning', 'Revoked')),
        last_successful_sync_at TEXT NOT NULL,
        revoked_at TEXT,
        credential_version INTEGER NOT NULL DEFAULT 1
      );

      -- QuarantineItem: Isolated unsynced data from revoked devices (7.2, 7.3, FR-023, FR-025)
      CREATE TABLE IF NOT EXISTS quarantine_items (
        quarantine_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(device_id),
        object_id TEXT NOT NULL,
        source_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('Quarantined', 'Recovering', 'Recovered', 'Expired', 'Purged')),
        quarantined_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quarantine_device_status ON quarantine_items(device_id, status);
      CREATE INDEX IF NOT EXISTS idx_quarantine_expires_at ON quarantine_items(expires_at);

      -- Job: Resumable and idempotent async jobs (FR-029)
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('Pending', 'Running', 'Succeeded', 'Failed', 'Cancelled')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- AuditEvent: Immutable security and lifecycle audit log (FR-028)
      CREATE TABLE IF NOT EXISTS audit_events (
        event_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('Success', 'Denied', 'Failed', 'Conflict')),
        reason_code TEXT,
        details_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp);

      -- FTS5 Full-Text Search Table for SourceLocations (FR-007)
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_source_locations USING fts5(
        location_id UNINDEXED,
        object_id UNINDEXED,
        scope_id UNINDEXED,
        page_number UNINDEXED,
        title,
        text_content,
        tokenize = 'unicode61'
      );
    `,
  },
];
