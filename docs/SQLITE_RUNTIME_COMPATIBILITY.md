# SQLite Runtime Compatibility — SIGMA Core

**Status:** Partial verification only. Do not treat this document as proof that a packaged Electron application loads every SQLite driver on every supported OS/CPU.

## Repository evidence

- SIGMA Core declares `node >=22` in `package.json`.
- `src/db/sqlite-driver.ts` tries Node's built-in `node:sqlite` first, then falls back to the optional `better-sqlite3` package.
- The current CI runs the Core test suite and TypeScript type-check on Linux. The SQLite capability test verifies FTS5 table creation and matching in the runtime selected by `openSqliteDatabase()`.
- SIGMA Studio's `apps/desktop/package.json` declares Electron `^44.5.1`; its committed lockfile currently resolves Electron `44.7.0`.
- Electron's official release page identifies Node.js `24.21.0` for Electron `44.7.0`: [Electron v44.7.0 release](https://releases.electronjs.org/release/v44.7.0). This is why Node 24 is included in the Core CI matrix. Node 24 CI is a useful runtime check, but is **not** an Electron process or native-addon ABI test.

## Verification matrix

| Environment | Automated check | Status / meaning |
|---|---|---|
| GitHub Actions, Ubuntu, Node 22 | `npm ci`, audit, license inventory, tests, type-check | Previously passed on main; the expanded matrix is intended to rerun it |
| GitHub Actions, Ubuntu, Node 24 | Same checks | Added by the runtime-matrix change; result pending until its CI run completes |
| Electron 44.7.0 main process | Launch Core and execute SQLite/FTS5 smoke tests inside Electron | **Not yet verified** |
| `better-sqlite3` rebuilt for Electron's ABI | Load native addon and run transaction/FTS5 tests inside Electron | **Not yet verified** |
| macOS / Windows / Linux packaged artifacts, supported CPU architectures | Build, launch, open DB, migrate schema, search, backup/restore | **Not yet verified** |

## Important implementation detail

The Core driver prefers `node:sqlite` whenever it can be loaded. Consequently, a passing test on Node 22 or 24 primarily verifies that runtime's built-in SQLite implementation; it does not prove that the `better-sqlite3` fallback works. The fallback is a native addon and must be rebuilt and loaded against the actual Electron runtime before it can be considered supported.

Do not infer a platform support commitment from the CI runner's OS. The current workflow runs on Ubuntu only.

## Required follow-up before shipping in Electron

1. Decide whether production Electron should use its built-in `node:sqlite` or `better-sqlite3`; do not rely on silent fallback to decide production behavior.
2. Add a smoke test launched by the exact locked Electron version that prints Electron/Node/SQLite versions, opens a temporary database, runs schema migration and transaction rollback, creates an FTS5 table, and performs a query.
3. If `better-sqlite3` is selected, rebuild it for the exact Electron ABI and test the packaged app, not only the development Node process.
4. Run packaging and smoke tests for each explicitly supported OS/CPU target. Record actual results before claiming support.
5. Verify that the packaged application's native module inclusion and ASAR/unpacked configuration match the selected driver.

## Sources

- [SIGMA Core package manifest](../package.json)
- [SQLite driver implementation](../src/db/sqlite-driver.ts)
- [SQLite capability tests](../tests/sqlite-capabilities.test.ts)
- [SIGMA Studio desktop package manifest](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/blob/main/apps/desktop/package.json)
- [SIGMA Studio lockfile](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/blob/main/package-lock.json)
- [Official Electron v44.7.0 release metadata](https://releases.electronjs.org/release/v44.7.0)
