# SIGMA Core

SIGMA Core is the unified canonical data, storage, lifecycle, and retrieval foundation for **SIGMA Studio** and AI/MCP integrations.

> **Status:** Local verification reports 88 automated tests across 16 test suites plus a passing TypeScript type-check and license-inventory check. PDF text extraction, page provenance, page-range retrieval, page-selective OCR routing for text-less PDF pages, standalone PNG/JPEG OCR, opt-in pre-OCR image preprocessing with per-page provenance, and a synthetic OCR regression benchmark are implemented. Synthetic benchmark results are regression signals only; OCR accuracy on representative scans and the target Windows 11/Tesseract environment are not yet verified. GitHub Actions CI for the OCR language/confidence commit (`8bcb4ca`) passed on Node.js 22 and 24 ([run 40301438003](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40301438003)); CI for the preprocessing/benchmark/Windows-OCR work (`7c0eda0`) passed on Node.js 22/24 and on Windows with Tesseract ([run 40512320864](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40512320864)). The Windows job runs on `windows-latest`, not the target hardware. Electron and other packaged runtimes are not yet verified. The referenced **SIGMA Core 要件定義書 Version 0.1** is not checked into this repository, so full requirement alignment cannot yet be independently verified. Explicit test markers cover AT-001–AT-007, AT-009–AT-010, AT-012–AT-018, AT-020, and AT-022; AT-008, AT-011, AT-019, AT-021, and AT-023 remain blocked pending the normative source.

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

3. **Text, PDF, and Image OCR Extraction with Provenance**:
   - UTF-8 plain text and text-based PDF extraction are implemented.
   - PDF output records 1-based page numbers, character offsets within each page, page-level bounding boxes in PDF user space, extractor ID/version, warnings, and source page count.
   - Scanned pages are rasterized page by page and OCRed only when the host injects an OCR engine. The stdio entrypoint injects a Tesseract 5 CLI adapter; without Tesseract the input fails closed with `PDF_TEXT_UNAVAILABLE_OCR_REQUIRED`. OCR text is marked `partial` and carries `PDF_PAGE_OCR_APPLIED` because it may contain recognition errors. The page records the engine, language, and mean word confidence as provenance. Encrypted and malformed PDFs fail with explicit warning codes.
   - Standalone PNG/JPEG input is detected by signature and OCRed as page 1. It has no embedded-text fallback, so an unavailable engine, empty output, failure, or timeout fails closed. Successful output carries `IMAGE_OCR_APPLIED` plus engine, language, and mean word confidence provenance.
   - The default OCR language is `jpn+eng`; the stdio entrypoint accepts `SIGMA_OCR_LANGUAGE`, and `CoreService`/`SigmaStudioAdapter` accept a per-object `ocrLanguage`. Confidence is the engine's mean word score, not a measured accuracy rate.
   - An opt-in `ImagePreprocessor` can be supplied per extraction or per object. When used, each OCR page records `ocrPreprocessing = "<id>@<version>"`. Preprocessing is not enabled by default because it can reduce accuracy on already-clean text.
   - `getPageRange` returns an inclusive 1-based page range and rejects out-of-bounds, oversized, and gapped ranges.
   - A two-page Japanese embedded-font fixture verifies basic Japanese text and page boundaries. The synthetic benchmark in `benchmarks/ocr/` compares original vs. preprocessed images with CER/WER, confidence, time, and peak RSS. These are synthetic regression signals; representative scans, real photographs, multi-column reading order, complex PDF layouts, EXIF orientation, Windows/Tesseract packaging, and long-document resource measurements remain unverified.

4. **Full-Text Search with Provenance & Fail-Closed Leak Prevention (`FTS5`)**:
   - High-performance SQLite FTS5 index combined with CJK substring search.
   - Strict `status = 'Active'` JOIN prevents logically deleted or purged text from leaking into search results or AI context.

5. **Data Lifecycle & 7-Day Restore Window (FR-012, FR-013, FR-014)**:
   - **Logical Deletion (`PendingDeletion`)**: Immediately suppresses content from UI, APIs, Search, and MCP.
   - **7-Day Restore**: Authorized recovery within 7 days; strict denial after 7 days (`RESTORE_WINDOW_EXPIRED`).
   - **Full Purge (`Purged`)**: Permanent deletion of blobs, artifacts, locations, and FTS rows.
   - **Tombstones (`DeletionRecord`)**: Retained for a minimum of 180 days to prevent resurrecting deleted records from delayed sync or old backups.

6. **Client-Side Encrypted Backup (`BackupService`)**:
   - AES-256-GCM authenticated encryption.
   - Checksum integrity validation.
   - Enforces tombstone deletion records on restore to ensure deleted data cannot be revived.

7. **Device Revocation & Quarantine Management (`DeviceQuarantineService`)**:
   - UTC server-time tracking: Warning 1 at 60 days, Final Warning at 75 days, Revocation at 90 days.
   - Unsynced data from revoked devices is quarantined in complete isolation from normal search, APIs, and MCP.
   - 30-day quarantine retention (warnings at 23 and 29 days) with selective user recovery.

8. **SIGMA Studio Integration Adapter (`SigmaStudioAdapter`)**:
   - Compatibility bridge for migrating SIGMA Studio storage operations onto SIGMA Core. **Integration is not yet wired into the current SIGMA Studio repository**: its `main` branch has no `apps/desktop/electron/knowledge-db-store.ts`; Electron currently imports `SharedWorkspaceDocStore` and relies on `LocalSigmaDocStore`. Treat the adapter as a migration boundary, not as an already-integrated drop-in replacement.
   - Seamlessly converts legacy JSON calls to the new canonical SQLite database.

9. **AI / Model Context Protocol (MCP) Adapter (`CoreMcpAdapter`)**:
   - Exposes `core_search`, `core_list_sources`, `core_get_source`, `core_get_page`, `core_get_page_range`, `core_get_extraction_info`, `core_delete_source`, `core_restore_source`, `core_list_quarantine`, and `core_recover_quarantine`.
   - Routes all AI requests through the shared `CoreService` layer with strict authorization.

---

## 📁 Repository Structure

```
├── src/
│   ├── db/
│   │   ├── sqlite-driver.ts       # Unified driver (node:sqlite & better-sqlite3)
│   │   └── migrations.ts          # Schema migrations v1-v6 (FTS5, provenance, OCR preprocessing)
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
│   │   ├── blob-reconciliation-service.ts # Read-only blob integrity report
│   │   └── core-service.ts        # Unified business logic layer
│   ├── ocr.ts                     # OCR engine/renderer/preprocessor contracts
│   ├── tesseract-cli-engine.ts    # Process-isolated Tesseract CLI adapter
│   ├── image-preprocessor.ts      # Opt-in deskew/upscale/contrast preprocessing (canvas)
│   ├── pdf-page-renderer.ts       # Page-by-page PDF rasterization (unpdf + canvas)
│   ├── adapters/
│   │   └── sigma-studio-adapter.ts# SIGMA Studio storage migration compatibility bridge
│   ├── mcp/
│   │   └── core-mcp-adapter.ts    # Model Context Protocol tool handler
│   └── index.ts                   # Library entry point
├── benchmarks/
│   └── ocr/
│       ├── cases.json             # Synthetic OCR regression manifest
│       └── results/               # Generated benchmark JSON/Markdown (latest original/preprocessed)
├── scripts/
│   ├── ocr-benchmark.ts           # CER/WER/confidence/time/RSS benchmark runner
│   └── ocr-windows-smoke.ts       # Real Tesseract + canvas smoke test used by the Windows CI job
└── tests/
    ├── acceptance-criteria.test.ts# Acceptance test suite (AT-001 to AT-023)
    ├── core.test.ts               # Format detection and registry tests
    ├── pdf-extraction.test.ts     # PDF page provenance, OCR detection, and page ranges
    ├── ocr.test.ts                # OCR routing, image OCR, rasterization, timeout, and fail-closed tests
    ├── pdf-fixture.ts             # Deterministic PDF fixture generator
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

Run the OCR benchmark (Tesseract must be installed; `jpn`/`eng` language data for the checked-in manifest):

```bash
npm run benchmark:ocr
npm run benchmark:ocr:preprocess
```

Results are written to `benchmarks/ocr/results/` and also printed to stdout. Pass `--manifest <path>` to replace the synthetic cases with caller-supplied PDF/canvas/image cases.

Local `npm test` currently reports 88 tests across 16 test suites. GitHub Actions CI for the OCR language/confidence commit (`8bcb4ca`) passed on Node.js 22 and 24 (run [40301438003](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40301438003)). CI for the preprocessing/benchmark/Windows-OCR work (`7c0eda0`) passed on Node.js 22/24 and on Windows with Tesseract (run [40512320864](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40512320864)); the Windows job verifies `windows-latest`, not the target Windows 11 hardware. Electron and other packaged runtimes remain unverified:
- **PDF extraction**: Page-to-text mapping, page-level coordinates, empty/scanned-like pages, OCR-required detection, encrypted/malformed fail-close, resource limits, and inclusive page ranges.
- **OCR routing**: Text pages are never re-OCRed; only text-less pages are rendered, a real canvas render produces PNG bytes, renderer/engine failures fail closed, and the Tesseract adapter enforces timeout and argument validation.
- **OCR preprocessing**: Per-page preprocessing is opt-in, receives the correct page number, is recorded as `ocrPreprocessing`, fails closed when it throws, and is exposed through `CoreService`/`SigmaStudioAdapter`.
- **Image OCR**: PNG signature detection, page-1 provenance, and fail-closed behavior for missing/unavailable engines, empty output, execution failure, and timeout.
- **OCR benchmark**: Synthetic PDF/canvas cases measure CER, WER, engine confidence, wall time, and peak RSS for original and preprocessed images. They do not establish accuracy on representative scans.
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
- **SIGMA Studio Adapter**: Compatibility surface exists; end-to-end integration with the current SIGMA Studio repository remains unimplemented and requires a separately verified migration.
