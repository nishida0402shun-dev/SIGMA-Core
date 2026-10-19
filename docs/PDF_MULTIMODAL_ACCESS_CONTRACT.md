# PDF Multimodal Access Contract

**Status:** Proposed implementation contract; not a claim that PDF extraction or image delivery is implemented.
**Scope:** SIGMA Core source ingestion, extraction artifacts, page retrieval, and MCP delivery.

## Goal

Let an authorized AI client inspect the original PDF and useful representations derived from it without treating extracted text as a complete substitute for the source. The original file remains authoritative. Text, page images, OCR output, figures, tables, and layout metadata are derived artifacts with explicit provenance.

## Non-negotiable data rules

1. Preserve the exact original bytes in the content-addressed Blob Store. Never overwrite them with a rendered or normalized PDF.
2. Bind every derived artifact to objectId, sourceVersion, and the source SHA-256. A result from an older source version must not be presented as current.
3. Record extraction status and warnings per operation and, where possible, per page. "Complete" means the declared operation completed; it must not imply perfect semantic understanding or full multimodal fidelity.
4. Distinguish native PDF text, OCR text, layout/geometry, rendered page images, and AI-generated interpretations. Never label caller-provided or AI-generated content as Core-extracted source content.
5. Keep page numbering stable and explicit. Coordinates must state their coordinate space and units; do not mix PDF points, pixel coordinates, and normalized coordinates.
6. Enforce file-size, page-count, pixel-count, execution-time, and memory limits. An exceeded limit must produce a partial/failed status and a warning, never a silent success.
7. Keep the existing authorization boundary: every source/page/image/resource read must verify the caller's permission for the source's explicit scope. Workspace selection must not be implicit.
8. Keep the first implementation read-only with respect to original source bytes. Reconciliation and cleanup remain separate operations.

## Canonical source and derived artifacts

- **Source object:** stable object ID, scope, source version, media type, byte length, and SHA-256.
- **Original blob:** immutable exact source bytes, addressed by SHA-256.
- **PDF page artifact:** source version, one-based page number, page dimensions/rotation, renderer/extractor ID and version, status, and warnings.
- **Text spans:** text plus page number, reading-order index, bounding box, and extraction method (native-text or OCR) when known.
- **Page image:** rendered image bytes plus MIME type, pixel dimensions, render scale, page number, and source-version provenance.
- **Regions/figures:** optional crop image and bounding box tied to the page image and source version. Do not claim automatic figure/table detection until tested.
- **AI interpretation:** separate derived record with model/provider and prompt/version metadata where available; it is never canonical source evidence.

These are logical concepts, not a mandate to create a table for every item. Keep the physical schema small and normalized around the existing artifact/location model unless tests demonstrate a need for separate storage.

## Retrieval and MCP behavior

1. Provide metadata-only source inspection.
2. Provide bounded, one-page-at-a-time retrieval for text/layout/image artifacts.
3. Provide an explicit original-byte retrieval path for authorized clients that can consume it; do not Base64-wrap large files into ordinary JSON text as the default transport.
4. For rendered pages, use MCP image content where the SDK/client supports it. If the client cannot consume image content or PDF resources, report that limitation and provide a clear fallback instead of claiming the AI saw the page.
5. Responses should include objectId, sourceVersion, source SHA-256, page number, artifact ID, status, warnings, and whether more pages remain.
6. Never return arbitrary local filesystem paths to an AI client. Resolve validated object IDs through Core services and Blob Store.
7. Bound response size and work per call. Use page/region requests rather than loading every page into one response.

## Extraction strategy

- Start with a pinned, maintained PDF.js-based parser candidate behind a format-specific adapter.
- Keep PDF text extraction asynchronous and bounded; do not block the main process for an unbounded document.
- Native text extraction and page rendering are separate capabilities and must have separate status fields.
- Scanned PDFs require OCR; OCR is a separate dependency/runtime decision and must not be implied by PDF.js support.
- Tables, figures, reading order, columns, and semantic meaning require fixture-based evaluation. A PDF parser alone does not guarantee these.
- Before adding a runtime dependency, update the lockfile through npm in a controlled checkout, run dependency/license/security checks, and test the exact locked version. Do not hand-edit lockfile metadata.

## Acceptance tests

- Text-based, multi-page Japanese/English PDF; scanned PDF; image-heavy PDF; table/graph/diagram; rotated and blank pages; malformed and encrypted PDF.
- Verify extracted text against expected text, page count, page dimensions, and source SHA-256.
- Verify each returned page/image points to the correct source version and page.
- Verify a failed page does not mark all pages as complete.
- Verify limits and cancellation produce explicit warnings/statuses without leaking memory or leaving canonical partial records.
- Verify authorization allows an entitled subject and denies a subject without read access, including cross-Workspace attempts.
- Verify MCP returns actual image content for a rendered page with a supported test client, and fails clearly when that capability is unavailable.
- Verify a change to source bytes invalidates or versions prior derived artifacts.
- Verify clean install, tests, type-check, license/security checks, and target Electron packaging compatibility using the exact lockfile.

## Completion criteria

PDF support is not complete merely because the original PDF is stored, the PDF signature is recognized, or text extraction returns a string. The capability is complete only to the extent each declared operation has fixture-based evidence, provenance, explicit limitations, and working authorized retrieval. OCR and semantic figure/table understanding remain separately reported capabilities.
