# Technology Stack Decision Proposal

Status: Proposed — not yet approved or implemented.

## Context

SIGMA Core is a new implementation dedicated to SIGMA Studio. It must support broad file recognition, source traceability, approval-gated changes, a shared canonical database, rebuildable indexes, and future integration through in-app APIs, CLI/Web AI, MCP, and Skills. No legacy SIGMACore or knowledgeDB implementation is assumed.

## Decision criteria

1. Fit with SIGMA Studio and Electron integration.
2. Mature libraries for file-format detection and extraction.
3. Safe local-first operation and predictable packaging.
4. Testability, maintainability, and type safety.
5. Ability to expose one authorization-enforcing service layer to every adapter.
6. Migration and backup/restore support.
7. Active maintenance and license compatibility of dependencies.

## Runtime/language options

| Option | Strengths | Risks / costs | Assessment |
|---|---|---|---|
| TypeScript on Node.js | Strong fit for an Electron/JavaScript application; type checking; broad ecosystem for APIs, filesystem work, and MCP integrations | Some specialist extraction tasks may require native dependencies or separate workers; package compatibility must be verified | Recommended candidate |
| Python service | Broad document/data-processing ecosystem and convenient experimentation | Adds a second runtime and packaging boundary to a JavaScript/Electron host; IPC and deployment complexity | Consider only if validated extraction requirements justify a separate worker |
| Rust core | Strong performance and memory-safety characteristics | Higher implementation cost; many extraction libraries may still require bindings or external tools; adds integration complexity | Not the initial default |

### Provisional recommendation

Use **TypeScript on a supported Node.js LTS runtime** for the initial Core service and adapters, subject to owner approval and a dependency feasibility check. Keep format-specific extraction behind adapters so a later isolated worker can be added for formats that require another runtime. Do not choose dependencies solely from extension coverage claims; validate licenses, maintenance, security posture, package size, and extraction quality on representative files.

This recommendation is not a claim that a runtime version or dependency has been selected, installed, or tested.

## Database decision — still open

Evaluate these options before implementation:

- **SQLite**: simple local deployment and transactional relational storage; vector search and concurrent access need explicit design and validation.
- **PostgreSQL**: richer concurrent access and extension options; introduces a server/deployment burden for a single-device-first target.
- **Hybrid**: relational canonical data plus separate derived search/vector indexes; increases operational and recovery complexity.

The canonical database must remain authoritative. Search/vector indexes are derived and rebuildable. Original files must be stored separately from canonical metadata. Workspace data must not imply a separate database per Workspace.

## Required feasibility spike before finalizing dependencies

1. Detect file types using content/signature as well as extension.
2. Extract text and page references from representative text and PDF files.
3. Inspect a DOCX and XLSX sample without executing embedded content.
4. Record extraction status, warnings, and source locations.
5. Run unit tests and a reproducible CI check.
6. Confirm that original files remain unchanged after failed extraction.
7. Record dependency licenses and platform/package constraints.

## Approval needed

- Approve or reject TypeScript/Node.js as the initial runtime.
- Select the canonical database only after the feasibility and concurrency requirements are documented.
- Approve the initial supported-format acceptance tests before claiming format support.


## Evaluation record

The initial dependency and technology shortlist is tracked in [Library and Technology Evaluation](LIBRARY_EVALUATION.md). That document records preliminary fit and explicit validation gates; it does not approve untested dependencies or finalize the database/runtime choices.
