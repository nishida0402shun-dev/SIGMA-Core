# Acceptance Criteria Traceability Status

**Review date:** 2026-10-14  
**Scope:** Explicit AT markers in the current test suite and README.

## Verified from the repository

The repository's README describes the implementation as aligned with “SIGMA Core 要件定義書 Version 0.1”, but that requirements document is not present in the current repository tree. The checked-in files include `docs/ARCHITECTURE.md`, `docs/MVP_SCOPE.md`, and dependency documents; none provides the normative numbered AT-001–AT-023 definitions.

The acceptance test suite currently contains explicit markers for AT-001–AT-007, AT-009–AT-010, AT-012–AT-018, AT-020, and AT-022. The following markers are not explicitly covered in the test file:

| Criterion | Status | Reason |
|---|---|---|
| AT-008 | Blocked — source required | Numbered requirement text is absent; intent must not be guessed. |
| AT-011 | Blocked — source required | Numbered requirement text is absent; intent must not be guessed. |
| AT-019 | Blocked — source required | Numbered requirement text is absent; intent must not be guessed. |
| AT-021 | Blocked — source required | Numbered requirement text is absent; intent must not be guessed. |
| AT-023 | Blocked — source required | Numbered requirement text is absent; intent must not be guessed. |

## Required to finish the trace

Provide or add the authoritative **SIGMA Core 要件定義書 Version 0.1** (or the source document that defines AT-001–AT-023). Then map each numbered requirement to:
1. normative requirement statement and source section;
2. implementation file/service and enforcement boundary;
3. positive, negative, and failure-path tests;
4. CI run proving those tests passed;
5. status: implemented, partially implemented, missing, or not applicable.

Until that source is available, these five criteria remain **unverified**, not “implemented” or “failed”. No requirements have been invented to fill the gaps.
