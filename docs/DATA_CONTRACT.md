# Source and Extraction Data Contract

**Status:** Initial implementation. PDF extraction, original-file storage, authorization and Workspace scopes remain unimplemented.

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

## Known limitations

- SQLite still stores metadata only. `LocalBlobStore` now stores original bytes separately using a SHA-256 content-addressed path, writes through a unique temporary file and rename, checks the stored hash, and deduplicates identical content. It never deletes stored blobs. The blob write and SQLite transaction are not a single cross-resource transaction, so a failed metadata write can leave an unreferenced blob; reconciliation/reporting is still required and must not automatically delete originals.
- Page and region provenance are not yet modeled. PDF region traceability must not be claimed until it is implemented and tested.
- Workspace, Personal and shared-library scopes and authorization are not yet modeled.
- Schema bootstrap uses version 1; a versioned migration runner is needed before schema evolution.
- SQLite is an implementation spike, not a final database decision. Packaging, backup, restore, concurrency and licensing/maintenance considerations still need review.
