# SIGMA Core MVP Scope

Status: Proposed — scope and acceptance criteria are not yet approved; nothing in this document claims implementation exists.

## MVP objective

Establish a safe, testable vertical slice that imports a file, identifies its actual format, extracts a bounded amount of source-faithful content, records provenance and quality status, and makes the result available through one common service API. Do not begin with universal format coverage or AI-generated knowledge registration.

## In scope

1. File intake that preserves the original bytes.
2. File-type detection that does not trust the extension alone.
3. A small adapter registry with explicit capability status.
4. Initial text extraction for plain text/Markdown and PDF, after library and license checks.
5. Extraction records containing source identity, detected format, extractor/version, status, warnings, and source locations where supported.
6. Clear separation between original source and extracted content.
7. Common service boundary for all future adapters; no integration accesses persistence directly.
8. Unit and integration tests, including malformed input and extraction failure.
9. CI that runs deterministic checks and tests.
10. A minimal supported-format matrix based on executed tests.

## Explicitly out of scope for the first vertical slice

- Claiming support for every file format.
- Executing uploaded files, macros, scripts, or embedded content.
- Automatic formal registration of AI-generated knowledge.
- Vector database or semantic search before the canonical data model is reviewed.
- Workspace-specific databases.
- Automatic Workspace selection.
- Deleting or overwriting original files as part of extraction.
- Migrating code from legacy SIGMACore or knowledgeDB.

## Acceptance criteria

- [ ] The same input bytes yield stable detection results under the test environment.
- [ ] Unsupported and malformed files produce explicit status and actionable errors, not fabricated extracted content.
- [ ] An extraction failure does not alter the original file.
- [ ] Extracted content can be traced back to its source; page/region references are recorded where the adapter supports them.
- [ ] Partial extraction is represented as partial, not complete.
- [ ] The service rejects unauthorized operations once the authorization boundary is implemented.
- [ ] Repeating an import does not silently create duplicate canonical registrations.
- [ ] Unit and integration tests run in CI; results are reported accurately.
- [ ] Documentation lists only formats and operations covered by actual tests.

## Implementation sequence

1. Approve runtime/language and repository conventions.
2. Decide canonical storage and define minimal source/extraction data contracts.
3. Run dependency/license feasibility checks with representative samples.
4. Implement file detection and adapter interfaces.
5. Add text and PDF extraction adapters.
6. Add provenance/status persistence and idempotent import behavior.
7. Add tests and CI, then verify the full vertical slice.
8. Review security and failure cases before widening format coverage.

## Exit condition

The MVP is complete only when the acceptance criteria have been exercised and results recorded. Creating scaffolding or passing isolated unit tests alone is not sufficient.
