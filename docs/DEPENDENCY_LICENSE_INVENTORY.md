# SIGMA Core — Locked Dependency License Inventory

**Source of truth:** `package-lock.json` (npm lockfile v3)  
**Generation:** `node scripts/check-license-inventory.mjs`  
**Scope:** All 69 resolved non-root package entries, including transitive, development, and optional dependencies.

This report reproduces the license metadata recorded in the committed npm lockfile. It is a screening inventory, **not legal advice** and not proof that all required license texts, notices, attribution, source offers, or distribution obligations have been satisfied. Package metadata can be incomplete or inaccurate; verify upstream license files and bundled native components before distribution. SPDX expressions are preserved as published and are not automatically adjudicated.

| Package | Locked version | Lockfile license metadata | Classification |
|---|---:|---|---|
| `@modelcontextprotocol/client` | 2.3.1 | Apache-2.0 | Production |
| `@modelcontextprotocol/core` | 2.3.1 | Apache-2.0 | Production |
| `@modelcontextprotocol/server` | 2.3.1 | Apache-2.0 | Production |
| `@napi-rs/canvas` | 1.0.13 | MIT | Optional |
| `@napi-rs/canvas-android-arm64` | 1.0.13 | MIT | Optional |
| `@napi-rs/canvas-darwin-arm64` | 1.0.13 | MIT | Optional |
| `@napi-rs/canvas-darwin-x64` | 1.0.13 | MIT | Optional |
| `@napi-rs/canvas-linux-arm-gnueabihf` | 1.0.13 | MIT | Optional |
| `@napi-rs/canvas-linux-arm64-gnu` | 1.0.13 | MIT | Optional |
| `@napi-rs/canvas-linux-arm64-musl` | 1.0.13 | MIT | Optional |
| `@napi-rs/canvas-linux-riscv64-gnu` | 1.0.13 | MIT | Optional |
| `@napi-rs/canvas-linux-x64-gnu` | 1.0.13 | MIT | Optional |
| `@napi-rs/canvas-linux-x64-musl` | 1.0.13 | MIT | Optional |
| `@napi-rs/canvas-win32-arm64-msvc` | 1.0.13 | MIT | Optional |
| `@napi-rs/canvas-win32-x64-msvc` | 1.0.13 | MIT | Optional |
| `@types/better-sqlite3` | 7.6.13 | MIT | Development |
| `@types/node` | 22.20.5 | MIT | Development |
| `base64-js` | 1.5.1 | MIT | Optional |
| `better-sqlite3` | 11.10.0 | MIT | Optional |
| `bindings` | 1.5.0 | MIT | Optional |
| `bl` | 4.1.0 | MIT | Optional |
| `buffer` | 5.7.1 | MIT | Optional |
| `chownr` | 1.1.4 | ISC | Optional |
| `cross-spawn` | 7.0.6 | MIT | Production |
| `decompress-response` | 6.0.0 | MIT | Optional |
| `deep-extend` | 0.6.0 | MIT | Optional |
| `detect-libc` | 2.1.2 | Apache-2.0 | Optional |
| `end-of-stream` | 1.4.5 | MIT | Optional |
| `eventsource` | 3.0.7 | MIT | Production |
| `eventsource-parser` | 3.1.1 | MIT | Production |
| `expand-template` | 2.0.3 | (MIT OR WTFPL) | Optional |
| `file-uri-to-path` | 1.0.0 | MIT | Optional |
| `fs-constants` | 1.0.0 | MIT | Optional |
| `github-from-package` | 0.0.0 | MIT | Optional |
| `ieee754` | 1.2.1 | BSD-3-Clause | Optional |
| `inherits` | 2.0.4 | ISC | Optional |
| `ini` | 1.3.8 | ISC | Optional |
| `isexe` | 2.0.0 | ISC | Production |
| `jose` | 6.2.12 | MIT | Production |
| `mimic-response` | 3.1.0 | MIT | Optional |
| `minimist` | 1.2.8 | MIT | Optional |
| `mkdirp-classic` | 0.5.3 | MIT | Optional |
| `napi-build-utils` | 2.0.0 | MIT | Optional |
| `node-abi` | 3.98.0 | MIT | Optional |
| `once` | 1.4.0 | ISC | Optional |
| `path-key` | 3.1.1 | MIT | Production |
| `pkce-challenge` | 5.0.1 | MIT | Production |
| `prebuild-install` | 7.1.3 | MIT | Optional |
| `pump` | 3.0.4 | MIT | Optional |
| `rc` | 1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) | Optional |
| `readable-stream` | 3.6.2 | MIT | Optional |
| `safe-buffer` | 5.2.1 | MIT | Optional |
| `semver` | 7.8.5 | ISC | Optional |
| `shebang-command` | 2.0.0 | MIT | Production |
| `shebang-regex` | 3.0.0 | MIT | Production |
| `simple-concat` | 1.0.1 | MIT | Optional |
| `simple-get` | 4.0.1 | MIT | Optional |
| `string_decoder` | 1.3.0 | MIT | Optional |
| `strip-json-comments` | 2.0.1 | MIT | Optional |
| `tar-fs` | 2.1.5 | MIT | Optional |
| `tar-stream` | 2.2.0 | MIT | Optional |
| `tunnel-agent` | 0.6.0 | Apache-2.0 | Optional |
| `typescript` | 5.9.3 | Apache-2.0 | Development |
| `undici-types` | 6.21.0 | MIT | Development |
| `unpdf` | 1.9.1 | MIT | Production |
| `util-deprecate` | 1.0.2 | MIT | Optional |
| `which` | 2.0.2 | ISC | Production |
| `wrappy` | 1.0.2 | ISC | Optional |
| `zod` | 4.6.7 | MIT | Production |

## Review notes

- `MISSING` license metadata causes the CI inventory check to fail. A present value still requires human review of the upstream package and shipped artifacts.
- `(MIT OR WTFPL)` and `(BSD-2-Clause OR MIT OR Apache-2.0)` are alternative-license expressions as recorded in the lockfile; this check does not choose a license on behalf of the project.
- Optional native package `better-sqlite3` is listed from lockfile metadata. This report does not enumerate OS-level libraries or prove Electron ABI compatibility.
- Security advisories are checked separately by `npm audit --omit=dev --audit-level=high`; that command is not a license compliance check.
- Before redistributing SIGMA Core, review applicable upstream `LICENSE`, `NOTICE`, and bundled third-party notices, including any native binaries included by the final packaging process.

## References

- [package.json](../package.json)
- [package-lock.json](../package-lock.json)
- [npm package-lock documentation](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json)
- [SPDX License List](https://spdx.org/licenses/)
