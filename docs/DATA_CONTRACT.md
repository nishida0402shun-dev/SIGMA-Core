# Source and Extraction Data Contract

**Status:** PDF text extraction with page provenance and page-range retrieval is implemented for text-based PDFs. Pages without embedded text can be rasterized and sent to an injected OCR engine (Tesseract 5 CLI adapter included) when the host provides one; standalone PNG/JPEG input uses the same engine. OCR output is marked partial and may contain recognition errors; the engine's language and mean word confidence are recorded as provenance, not accuracy. Extraction supports cancellation, page-level progress, and a bounded deduplicating job queue. An opt-in image preprocessor records `<id>@<version>+<settings>` per OCR page, an opt-in quality policy flags low-confidence or short pages and can retry once with a fallback preprocessor, and an opt-in RSS limit stops OCR before it starts. A synthetic six-category CER/WER benchmark covers original and per-option preprocessed inputs. Region-level coordinates beyond page-level bounding boxes, accuracy on representative scans, PaddleOCR comparison, and Electron end-to-end validation remain unverified.

## Boundaries

- Original bytes remain authoritative and must not be modified by the intake pipeline.
- The SQLite repository stores canonical source metadata and extraction records, not original file bytes.
- Source-faithful extraction remains separate from AI-organized knowledge and generated learning content.
- The database is shared across Workspaces; Workspace scope belongs in data and authorization metadata, not separate databases.
- Future UI, AI, MCP and Skills adapters must use a common service layer rather than write directly to tables.

## Source metadata

- sha256: content identity and deduplication key for source metadata.
- byte_length: basic integrity check.
- detected_format and detection_status: format identification and evidence status.
- evidence_json: evidence supporting the detection.
- created_at: first metadata insertion time.

## Extraction metadata

- id: unique extraction record.
- idempotency_key: unique operation key that prevents duplicate records on retry.
- source_sha256: foreign-key reference to source metadata.
- extraction_status: complete, partial, or failed.
- extracted_text: nullable, absent when extraction failed.
- warnings_json: warnings and limitations.
- extractor_id and extractor_version: extraction provenance.
- created_at: record creation time.

## Extraction contract

`extractSource(bytes, filename, registry?, options?)` is asynchronous and returns an
`ExtractionResult`. `ExtractOptions` accepts `limits`, an optional `ocrEngine` (used
for text-less PDF pages and standalone images), an optional `ocrLanguage`
(a Tesseract-style language specification validated by the engine), an optional
`imagePreprocessor` (opt-in cleanup applied immediately before OCR), an optional
`pdfPageRenderer` (defaults to the unpdf/canvas renderer), an optional
`ocrQuality` policy, an optional `ocrFallbackPreprocessor` used for one retry of a
page that needs review, an optional `ocrMemoryLimitMiB` RSS admission limit, an
optional `signal` (`AbortSignal`), and an optional `onProgress` callback.

- `status`: `complete`, `partial`, `failed`, or `cancelled`. OCR-derived text always
  yields `partial` because it is a recognition result, not faithful embedded text.
  Cancellation yields `cancelled` and is never persisted as a successful artifact.
- `pages`: one entry per page that the extractor processed. A page may have no
  `textContent` (for example a blank PDF page) while still carrying a `pageNumber`
  and warning.
- `warnings`: stable machine-readable prefixes such as `PDF_PARSE_FAILED`,
  `PDF_ENCRYPTED`, `PDF_TEXT_UNAVAILABLE_OCR_REQUIRED`,
  `PDF_PAGE_TEXT_UNAVAILABLE`, `PDF_PAGE_OCR_APPLIED`, `OCR_PAGE_FAILED`,
  `OCR_RENDER_FAILED`, `OCR_PAGE_TEXT_UNAVAILABLE`, `OCR_ENGINE_UNAVAILABLE`,
  `OCR_TIMEOUT`, `OCR_CANCELLED`, `OCR_IMAGE_TOO_LARGE`, `OCR_INVALID_LANGUAGE`,
  `IMAGE_OCR_APPLIED`, `IMAGE_TEXT_TRUNCATED`, `IMAGE_SIZE_LIMIT_EXCEEDED`,
  `PDF_PAGE_LIMIT_EXCEEDED`, `PDF_TIMEOUT`, `INPUT_SIZE_LIMIT_EXCEEDED`,
  `OCR_LOW_CONFIDENCE`, `OCR_TEXT_TOO_SHORT`, `OCR_RETRY_APPLIED`,
  `OCR_RETRY_FAILED`, `OCR_MEMORY_LIMIT`, and `TEXT_DECODE_FAILED`. `OCR_QUEUE_FULL`
  and `OCR_QUEUE_KEY_REQUIRED` are rejected
  by `OcrJobQueue` before extraction starts and never appear inside an
  `ExtractionResult`.
- `extractorId` / `extractorVersion`: present only when a registered extractor ran.
- `pageCount`: total pages reported by the source format when known.
- `source`: the immutable source record (SHA-256, byte length, detection evidence).

Extraction resources are bounded before and during processing:

| Limit | Default |
|---|---:|
| Maximum input size | 50 MiB |
| Maximum PDF pages per extraction | 2,000 |
| Maximum characters retained per page | 2,000,000 |
| Extractor timeout | 30 seconds |
| Maximum OCR image size | 20 MiB |
| Maximum rendered page size | 16 megapixels |
| OCR process RSS limit | opt-in, no default |

Callers may override these through `ExtractOptions.limits` for tests or explicit
lower-bound deployments. Invalid limits are rejected. Preprocessing and OCR each
receive the extractor timeout; a preprocessor that exceeds it fails that page
closed.

## Cancellation and progress

- `ExtractOptions.signal` accepts an `AbortSignal`. An already-aborted signal
  returns `cancelled` before parsing or rendering starts.
- Aborting during a page stops the page loop, aborts in-flight Tesseract and
  preprocessing, and returns `cancelled` with an `OCR_CANCELLED` warning naming the
  page where processing stopped. A cancelled extraction is not persisted as a
  successful artifact.
- `ExtractOptions.onProgress` receives page-level events:
  `page-started`, `page-rendered`, `page-preprocessed`, `ocr-completed`,
  `page-completed`, `page-failed`, and `cancelled`. Each event carries a 1-based
  `pageNumber`, and a `pageCount` when known. Progress is advisory: a throwing
  callback is ignored and never changes the extraction result.
- `TesseractCliEngine` passes the signal to `execFile`, so cancellation terminates
  the child process and removes its temporary directory. The engine distinguishes
  cancellation (`OCR_CANCELLED`) from timeout (`OCR_TIMEOUT`).

## OCR quality review, retry, and memory limit

- `ocrQuality` accepts `minConfidence` (0..1) and `minCharacters` (non-negative
  integer). It never rewrites text. Pages below either threshold carry
  `OCR_LOW_CONFIDENCE` or `OCR_TEXT_TOO_SHORT`, so the host can present them as
  "needs review". When the engine reports no confidence, only the character check
  applies.
- `ocrFallbackPreprocessor` is opt-in. If the first OCR attempt needs review (or
  produced empty text), the page is processed and OCRed once more with the fallback.
  The attempt with non-empty text, then higher engine confidence, then longer text
  wins. The chosen preprocessor is recorded in `ocrPreprocessing`, and
  `OCR_RETRY_APPLIED` or `OCR_RETRY_FAILED` records the retry without hiding either
  confidence. Cancellation during a retry propagates as cancellation.
- `ocrMemoryLimitMiB` checks process RSS before each OCR page. When exceeded, OCR
  stops with `OCR_MEMORY_LIMIT`; already-extracted embedded text and completed OCR
  pages remain available as a partial result. The limit is opt-in because a default
  threshold requires target-hardware measurements. It measures the Core process,
  not child-process or system-wide memory.
- These options are advisory except that the memory limit deliberately skips work.
  Engine confidence remains a model score, not measured accuracy.

## OCR job queue and deduplication

- `OcrJobQueue` is an in-process queue with `concurrency = 1` by default
  (overridable per instance), `maxQueueSize = 100` by default, and a required
  non-empty job key.
- Submitting the same key while it is in flight does not start a second job. Without
  a caller signal the existing promise is returned. With a caller signal, aborting
  stops only that caller's wait; the shared job keeps the first submission's task
  and signal. A queued job can be cancelled through its `AbortSignal`; it is removed
  from the queue and rejects with `OcrCancelledError`.
- A full queue rejects immediately with `OCR_QUEUE_FULL`. `stats()` reports
  running/queued/completed/failed/cancelled/deduplicated counters, and `onIdle()`
  resolves when no work is running or queued.
- `CoreService` routes extraction through the queue using
  `<contentHash>|<language>|<preprocessor-id@version+settings>|<fallback-preprocessor>|<quality-policy>|<memory-limit>`
  as the key. It also serializes registrations per content hash, so concurrent
  duplicate ingestion in one workspace performs one extraction and creates one
  source object. Dedup is per process; it is not a cross-process or cross-device
  lock.

## PDF provenance

- Text PDFs are extracted page by page using `unpdf` 1.9.1 (MIT), which bundles
  Mozilla PDF.js 6.4.299 (Apache-2.0).
- `pageNumber` is 1-based and corresponds to the PDF page index.
- `startOffset` / `endOffset` are character offsets within that page's extracted text.
- `boundingBox` is the union of extracted text item boxes in PDF user space:
  origin at the bottom-left of the page, units of 1/72 inch. It is a page-level
  approximation, not a per-word or per-region contract.
- A page with no extractable text is kept as a location with no `textContent`.
  If an OCR engine is supplied and available, only such pages are rendered and
  OCRed; pages with embedded text are never re-OCRed.
- OCR text is marked `partial`, carries a `PDF_PAGE_OCR_APPLIED` warning naming the
  engine and version, and is not claimed to be faithful embedded text. The
  artifact extractor becomes `builtin-pdf+<engine-id>` only when OCR produced text.
- Each location records `extractionMethod` (`embedded-text`, `ocr`, `plain-text`,
  `caller-provided`, or `unknown`), page-level `warnings`, and, for OCR pages,
  `ocrEngineId` / `ocrEngineVersion`, `ocrLanguage`, `ocrConfidence`, and, when an
  `ImagePreprocessor` ran, `ocrPreprocessing`. The built-in preprocessor records
  `<id>@<version>+<enabled-settings>` (for example
  `canvas-deskew-contrast@1.1.1+upscale+contrast`); a custom preprocessor that
  omits `settings` records only `<id>@<version>`. This makes mixed PDFs auditable
  page by page. `ocrConfidence` is the engine's mean word confidence in 0..1
  (Tesseract TSV), not a measured accuracy rate. Model identifiers beyond the
  engine/preprocessor IDs and versions are not stored.
- If OCR cannot run or produces no text, the page records `OCR_RENDER_FAILED`,
  `OCR_PAGE_FAILED`, or `OCR_PAGE_TEXT_UNAVAILABLE`. A PDF with no embedded text and
  no OCR text fails with `PDF_TEXT_UNAVAILABLE_OCR_REQUIRED`; it must not be
  reported as a successfully extracted text PDF.
- An `ImagePreprocessor` is opt-in and page-by-page. A throw or timeout during
  preprocessing fails that page closed (`OCR_PAGE_FAILED` / `OCR_TIMEOUT`) and no
  OCR engine call is made for it.
- Encrypted/password-protected PDFs fail with `PDF_ENCRYPTED`. Malformed PDFs fail
  with `PDF_PARSE_FAILED`. Neither failure stops the Core process or other objects.
- The default renderer uses `unpdf.renderPageAsImage` and the optional
  `@napi-rs/canvas` package. OCR requires a host-provided `OcrEngine`; the stdio MCP
  entrypoint injects the Tesseract CLI adapter, which reports itself unavailable
  when `tesseract` is not installed. The stdio entrypoint reads
  `SIGMA_OCR_LANGUAGE` for its default language (falling back to `jpn+eng`).
  OCR accuracy on representative scans, Japanese/English CER benchmarks, packaged
  Windows distribution, and target-PC memory behavior remain unverified.

## Standalone image OCR

- PNG and JPEG are detected by signature. Other image formats are not recognized.
- Standalone images have no embedded-text fallback, so OCR requires an available
  injected engine. Without one, extraction fails closed with
  `OCR_ENGINE_UNAVAILABLE`; a failed or empty OCR result also fails closed.
- Successful OCR creates page 1 with `extractionMethod = "ocr"`, engine ID/version,
  language, mean word confidence, optional preprocessing provenance, an
  `IMAGE_OCR_APPLIED` warning, and `partial` status. The artifact extractor is
  `builtin-image-ocr+<engine-id>`. If a preprocessor throws or times out, no engine
  call is made and the extraction fails closed.
- The 50 MiB input limit and 20 MiB OCR image limit apply. EXIF orientation,
  animated/multi-frame images, language-model coverage, and OCR accuracy on real
  photographs remain unverified.
- `CoreService.registerObject` and `SigmaStudioAdapter.addFiles` accept a per-object
  `ocrLanguage`, `imagePreprocessor`, `ocrQuality`, `ocrFallbackPreprocessor`, and
  `ocrMemoryLimitMiB`; the stdio MCP entrypoint still uses the engine default
  (`SIGMA_OCR_LANGUAGE`, falling back to `jpn+eng`) because it exposes read-only
  tools only.

## Artifact provenance and failures

`extracted_artifacts` records `warnings_json` and `page_count` in schema version 3.
`source_locations` records per-page provenance in schema version 6:
`extraction_method`, `warnings_json`, `ocr_engine_id`, `ocr_engine_version`,
`ocr_language`, `ocr_confidence`, and `ocr_preprocessing`
(`<id>@<version>[+<settings>]`, NULL when the original image was sent unchanged).
Existing rows migrated from v4 keep `extraction_method = NULL` (reported as
undefined/unknown), `warnings_json = '[]'`, and no OCR language/confidence.
Existing rows migrated from v5 have no preprocessing provenance (NULL).
A failed PDF extraction is recorded as a `failed` artifact with no locations so
callers can distinguish "recognized but not text-extractable" from "unsupported
format". An unsupported/unknown format has no registered extractor and therefore
no artifact.

Caller-provided page data is still labeled `caller-provided-pages` with version
`external-1`; Core does not claim to have extracted that text.

## Page retrieval

- `getPage(auth, objectId, pageNumber)` returns one location, including a blank
  page location when the extractor created one.
- `getPageRange(auth, objectId, startPage, endPage, maxPagesPerRequest = 100)`
  returns an inclusive 1-based range with the parent source metadata.
- Invalid pages, reversed ranges, ranges larger than the request limit, ranges
  beyond the extracted maximum, and ranges with gaps are rejected explicitly
  (`INVALID_PAGE_RANGE`, `PAGE_RANGE_TOO_LARGE`, `PAGE_RANGE_OUT_OF_BOUNDS`,
  `PAGE_RANGE_INCOMPLETE`, `PAGE_RANGE_UNAVAILABLE`). Missing pages are never
  silently trimmed.
- Logically deleted or purged sources fail closed before any page is returned.

## Atomicity and retry behavior

Source metadata and extraction records are written in one SQLite transaction. Repeating an operation with the same idempotency key and source hash returns the existing record. Reusing the key for different source bytes is rejected. Failed extraction can be recorded explicitly; it does not imply content was extracted.

## Quarantine recovery payload contract

A recoverable quarantine item must include all of the following in its payload:

- `object`: source identity, Workspace scope, source version, SHA-256 content hash, metadata, and optional creation timestamp.
- `bytesBase64`: the original file bytes encoded as canonical Base64.
- `pages` (optional): externally supplied page records. If omitted, Core attempts its registered extractor, including PDF text extraction.

Recovery verifies the payload object ID and source version against the quarantine record, confirms that the Workspace exists and the caller has write permission, checks byte length and SHA-256 against the source metadata, and stages the immutable blob before committing SQLite records. SourceObject, BlobReference, extraction artifact/locations, and the quarantine status transition are committed in one SQLite transaction. Existing canonical objects and deletion tombstones block recovery. A payload containing metadata without original bytes is rejected; it must not be reported as fully recovered.

The filesystem and SQLite cannot share one transaction. If the database transaction fails after the immutable blob is staged, an unreferenced blob may remain for later reconciliation. Recovery never automatically deletes source blobs.

## Known limitations

- `LocalBlobStore` stores original bytes separately using a SHA-256 content-addressed path, writes through a unique temporary file and rename, verifies the stored hash, and deduplicates identical content. Source metadata, blob references, extracted artifacts/locations, search rows, and the registration audit event are committed in one SQLite transaction. The filesystem blob write cannot participate in that SQLite transaction, so a failed metadata commit can still leave an unreferenced immutable blob. `BlobReconciliationService` provides a read-only report of unreferenced stored blobs, missing referenced blobs, and hash-integrity failures. It never deletes or repairs data; cleanup must be a separate, explicitly reviewed operation. A regression test verifies that a page-persistence failure leaves no canonical source rows while documenting the possible orphan blob.
- PDF extraction uses embedded text first. Pages without text are routed to an injected OCR engine; without an available engine they remain text-unavailable. OCR output is marked partial and carries a quality warning. A two-page Japanese embedded-font fixture verifies basic Japanese text and page boundaries; the OCR route is covered with mock engines and a real canvas rasterization check. Reading order for multi-column layouts, OCR accuracy, and precision of page-level bounding boxes remain unverified.
- `scripts/ocr-benchmark.ts` measures CER/WER, engine confidence, wall time, and peak RSS on synthetic cases derived from the Japanese fixture and canvas-rendered English text across printed-document, table, multi-column, formula, photo, and handwriting-proxy categories, with original and per-option preprocessing. These are regression signals, not representative scans. In the checked-in sample run, contrast-only preprocessing reduced mean CER on the synthetic set, while upscaling slightly worsened clean Japanese and materially degraded a low-resolution line-grid table; no default-on adoption is justified. Multi-column reading order and formulas remain weak.
- `scripts/ocr-memory-probe.ts` OCRs a generated image-only PDF page by page while sampling RSS. On this Linux container, peak RSS was approximately 156 MiB for both 12-page and 30-page runs (Tesseract 5.3.4, 150 dpi), which is consistent with bounded page-at-a-time processing rather than page-count-proportional growth. This is not a measurement on the target Windows 11 / Ryzen 5 4500U / 8 GB hardware or inside packaged Electron.
- The Windows CI job installs Tesseract and runs `scripts/ocr-windows-smoke.ts` plus the unit tests. It passed on `windows-latest` for `7c0eda0` ([run 40512320864](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40512320864)); this verifies the CLI/canvas path on a hosted Windows runner, not the target Windows 11 / Ryzen 5 4500U / 8 GB hardware or its memory ceiling.
- PaddleOCR / PaddleOCR-VL comparison is not executed. The local container has no PaddlePaddle wheel for Python 3.14, and installing Python 3.12 venv/system packages or third-party installers was blocked by the execution environment's policy. A reproducible comparison must be run in an approved environment before adopting PaddleOCR.
- Packaged Electron startup is not executed. `scripts/electron-native-probe.mjs` validates native canvas, SQLite/FTS5, Tesseract, and PDF rasterization under plain Node, but the packaged Electron ABI, `asarUnpack` layout, and `extraResources` Tesseract paths must be verified on the target machine.
- PDF timeouts and page-size limits are enforced by the extractor. Long-document memory has been measured on this Linux container, but end-to-end processing times and peak memory on a target Electron/OS build remain unverified.
- When page data is supplied by an adapter/caller, the artifact is labeled `caller-provided-pages`; Core does not claim to have extracted that text.
- Workspace, Personal and shared-library scopes and authorization are not yet modeled.
- Schema bootstrap uses versioned migrations (currently version 3); migration rollback/restore and concurrent-upgrade behavior still need verification.
- SQLite is an implementation spike, not a final database decision. Packaging, backup, restore, concurrency and licensing/maintenance considerations still need review.
