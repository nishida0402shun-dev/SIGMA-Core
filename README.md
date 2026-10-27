# SIGMA Core

SIGMA Core is the unified canonical data, storage, lifecycle, and retrieval foundation for **SIGMA Studio** and AI/MCP integrations.

> **Status:** Local verification reports 110 automated tests across 20 test suites plus a passing TypeScript type-check and license-inventory check. PDF text extraction, page provenance, page-range retrieval, page-selective OCR routing for text-less PDF pages, standalone PNG/JPEG OCR, cancellation and page-level progress, a bounded single-concurrency OCR job queue with in-flight deduplication, opt-in pre-OCR image preprocessing with per-page provenance (including enabled settings), opt-in OCR quality review with a one-shot fallback-preprocessor retry, an opt-in process-RSS admission limit, and a synthetic six-category OCR benchmark are implemented. A long-document memory probe and a target-hardware readiness report are included. Synthetic benchmark results are regression signals only; OCR accuracy on representative scans and the target Windows 11/Ryzen 5 4500U/8 GB environment are not verified. PaddleOCR comparison and packaged Electron startup remain unexecuted; see `docs/OCR_IMPLEMENTATION_STATUS_2026-10-25.md`. GitHub Actions CI for the cancellation/queue/benchmark/probe work (`5db84df`) passed on Node.js 22/24 and on Windows with Tesseract ([run 40529182736](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40529182736)); the Windows job runs on `windows-latest`, not the target hardware. The referenced **SIGMA Core 要件定義書 Version 0.1** is not checked into this repository, so full requirement alignment cannot yet be independently verified. Explicit test markers cover AT-001–AT-007, AT-009–AT-010, AT-012–AT-018, AT-020, and AT-022; AT-008, AT-011, AT-019, AT-021, and AT-023 remain blocked pending the normative source.

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
   - An opt-in `ImagePreprocessor` can be supplied per extraction or per object. When used, each OCR page records `ocrPreprocessing = "<id>@<version>+<enabled-settings>"` (for example `canvas-deskew-contrast@1.1.1+upscale+contrast`). Preprocessing is not enabled by default because it can reduce accuracy on already-clean text; the synthetic benchmark includes per-option runs and shows that upscaling can degrade low-resolution line-grid tables.
   - Extraction accepts an `AbortSignal` and an `onProgress` callback. Cancellation aborts in-flight Tesseract and preprocessing, returns status `cancelled` with `OCR_CANCELLED`, and is recorded in the audit log by `CoreService`. Progress reports page start/render/preprocess/OCR/complete/fail phases.
   - `OcrJobQueue` defaults to one concurrent job, bounds queued work (`OCR_QUEUE_FULL`), deduplicates identical in-flight keys, supports queued cancellation, and exposes stats plus an idle promise. `CoreService` serializes registrations per content hash so concurrent duplicate ingestion performs one extraction and creates one source object.
   - An opt-in `ocrQuality` policy flags low-confidence or short OCR pages (`OCR_LOW_CONFIDENCE`, `OCR_TEXT_TOO_SHORT`) without rewriting text. If `ocrFallbackPreprocessor` is supplied, a flagged page is OCRed once more and the higher-confidence non-empty attempt is kept (`OCR_RETRY_APPLIED`). An opt-in `ocrMemoryLimitMiB` stops OCR before a page when process RSS exceeds the configured budget (`OCR_MEMORY_LIMIT`).
   - `getPageRange` returns an inclusive 1-based page range and rejects out-of-bounds, oversized, and gapped ranges.
   - A two-page Japanese embedded-font fixture verifies basic Japanese text and page boundaries. The synthetic benchmark in `benchmarks/ocr/` covers printed-document, table, multi-column, formula, photo, and handwriting-proxy categories with CER/WER, confidence, time, and peak RSS, for original and individually enabled preprocessing options. A generated image-only PDF measures peak RSS across 12 and 30 OCR pages. These are synthetic regression signals; representative scans, real photographs, multi-column reading order, complex PDF layouts, EXIF orientation, Windows/Tesseract packaging, and target-hardware performance remain unverified.

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
│   ├── ocr.ts                     # OCR engine/renderer/preprocessor contracts, abort helpers
│   ├── ocr-quality.ts             # Opt-in confidence/length review policy
│   ├── ocr-job-queue.ts           # Bounded concurrency, dedup, cancellation, stats
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
│       └── results/               # Generated benchmark, memory, hardware, and native-probe reports
├── scripts/
│   ├── ocr-benchmark.ts           # Six-category CER/WER/confidence/time/RSS benchmark
│   ├── ocr-memory-probe.ts        # Long image-only PDF RSS probe (12/30-page runs)
│   ├── hardware-report.ts         # OS/CPU/RAM/Tesseract/SQLite/canvas/OCR readiness report
│   ├── electron-native-probe.mjs  # Native-module/PDF check for plain Node or Electron
│   └── ocr-windows-smoke.ts       # Real Tesseract + canvas smoke test used by the Windows CI job
└── tests/
    ├── acceptance-criteria.test.ts# Acceptance test suite (AT-001 to AT-023)
    ├── core.test.ts               # Format detection and registry tests
    ├── pdf-extraction.test.ts     # PDF page provenance, OCR detection, and page ranges
    ├── ocr.test.ts                # OCR routing, cancellation, progress, preprocessing, quality review, memory guard, fail-closed tests
    ├── ocr-job-queue.test.ts      # Concurrency, dedup, queued cancellation, capacity, stats
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
node --experimental-strip-types scripts/ocr-benchmark.ts --write --preprocess=contrast,deskew
```

Results are written to `benchmarks/ocr/results/` and also printed to stdout. Pass `--manifest <path>` to replace the synthetic cases with caller-supplied PDF/canvas/image cases, `--case <id>` to run one case, and `--preprocess=upscale|contrast|deskew` to isolate an option.

Measure long-document memory, collect a target-hardware readiness report, and check native modules:

```bash
node --expose-gc --experimental-strip-types scripts/ocr-memory-probe.ts --pages 30 --write
npm run report:hardware
npm run probe:electron-native
```

The memory probe writes `memory-latest.{json,md}`. The hardware report writes `hardware-latest.{json,md}` and exits non-zero if a required check fails; run it on the target Windows 11 machine. The native probe passes under plain Node but must also be run under the packaged Electron binary (`npx electron scripts/electron-native-probe.mjs --write`) to validate ABI and `extraResources` paths.

Local `npm test` currently reports 110 tests across 20 test suites. GitHub Actions CI for the cancellation/queue/benchmark/probe work (`5db84df`) passed on Node.js 22/24 and on Windows with Tesseract (run [40529182736](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40529182736)); the Windows job verifies `windows-latest`, not the target Windows 11 hardware. Electron and other packaged runtimes remain unverified:
- **PDF extraction**: Page-to-text mapping, page-level coordinates, empty/scanned-like pages, OCR-required detection, encrypted/malformed fail-close, resource limits, and inclusive page ranges.
- **OCR routing**: Text pages are never re-OCRed; only text-less pages are rendered, a real canvas render produces PNG bytes, renderer/engine failures fail closed, and the Tesseract adapter enforces timeout, cancellation, and argument validation.
- **OCR cancellation/progress**: Aborting before or during extraction returns `cancelled` without persisting an artifact, kills in-flight Tesseract, emits page-level progress, and audits `OCR_CANCELLED`.
- **OCR job queue**: Default concurrency is one, identical in-flight keys share one promise, queued jobs can be cancelled, capacity is bounded, and stats/onIdle reflect completed, failed, and cancelled work.
- **OCR deduplication**: Concurrent registrations of identical content in one workspace serialize on the content hash and produce one source object and one extraction.
- **OCR preprocessing**: Per-page preprocessing is opt-in, receives the correct page number, records enabled settings in provenance, fails closed when it throws, and is exposed through `CoreService`/`SigmaStudioAdapter`.
- **OCR quality and memory guards**: Policies flag low-confidence/short text without changing it, the fallback preprocessor is used at most once and keeps the better attempt, retry failures preserve the first result, and the RSS limit stops OCR before rendering or engine calls.
- **Image OCR**: PNG signature detection, page-1 provenance, and fail-closed behavior for missing/unavailable engines, empty output, execution failure, timeout, and cancellation.
- **OCR benchmark**: Synthetic PDF/canvas cases cover printed documents, tables, multi-column text, formulas, photos, and a handwriting proxy; per-option preprocessing runs measure CER, WER, engine confidence, wall time, and peak RSS. They do not establish accuracy on representative scans.
- **Long-document memory**: A generated 12/30-page image-only PDF is OCRed page by page while RSS is sampled; peak RSS remains bounded across both runs on this Linux container.
- **Hardware/native probes**: The hardware report checks OS/CPU/RAM/disk, Node, Tesseract languages, SQLite FTS5, native canvas, PDF rasterization, and an OCR smoke phrase. The Electron probe checks the same native paths under plain Node or a packaged Electron binary.
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
