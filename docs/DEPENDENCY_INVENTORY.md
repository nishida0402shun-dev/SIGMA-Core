# SIGMA Core — Dependency Inventory

**Reviewed:** 2026-10-12  
**Scope:** Declared direct dependencies and reproducibility gaps. This is not a complete software bill of materials (SBOM) or a transitive-license/security audit.

## Manifest snapshot

Source: [package.json](https://github.com/nishida0402shun-dev/SIGMA-Core/blob/main/package.json)

| Package | Manifest range | Role | Current status |
|---|---|---|---|
| `better-sqlite3` | `^11.7.0` | Runtime SQLite binding; native addon | Present in implementation. Exact resolved version and native artifact not established because no lockfile is committed. |
| `@types/better-sqlite3` | `^7.6.12` | TypeScript declarations | Development-only; exact resolved version not established. |
| `@types/node` | `^22.0.0` | Node.js declarations | Development-only; exact resolved version not established. |
| `typescript` | `^5.7.0` | Type-check/build tooling | Development-only; exact resolved version not established. |
| `vitest` | `^2.1.0` | Test runner | Development-only; exact resolved version not established. |

The manifest declares Node.js `>=22`. That engine declaration alone does not prove compatibility with every Node 22 patch release or with any specific Electron runtime.

## Findings

1. **No `package-lock.json` is committed** on the inspected default branch. The exact dependency tree cannot be reconstructed from the manifest ranges alone.
2. CI currently runs `npm install`, rather than a lockfile-enforcing `npm ci` clean install.
3. `better-sqlite3` is a native addon. Packaging must validate the actual Node/Electron ABI and target OS/CPU combinations; the manifest is not sufficient evidence of cross-platform readiness.
4. This review did **not** complete a resolved-version license audit, transitive dependency inventory, or vulnerability/advisory audit. Upstream repositories' current default-branch metadata cannot be treated as the metadata for the versions that npm resolves from these ranges.
5. No new package is approved by this inventory.

## FTS5 capability test status

The test added in commit [c332fa0](https://github.com/nishida0402shun-dev/SIGMA-Core/commit/c332fa0c5ce5195f28c6d372c6da85a6bc7e6d27) was run by GitHub Actions run [#18](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/38228051933). The workflow completed with **success**: dependency installation, TypeScript type-check, and unit tests all passed.

This supports the tested CI environment's FTS5 capability and the specific assertions in the test. It does **not** establish generally good Japanese full-text search, morphological analysis, or compatibility across all packaged operating systems and SQLite builds.

## Required next steps before approving dependencies

- Generate and commit a lockfile through a real npm install in a controlled checkout; do not hand-author one.
- Switch CI to `npm ci` after the lockfile is committed, then confirm a clean install and all checks.
- Produce a license and advisory inventory from the resolved dependency tree (including transitive packages) and record the native build/runtime matrix.
- Keep PDF, DOCX, XLSX, OCR, embedding, and vector-search libraries unselected until their exact versions pass representative fixture, security, fidelity, license, and packaging gates.

## Sources

- [SIGMA Core package.json](https://github.com/nishida0402shun-dev/SIGMA-Core/blob/main/package.json)
- [SIGMA Core CI workflow](https://github.com/nishida0402shun-dev/SIGMA-Core/blob/main/.github/workflows/ci.yml)
- [better-sqlite3 upstream repository](https://github.com/WiseLibs/better-sqlite3)
- [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html)
