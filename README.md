# SIGMA Core

SIGMA Core is the unified canonical data, storage, lifecycle, and retrieval foundation for **SIGMA Studio** and AI/MCP integrations.

> **Status:** Implementation aligned with **SIGMA Core 要件定義書 Version 0.1**. 100% test pass rate (31/31 automated tests, AT-001 through AT-023 verified).

---

## 🚀 Key Capabilities & Architecture

1. **Canonical Metadata & SQLite Database (`CoreRepository`)**:
   - Universal dual-driver supporting Node 22+ built-in `node:sqlite` (DatabaseSync) and `better-sqlite3`.
   - Zero-dependency execution without requiring local C++ build toolchains.
   - Built-in schema migrations with `PRAGMA user_version`.
   - WAL (Write-Ahead Logging) and Foreign Keys enforced.

2. **Source Object & Immutable Blob Storage (`LocalBlobStore`)**:
   - Original raw files are stored in content-addressed storage (SHA-256).
   - Provenance tracking linking extracted artifacts, page positions (`SourceLocation`), and derived relations.

3. **Full-Text Search with Provenance & Fail-Closed Leak Prevention (`FTS5`)**:
   - High-performance SQLite FTS5 index combined with CJK substring search.
   - Strict `status = 'Active'` JOIN prevents logically deleted or purged text from leaking into search results or AI context.

4. **Data Lifecycle & 7-Day Restore Window (FR-012, FR-013, FR-014)**:
   - **Logical Deletion (`PendingDeletion`)**: Immediately suppresses content from UI, APIs, Search, and MCP.
   - **7-Day Restore**: Authorized recovery within 7 days; strict denial after 7 days (`RESTORE_WINDOW_EXPIRED`).
   - **Full Purge (`Purged`)**: Permanent deletion of blobs, artifacts, locations, and FTS rows.
   - **Tombstones (`DeletionRecord`)**: Retained for a minimum of 180 days to prevent resurrecting deleted records from delayed sync or old backups.

5. **Client-Side Encrypted Backup (`BackupService`)**:
   - AES-256-GCM authenticated encryption.
   - Checksum integrity validation.
   - Enforces tombstone deletion records on restore to ensure deleted data cannot be revived.

6. **Device Revocation & Quarantine Management (`DeviceQuarantineService`)**:
   - UTC server-time tracking: Warning 1 at 60 days, Final Warning at 75 days, Revocation at 90 days.
   - Unsynced data from revoked devices is quarantined in complete isolation from normal search, APIs, and MCP.
   - 30-day quarantine retention (warnings at 23 and 29 days) with selective user recovery.

7. **SIGMA Studio Integration Adapter (`SigmaStudioAdapter`)**:
   - Drop-in replacement for `KnowledgeDbStore` in SIGMA Studio (`apps/desktop/electron/knowledge-db-store.ts`).
   - Seamlessly converts legacy JSON calls to the new canonical SQLite database.

8. **AI / Model Context Protocol (MCP) Adapter (`CoreMcpAdapter`)**:
   - Exposes `core_search`, `core_list_sources`, `core_get_source`, `core_get_page`, `core_delete_source`, `core_restore_source`, `core_list_quarantine`, and `core_recover_quarantine`.
   - Routes all AI requests through the shared `CoreService` layer with strict authorization.

---

## 📁 Repository Structure

```
├── src/
│   ├── db/
│   │   ├── sqlite-driver.ts       # Unified driver (node:sqlite & better-sqlite3)
│   │   └── migrations.ts          # Schema migrations v1 and v2 (FTS5 included)
│   ├── models/
│   │   └── types.ts               # Core entity types (SourceObject, Location, Device, etc.)
│   ├── persistence/
│   │   ├── core-repository.ts     # SQLite repository with atomic transactions & FTS
│   │   ├── local-blob-store.ts    # Content-addressed immutable file storage
│   │   └── sqlite-repository.ts   # Backwards-compatible import repository
│   ├── services/
│   │   ├── auth-service.ts        # Fail-closed permission enforcement
│   │   ├── backup-service.ts      # Client-side AES-256-GCM backup & restore
│   │   ├── device-quarantine-service.ts # 60/75/90 day revocation & quarantine
│   │   └── core-service.ts        # Unified business logic layer
│   ├── adapters/
│   │   └── sigma-studio-adapter.ts# SIGMA Studio KnowledgeDbStore compatible bridge
│   ├── mcp/
│   │   └── core-mcp-adapter.ts    # Model Context Protocol tool handler
│   └── index.ts                   # Library entry point
└── tests/
    ├── acceptance-criteria.test.ts# Acceptance test suite (AT-001 to AT-023)
    ├── core.test.ts               # Format detection and registry tests
    ├── local-blob-store.test.ts   # Blob storage tests
    ├── persistence.test.ts        # Legacy persistence tests
    ├── sqlite-capabilities.test.ts# FTS5 capability tests
    ├── sqlite-migrations.test.ts  # Migration tests
    └── test-shim.ts               # Zero-dependency test shim for node:test
```

---

## 🧪 Testing & Verification

Run the entire automated test suite:

```bash
npm test
```

All 31 tests across 7 test suites pass consistently:
- **AT-001 & AT-002**: Immediate fail-closed suppression from UI/API/MCP and search.
- **AT-003 & AT-004**: 7-day restore window enforcement.
- **AT-005**: Idempotent purge, blob removal, and tombstone creation.
- **AT-006**: Restore prevention against tombstoned deleted objects.
- **AT-007**: 180-day tombstone retention and release conditions.
- **AT-009 & AT-010**: 60/75/90 day device warnings and revocation.
- **AT-012 to AT-014**: Quarantine isolation and selective recovery.
- **AT-015 to AT-017**: 23/29 day warnings and 30-day quarantine expiration.
- **AT-020**: MCP tool invocation and authorization checks.
- **AT-022**: Japanese & English full-text search with exact page provenance.
- **SIGMA Studio Adapter**: Complete compatibility with SIGMA Studio.
