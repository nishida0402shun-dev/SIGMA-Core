# SIGMA Studio ↔ SIGMA Core Integration Gap Audit

**Audit date:** 2026-10-16  
**Scope:** GitHub `main` branches of `nishida0402shun-dev/SIGMA-Studio-main` and `nishida0402shun-dev/SIGMA-Core`.  
**Status:** Repository inspection only. No runtime integration or migration has been performed.

## Executive conclusion

SIGMA Core is **not yet integrated as the canonical document store in the current SIGMA Studio repository**. The existing `SigmaStudioAdapter` exposes knowledge-source operations, but it is not a replacement for Studio's current document store. A direct swap would be unsafe without an explicit data-model, identity, migration, and recovery plan.

This audit intentionally does not choose the open database/runtime decisions in `DECISIONS.md`.

## Evidence observed

| Area | Current Studio evidence | Current Core evidence | Integration consequence |
|---|---|---|---|
| Document persistence | `apps/desktop/electron/main.ts` constructs `SharedWorkspaceDocStore(USER_DATA_PATH, SHARED_WORKSPACE_PATH)`. | `CoreRepository` opens a SQLite database at a caller-supplied path. | No shared path/configuration contract is wired between repositories. |
| Storage model | `SharedWorkspaceDocStore` extends `LocalSigmaDocStore` and routes personal and shared data to separate local stores. | Core stores source objects and page locations in a canonical SQLite repository; original bytes live in `LocalBlobStore`. | Mapping existing documents, folders, versions, sidecars, and blobs needs a migration specification. |
| Workspace IDs | Studio uses a `shared:` prefix to distinguish shared-workspace IDs from personal IDs. | Core requires an existing Workspace ID for adapter list/import/search operations. | ID translation and explicit creation/selection must be defined; never strip prefixes without collision checks. |
| Existing adapter | No `apps/desktop/electron/knowledge-db-store.ts` path was found in the current Studio tree. | `src/adapters/sigma-studio-adapter.ts` handles `KnowledgeSource`/page operations. | The adapter contract does not match the current `LocalSigmaDocStore` document/file/folder/version API. |
| MCP process | Studio has `apps/desktop/electron/sigma-studio-mcp-launch.ts` and an app MCP server launched through Electron. | Core has `src/mcp/stdio-entry.ts` and an `mcp:stdio` script. | Core's entrypoint is not shown as wired into Studio's launch/configuration path. |
| Core MCP configuration | Studio's launch spec passes Studio user-data, run-context, render-bridge, provider, and locale settings. | Core stdio requires `SIGMA_CORE_DB_PATH`, `SIGMA_CORE_BLOB_DIR`, and `SIGMA_CORE_SUBJECT_ID`. | The process environment and identity/authorization model are not yet connected. |
| Content extraction | Studio documents are structured `.sigmadoc.json` files with revisions, recovery, document versions, block hashes, folders, and ledger reconciliation. | Core's current extractor registry implements plain-text extraction; PDF detection is marked unverified in `src/index.ts`. | Do not claim general PDF/document extraction parity; page text must be supplied or extracted by a separately verified pipeline. |
| Authorization | Studio in-app operations are mediated through Electron IPC and local store methods. | Core requires explicit subject identity and policy-based permissions; its stdio entrypoint does not enable super-admin bypass. | A trusted identity bridge and permission mapping are prerequisites for exposing write/delete/recovery tools. |

## Integration blockers

1. **Different product contracts:** a knowledge-source/page API is not equivalent to the current document/file/folder/version store.
2. **Data migration:** no audited importer/exporter currently proves round-trip preservation of Studio document bodies, folders, revisions, history sidecars, library ledger, recovery files, or shared-workspace data.
3. **Identity and scopes:** personal stores, shared stores, `shared:` IDs, Core Workspace IDs, and authorization subjects need an explicit mapping.
4. **Single source of truth:** the team must choose whether Core first indexes copies of existing Studio data or becomes the canonical writer. Running two independent writable stores without reconciliation is unsafe.
5. **Extraction capability:** storage of original bytes does not prove that text/page content has been correctly extracted or indexed.
6. **Runtime packaging:** Core is a separate repository and its package currently has `"private": true`; the Studio app does not currently demonstrate a packaged dependency on it.
7. **Recovery and rollback:** migration needs backup verification, staged import, integrity checks, rollback, and no destructive cleanup until validation succeeds.

## Recommended staged path (proposal, not an implementation decision)

### Stage 0 — Freeze the contract

- Define the canonical entities for documents, source files, folders, workspaces, versions, extracted pages, and provenance.
- Define the personal/shared/workspace scope mapping and the authority that creates Workspaces.
- Decide whether Core is initially a read-only index, a write-through service, or the canonical store.
- Specify file-format extraction capability and quality status by format/operation.

### Stage 1 — Non-destructive proof of concept

- Keep Studio's current `SharedWorkspaceDocStore` as the canonical writer.
- Import a small, explicitly selected test fixture set into an isolated Core DB/blob directory.
- Preserve original file bytes and source paths; record deterministic source IDs and import outcomes.
- Compare counts, hashes, page text, workspace mapping, and search results against expected fixtures.
- Do not expose delete, restore, or write tools to production Studio workflows during this stage.

### Stage 2 — Runtime and authorization proof

- Launch Core as a separate child process only after the packaging approach is selected.
- Pass explicit DB/blob paths and a trusted subject identity; never accept identity from MCP tool arguments.
- Test startup failures, process exit, timeout, retry, unknown write outcome, and permission denial.
- Verify the exact MCP tool schemas and ensure unapproved mutation tools are not exposed.

### Stage 3 — Controlled migration

- Provide dry-run and preview with counts, collisions, unsupported content, and estimated storage.
- Create and verify backups before writes.
- Import into a new Core DB/blob directory, run integrity and retrieval checks, then ask for explicit approval before switching canonical writes.
- Retain the original store until rollback and restore have been tested; never silently delete legacy files.
- Add integration, migration, failure-injection, and end-to-end regression tests before enabling by default.

## Acceptance gates before calling integration complete

- [ ] The chosen canonical-write model and scope mapping are documented.
- [ ] Workspace creation/selection is explicit and covered by tests.
- [ ] No existing document, folder, version, recovery, or shared-workspace data is lost in round-trip fixtures.
- [ ] Original-file hashes and source provenance match expected values.
- [ ] Search results cite the correct source and page; unsupported extraction is reported as unsupported/unverified.
- [ ] MCP identity and every exposed operation are authorized through Core's shared service layer.
- [ ] Process startup, failure, timeout, and restart behavior are tested.
- [ ] Backups can be restored and migration rollback is demonstrated.
- [ ] Studio unit/integration/E2E tests and Core tests pass in CI.
- [ ] Documentation distinguishes implemented, tested, and unverified capabilities.

## Primary repository references

- Studio Electron initialization: `apps/desktop/electron/main.ts` (constructs `SharedWorkspaceDocStore`).
- Studio store routing: `apps/desktop/electron/shared-workspace-doc-store.ts`.
- Studio store implementation: `apps/desktop/electron/local-sigma-doc-store.ts`.
- Studio MCP launch contract: `apps/desktop/electron/sigma-studio-mcp-launch.ts`.
- Core adapter: `src/adapters/sigma-studio-adapter.ts`.
- Core SQLite repository: `src/persistence/core-repository.ts`.
- Core MCP entrypoint: `src/mcp/stdio-entry.ts`.
- Open design choices: `docs/DECISIONS.md`.

---

## Addendum — packaged MCP evidence and compatibility boundary (2026-10-30)

This addendum updates the historical repository audit using the merged Studio
`main` integration and its latest checks. It does not claim that Core is the
canonical SigmaDoc store or that migration has occurred.

| Area | Verified status |
|---|---|
| Dependency identity | Studio pins Core through the `vendor/sigma-core` submodule SHA. Core remains a private workspace package; the internal npm version is not a published Studio runtime version. |
| Source-material scope | Studio keeps its existing SigmaDoc document store. Core backs the separate source-material library and its search/page retrieval; no lossless document-store migration is implemented. |
| MCP boundary | Studio owns a restricted `sigma-core-local` stdio server with six read-only tools. The configured AI subject is `studio-ai`; workspace registration grants read only. The Core general-purpose MCP entrypoint is not the Studio contract. |
| Packaged Windows evidence | Studio Checks run [41038044873](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/actions/runs/41038044873) passed all four jobs. Its Windows job built `win-unpacked`, launched the bundled Core MCP from `app.asar` through the Electron executable, verified read-only listing/search/page retrieval, and confirmed data after MCP restart. |
| Update policy | Studio's scheduled/manual workflow validates a candidate Core `main` SHA, updates the gitlink and workspace lockfile, opens a review PR, and runs Studio Checks. It does not auto-merge. Core tags and downloadable release artifacts are not used by the selected source-pinned model. |
| Installer and user environment | The cited CI run tested `win-unpacked`, not an installed NSIS package or an end-user machine. Installer, SmartScreen, actual user-data preservation, and operator restore remain unverified. |

The Studio integration contract is documented in
[`docs/STUDIO_INTEGRATION_CONTRACT.md`](./STUDIO_INTEGRATION_CONTRACT.md).
Studio's proposed operator procedures and manual-validation boundary are in
[`docs/sigma-core-integration-operations.md`](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/blob/main/docs/sigma-core-integration-operations.md).

### Remaining acceptance work

1. Build the Windows NSIS installer with publishing disabled, install it in CI,
   and run the same Core MCP round-trip from the installed executable.
2. Separately test on a target user's Windows machine: installation/update,
   SmartScreen behavior, existing source-material preservation, and restore
   from a complete database-plus-blob backup.
3. Keep migration of SigmaDoc documents, folders, revisions, and recovery data
   out of scope until it has a separate approved data-migration plan and
   round-trip evidence.

---

## Addendum — implementation re-check (2026-10-29)

**Purpose:** Update the historical 2026-10-16 audit with current repository evidence. This is still a repository/code review; no interactive desktop session, migration, or production MCP round-trip was executed during this re-check.

### Current status

The earlier statement that Core's MCP entrypoint was not wired into Studio is no longer fully current. Studio now has a bounded **source-material integration** with Core. This is meaningful progress, but it does not make Core the canonical store for all Studio documents.

| Area | Current evidence | Status |
|---|---|---|
| Core source bundled into Studio | Root npm workspace includes `vendor/sigma-core`; `apps/desktop/electron/source-material/core-bridge.ts` imports Core repository, blob store, auth, services, and adapter; `apps/desktop/scripts/build-electron.mjs` bundles `mcp/source-material-mcp-server.ts` as `sigma-core-mcp-server.cjs`. | Implemented in source/build configuration; packaged runtime still needs end-to-end verification. |
| Studio source-material persistence | `SourceMaterialService` opens `<userData>/data/sigma-core/core.sqlite` and stores original bytes under `<userData>/data/sigma-core/blobs`. | Implemented; do not confuse with migration of the existing document store. |
| Workspace selection | The source-material service requires a non-empty Studio Workspace ID, maps it to `studio:<id>`, and refuses to implicitly create a Workspace when listing/importing. | Implemented and covered by service tests. |
| File operations | Source-material IPC exposes workspace registration/status, import, list, original bytes, page text, page images, page ranges, extraction status, search, delete, and restore. The renderer IPC boundary checks that the sender is the main window. | Implemented in source; complete packaged-Electron authorization/runtime behavior still needs end-to-end verification. |
| File formats | The current source-material import UI advertises PDF, TXT, Markdown, and CSV. Tests cover text normalization, unsupported inputs, PDF page ranges, original PDF bytes, and rendered page images. | Partial format scope only. Do not claim general office-document or arbitrary-file extraction support. |
| AI access | The Core MCP server is built into the desktop bundle. Its launch contract passes explicit DB/blob paths and subject `studio-ai`; source-material service tests assert that the AI subject receives read but not write permission for a registered Workspace. | Implemented in code/tests; real CLI AI tool round-trip and packaged startup remain unverified here. |
| Canonical document store | Studio `main.ts` still constructs `SharedWorkspaceDocStore`; the source-material service is a separate Core-backed library. | Not migrated. Core is not yet the canonical store for Studio's document editing, folders, revisions, recovery, and shared-workspace persistence. |
| Data migration | No reviewed importer proves lossless migration of the current document store, folders, versions, recovery files, and shared-workspace state into Core. | Not implemented / not verified. |
| Quality and release evidence | Studio Checks run [40689547338](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/actions/runs/40689547338) passed the reported CI jobs. Release run [40689547340](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/actions/runs/40689547340) failed at release creation with `Release.target_commitish is invalid`; the proposed correction is in [PR #35](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/pull/35), whose Checks workflow completed successfully. | CI evidence only; the failed release has not been re-run and published artifacts have not been verified. |

### Updated next steps

1. Keep `SharedWorkspaceDocStore` as the canonical editor/document store while the source-material library is validated.
2. Run a packaged Windows Electron test that starts the bundled Core MCP server, enumerates tools, imports a fixture into an explicitly selected Workspace, reads a page range and original bytes, performs a read-only AI query, and confirms unauthorized mutation is rejected.
3. Verify that the UI, in-process service, and MCP server all use the intended Core database/blob directory and that no second unintended database is opened.
4. Add failure-injection coverage for Core process startup failure, malformed input, timeout, database lock, and restart; verify the UI reports errors rather than empty-success results.
5. Only after the above, design a separate migration specification for the existing document store. Include dry-run, ID collision handling, content hashes, backups, recovery, rollback, and explicit user approval.
6. Keep file-format capability claims limited to operations covered by fixtures and tests. A PDF being stored or rendered does not by itself prove accurate extraction for every PDF type.

### Verification labels

- **Implemented in source:** Core-backed source-material service, explicit Workspace registration, bundled Core MCP entrypoint, PDF page access, source-material IPC.
- **Automated coverage present:** source-material service tests cover explicit Workspace selection, PDF page access/ranges, original bytes, read-only AI permission grant, text normalization, unsupported files, and workspace isolation.
- **CI-confirmed:** the referenced Studio Checks run passed; the PR #35 Checks workflow passed.
- **Not verified by this audit:** real packaged desktop MCP round-trip, performance/accuracy across representative PDFs and target hardware, complete format coverage, lossless migration, Core as canonical editor/document store, release publication after the fix.
