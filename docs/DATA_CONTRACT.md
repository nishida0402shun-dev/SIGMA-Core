# Source and Extraction Data Contract

**Status:** PDF text extraction with page provenance and page-range retrieval is implemented for text-based PDFs. Pages without embedded text can be rasterized and sent to an injected OCR engine (Tesseract 5 CLI adapter included) when the host provides one; standalone PNG/JPEG input uses the same engine. OCR output is marked partial and may contain recognition errors. Region-level coordinates beyond page-level bounding boxes, OCR accuracy/benchmarks, Office formats, and Electron end-to-end validation remain unverified.

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
for text-less PDF pages and standalone images), and an optional
`pdfPageRenderer` (defaults to the unpdf/canvas renderer).

- `status`: `complete`, `partial`, or `failed`. OCR-derived text always yields
  `partial` because it is a recognition result, not faithful embedded text.
- `pages`: one entry per page that the extractor processed. A page may have no
  `textContent` (for example a blank PDF page) while still carrying a `pageNumber`
  and warning.
- `warnings`: stable machine-readable prefixes such as `PDF_PARSE_FAILED`,
  `PDF_ENCRYPTED`, `PDF_TEXT_UNAVAILABLE_OCR_REQUIRED`,
  `PDF_PAGE_TEXT_UNAVAILABLE`, `PDF_PAGE_OCR_APPLIED`, `OCR_PAGE_FAILED`,
  `OCR_RENDER_FAILED`, `OCR_PAGE_TEXT_UNAVAILABLE`, `OCR_ENGINE_UNAVAILABLE`,
  `OCR_TIMEOUT`, `OCR_IMAGE_TOO_LARGE`, `IMAGE_OCR_APPLIED`,
  `IMAGE_TEXT_TRUNCATED`, `IMAGE_SIZE_LIMIT_EXCEEDED`, `PDF_PAGE_LIMIT_EXCEEDED`,
  `PDF_TIMEOUT`, `INPUT_SIZE_LIMIT_EXCEEDED`, and `TEXT_DECODE_FAILED`.
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

Callers may override these through `ExtractOptions.limits` for tests or explicit
lower-bound deployments. Invalid limits are rejected.

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
  `ocrEngineId` / `ocrEngineVersion`. This makes mixed PDFs auditable page by page.
  Confidence scores, preprocessing settings, and model/language identifiers are
  not stored yet.
- If OCR cannot run or produces no text, the page records `OCR_RENDER_FAILED`,
  `OCR_PAGE_FAILED`, or `OCR_PAGE_TEXT_UNAVAILABLE`. A PDF with no embedded text and
  no OCR text fails with `PDF_TEXT_UNAVAILABLE_OCR_REQUIRED`; it must not be
  reported as a successfully extracted text PDF.
- Encrypted/password-protected PDFs fail with `PDF_ENCRYPTED`. Malformed PDFs fail
  with `PDF_PARSE_FAILED`. Neither failure stops the Core process or other objects.
- The default renderer uses `unpdf.renderPageAsImage` and the optional
  `@napi-rs/canvas` package. OCR requires a host-provided `OcrEngine`; the stdio MCP
  entrypoint injects the Tesseract CLI adapter, which reports itself unavailable
  when `tesseract` is not installed. OCR accuracy on representative scans,
  Japanese/English CER benchmarks, Windows packaging, and long-document memory
  use are not yet measured.

## Standalone image OCR

- PNG and JPEG are detected by signature. Other image formats are not recognized.
- Standalone images have no embedded-text fallback, so OCR requires an available
  injected engine. Without one, extraction fails closed with
  `OCR_ENGINE_UNAVAILABLE`; a failed or empty OCR result also fails closed.
- Successful OCR creates page 1 with `extractionMethod = "ocr"`, engine ID/version,
  an `IMAGE_OCR_APPLIED` warning, and `partial` status. The artifact extractor is
  `builtin-image-ocr+<engine-id>`.
- The 50 MiB input limit and 20 MiB OCR image limit apply. EXIF orientation,
  animated/multi-frame images, OCR language selection, and OCR accuracy on real
  photographs remain unverified.

## Artifact provenance and failures

`extracted_artifacts` records `warnings_json` and `page_count` in schema version 3.
`source_locations` records per-page provenance in schema version 4:
`extraction_method`, `warnings_json`, `ocr_engine_id`, and `ocr_engine_version`.
Existing rows migrated from v3 keep `extraction_method = NULL` (reported as
undefined/unknown) and `warnings_json = '[]'`. A failed PDF extraction is recorded as a
`failed` artifact with no locations so callers can distinguish "recognized but
not text-extractable" from "unsupported format". An unsupported/unknown format
has no registered extractor and therefore no artifact.

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
- PDF timeouts and page-size limits are enforced by the extractor, but long-document memory and end-to-end processing times have not yet been measured on a target Electron/OS build.
- When page data is supplied by an adapter/caller, the artifact is labeled `caller-provided-pages`; Core does not claim to have extracted that text.
- Workspace, Personal and shared-library scopes and authorization are not yet modeled.
- Schema bootstrap uses versioned migrations (currently version 3); migration rollback/restore and concurrent-upgrade behavior still need verification.
- SQLite is an implementation spike, not a final database decision. Packaging, backup, restore, concurrency and licensing/maintenance considerations still need review.
