# Source and Extraction Data Contract

**Status:** Initial implementation. UTF-8 plain-text extraction is implemented; PDF extraction, page/region coordinates, and end-to-end Electron validation remain unimplemented.

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

## Atomicity and retry behavior

Source metadata and extraction records are written in one SQLite transaction. Repeating an operation with the same idempotency key and source hash returns the existing record. Reusing the key for different source bytes is rejected. Failed extraction can be recorded explicitly; it does not imply content was extracted.

## Quarantine recovery payload contract

A recoverable quarantine item must include all of the following in its payload:

- `object`: source identity, Workspace scope, source version, SHA-256 content hash, metadata, and optional creation timestamp.
- `bytesBase64`: the original file bytes encoded as canonical Base64.
- `pages` (optional): externally supplied page records. If omitted, Core attempts its registered extractor; currently this automatically extracts UTF-8 plain text only.

Recovery verifies the payload object ID and source version against the quarantine record, confirms that the Workspace exists and the caller has write permission, checks byte length and SHA-256 against the source metadata, and stages the immutable blob before committing SQLite records. SourceObject, BlobReference, extraction artifact/locations, and the quarantine status transition are committed in one SQLite transaction. Existing canonical objects and deletion tombstones block recovery. A payload containing metadata without original bytes is rejected; it must not be reported as fully recovered.

The filesystem and SQLite cannot share one transaction. If the database transaction fails after the immutable blob is staged, an unreferenced blob may remain for later reconciliation. Recovery never automatically deletes source blobs.

## Known limitations

- `LocalBlobStore` stores original bytes separately using a SHA-256 content-addressed path, writes through a unique temporary file and rename, checks the stored hash, and deduplicates identical content. Source metadata, blob references, extracted artifacts/locations, search rows, and the registration audit event are now committed in one SQLite transaction. The filesystem blob write cannot participate in that SQLite transaction, so a failed metadata commit can still leave an unreferenced immutable blob. Reconciliation/reporting remains required; it must not automatically delete originals. A regression test verifies that a page-persistence failure leaves no canonical source rows while documenting the possible orphan blob.
- When page data is supplied by an adapter/caller, the artifact is labeled `caller-provided-pages`; Core does not claim to have extracted that text. When pages are omitted, Core runs the registered extractor. Currently only valid UTF-8 plain text is extracted automatically and labeled `builtin-plain-text`. PDF signatures are detected, but no PDF extractor is registered, so PDF text is not automatically extracted.
- Page and region coordinates are not yet modeled. PDF page/region traceability must not be claimed until it is implemented and tested.
- Workspace, Personal and shared-library scopes and authorization are not yet modeled.
- Schema bootstrap uses version 1; a versioned migration runner is needed before schema evolution.
- SQLite is an implementation spike, not a final database decision. Packaging, backup, restore, concurrency and licensing/maintenance considerations still need review.
