# Acceptance Criteria Traceability Status

**Review date:** 2026-10-17  
**Status:** Original requirements source unavailable; reconstructed baseline created on a separate branch.  
**Important:** The reconstructed baseline is not claimed to be identical to the missing Version 0.1 document.

## Verified facts

The README refers to “SIGMA Core 要件定義書 Version 0.1”, but that normative source is not present in the current repository tree. Existing documents include:

- docs/DECISIONS.md — working design decisions and unresolved choices.
- docs/ARCHITECTURE.md — conceptual design only; explicitly does not claim implementation.
- docs/MVP_SCOPE.md — proposed scope; acceptance criteria are not approved.
- docs/DATA_CONTRACT.md — initial data contract and known implementation limitations.
- docs/STUDIO-INTEGRATION-GAP-AUDIT.md — repository-level integration gap audit.

The current acceptance test file contains explicit markers for AT-001–AT-007, AT-009–AT-010, AT-012–AT-018, AT-020, and AT-022. This only confirms the markers exist in the test source; it does not by itself prove the criteria pass or establish the normative meaning of each criterion.

AT-008, AT-011, AT-019, AT-021, and AT-023 do not have explicit markers in the referenced acceptance test file. Because the original normative text is unavailable, their intended meaning must not be guessed.

## New reconstructed baseline

See docs/REQUIREMENTS_BASELINE.md.

The baseline uses three evidence classes:

- CORE-Axx: explicit existing decisions/project agreements.
- CORE-Bxx: goals recorded in conceptual/proposed documents that still require approval or implementation verification.
- CORE-Cxx: new proposals requiring decision/approval.

These identifiers are not replacements for old AT numbers. A mapping from an old AT to a new CORE requirement may be recorded only when repository evidence supports the relationship.

## Required traceability fields

For each requirement, record:

1. Requirement text and evidence class (A/B/C).
2. Source document and section.
3. Implementation file/service and enforcement boundary.
4. Positive, negative, and failure-path tests.
5. CI run and result.
6. Status: not started, in progress, implemented-unverified, tested, CI-verified, verified in target packaged runtime, or blocked.
7. Open questions, risks, and approval state.

## Current treatment of missing original criteria

| Legacy criterion | Status | Treatment |
|---|---|---|
| AT-008 | Meaning unverified | Preserve historical marker; do not invent a requirement |
| AT-011 | Meaning unverified | Preserve historical marker; do not invent a requirement |
| AT-019 | Meaning unverified | Preserve historical marker; do not invent a requirement |
| AT-021 | Meaning unverified | Preserve historical marker; do not invent a requirement |
| AT-023 | Meaning unverified | Preserve historical marker; do not invent a requirement |

## Completion rule

The trace is complete only when each active requirement is linked to code, relevant tests, and actual CI/runtime evidence. The absence of the old source is not a reason to stop all development; it is a reason to use the explicitly labeled reconstructed baseline and retain uncertainty where evidence is missing.
