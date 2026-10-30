# SIGMA Studio source-material integration contract

**Status:** Implemented source-material integration; not a migration of Studio's canonical document store.

## Dependency and compatibility identity

SIGMA Core remains a private package (`@sigma-studio/core`). Studio consumes its
source through the `vendor/sigma-core` Git submodule and records the exact
submodule commit in Studio's Git tree. That commit SHA is the compatibility and
reproducibility identity for this integration. The package's internal `0.1.0`
version is not published or used as a runtime dependency version.

There is intentionally no Core release artifact or release-triggered Studio
update for this model. Studio's scheduled/manual update workflow checks Core
`main`, validates a candidate SHA, updates the submodule and workspace
lockfile, opens a review PR, and runs the full Studio checks. It does not
auto-merge. A change to this model requires a separate decision and migration
of the update workflow.

## Product boundary

Core provides source-material metadata, original-byte storage, extraction
records, and retrieval. Studio's existing SigmaDoc document, folder, revision,
recovery, and shared-workspace stores remain canonical for editing. Importing
source material into Core does not imply a lossless migration or replacement
of those stores.

Studio owns the integration adapter and its restricted `sigma-core-local`
stdio server. Core's general MCP entrypoint is not the Studio tool contract.
Studio adapters must use Core's service/auth layers and must not access the
Core database schema directly.

## Data, workspace, and authorization contract

- Database: `<app.getPath("userData")>/data/sigma-core/core.sqlite`.
- Original bytes: `<app.getPath("userData")>/data/sigma-core/blobs/`.
- Studio workspace IDs are mapped to `studio:<studio-workspace-id>`.
- Workspace registration is explicit. An unknown or unselected workspace
  fails closed; the service does not silently create/select a workspace.
- The AI integration subject is `studio-ai`. A registered workspace grants it
  `read`; it does not grant `write`, `delete`, or `admin`.
- The server process receives database path, blob path, and subject through
  environment variables. Identity is not selected by tool arguments.

## MCP surface

The supported tools are:

| Tool | Purpose | Access |
|---|---|---|
| `list_source_workspaces` | List explicitly registered readable workspaces | Read |
| `list_sources` | List source metadata in a workspace | Read |
| `search_sources` | Search indexed source text in a workspace | Read |
| `get_source` | Read source metadata and original-byte metadata | Read |
| `get_source_page` | Read one extracted page | Read |
| `get_source_page_range` | Read a bounded page range | Read |

These are the Studio-owned wrapper tools; their input/output schemas and
read-only annotations are verified by Studio tests. New tools, schema changes,
or broader permissions require coordinated Core/Studio tests and review.
Arbitrary SQL, paths, commands, and source mutation are not part of this
contract.

## Compatibility, CI, and data safety

- Core changes are identified by Git SHA. A candidate is not accepted based
  only on its package version or a successful Core-only build.
- Core CI must pass dependency audit, license inventory, tests, and typecheck.
  Studio's update PR must also pass the full Studio workflow, including
  packaged Windows MCP integration.
- Core SQLite migrations are forward-only. A binary that encounters a schema
  newer than it supports must fail rather than attempt an automatic downgrade.
- Back up the entire database and blob directory before schema-risk changes.
  Code rollback and data rollback are separate operations; see
  [Studio integration operations](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/blob/4d7c65988449e2643734518ca3c3a27836ab9784/docs/sigma-core-integration-operations.md).
- No Core package publication, installer publication, automatic update merge,
  or destructive migration is authorized by this contract.
