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

