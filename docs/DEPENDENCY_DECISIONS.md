# SIGMA Core — Recommended OSS and Package Decisions

**Review date:** 2026-10-12  
**Purpose:** Decide what to use, not maintain an ever-growing comparison catalogue.  
**Status:** Recommended baseline; package-lock.json is now generated and committed on the active work branch, and CI uses npm ci. Exact-version license review, native-addon packaging, and representative tests remain gates.

## Decision summary

| Area | Recommendation | State | Reason / constraint |
|---|---|---|---|
| Runtime | TypeScript + Node.js, ESM | Select | Fits SIGMA Studio's JavaScript/Electron environment and one shared service layer. Keep format-specific adapters. |
| TypeScript compiler | Upgrade to TypeScript 6.x before adopting MCP SDK v2 | Select direction; pin after install test | Official MCP SDK v2 docs specify TypeScript >=6.0 for its published declarations. |
| Canonical DB | SQLite | Select as initial local-first canonical DB, subject to packaging gate | Single-device-first transactional metadata without a separate service. Original bytes remain in separate file storage. One common DB, not one per Workspace. |
| SQLite driver | Keep better-sqlite3; update to a compatible exact version only after reproducible install and Electron ABI checks | Select family; defer version update | Already used; FTS5 capability passed CI. Native addon packaging must be tested across target OS/CPU/Electron versions. |
| Keyword search | SQLite FTS5 | Select baseline; Japanese quality still open | Avoids a separate search service. Built-in unicode61 is not a Japanese morphological analyzer. Test trigram for substring matching before adding a tokenizer. |
| Vector search | No vector extension yet; keep an adapter boundary | Defer | sqlite-vec has a reported npm latest-tag alpha issue in 2026. Decide with embeddings, Japanese retrieval metrics, and platform packaging. |
| MCP server | @modelcontextprotocol/server v2 | Select direction | Official SDK v2 package for exposing Core tools to MCP hosts. Verify exact package license and transitive dependencies from resolved metadata. |
| MCP client | @modelcontextprotocol/client v2 | Conditional | Add if Core must call external MCP servers; omit if the first milestone only exposes Core tools. |
| MCP schemas | zod v4 | Select with MCP v2 | Official SDK v2 examples use zod/v4. Validate untrusted tool inputs at service boundaries. |
| Binary file identification | file-type plus explicit text-format sniffing; extension only as a hint | Select direction | Magic-number detection is a best-effort signal, not proof of validity. Text/CSV/SVG need separate handling. |
| PDF extraction | pdfjs-dist 6.4.299 as first candidate | Conditional on runtime | Apache-2.0 and page-level API suit provenance. Published metadata indicates Node >=22.22.3 or >=24.15.0 or >=26.0. Confirm actual Electron/Node runtime before adoption. Scanned PDFs require a separate OCR decision. |
| DOCX extraction | mammoth 1.13.0 for text-oriented extraction | Select for fixture spike, not production yet | BSD-2-Clause. Not a full Word renderer; output is not sanitized. Never render its HTML as trusted content. Audit ZIP/XML handling and dependencies. |
| XLSX extraction | Do not select ExcelJS by default yet; test @stackline/xlsx against @office-kit/xlsx | Defer final package choice | ExcelJS 4.4.0 has no recent stable release in npm metadata. Newer alternatives have smaller adoption or pre-1.0 risk; choose only after fixture and provenance review. |
| OCR | No package/model yet | Defer | Offline requirements, Japanese quality, model license/size, and isolation need decisions. |
| Embeddings | No provider/model yet; define interface only | Defer | Need privacy/offline, Japanese quality, dimensions, licensing, cost, and re-embedding policy. |
| Archive parsing | Use format parser's supported APIs; add a separate ZIP library only for a concrete need | Defer | Avoid duplicate archive code. Enforce decompressed-size, entry-count, path traversal, and time limits. |
| Testing | Keep Vitest; add fixture-based integration tests | Keep | Existing test runner. CI success is not evidence of real PDF/Office extraction fidelity. |
| Dependency locking | package-lock.json + npm ci | Required before adding parser/MCP packages | No lockfile currently exists. Generate it using npm in a real checkout; never hand-author it. |

## Implementation sequence

1. Establish the target runtime matrix: SIGMA Studio Electron version, embedded Node version, supported OS/CPU, and whether Core runs in-process or as a child process. This gates PDF.js and native SQLite.
2. **Done on the active work branch:** generate package-lock.json with npm and change CI to npm ci. Still required: review the locked tree for licenses/notices and validate native-addon packaging.
3. Pin compatible TypeScript 6.x, better-sqlite3, and Vitest versions. Run typecheck, unit tests, clean install, and Electron native-addon smoke tests. Do not upgrade every package blindly.
4. Add MCP v2 server support first; add the MCP client only if outbound tool calls are in the first milestone. Test an actual tool invocation through the shared authorization service.
5. Add file-type and pdfjs-dist behind adapters and test committed Japanese/English PDF fixtures with page provenance and resource limits.
6. Add mammoth only after DOCX fixtures confirm the required text/structure. Never treat generated HTML as trusted UI content.
7. Decide XLSX only after fixture comparisons; popularity and marketing claims are not acceptance evidence.
8. Evaluate vector search and embeddings last, after keyword query sets, offline/privacy requirements, and quality metrics are defined.

## Mandatory acceptance checks

- Exact versions, integrity hashes, licenses/notices, transitive dependencies, and advisory results captured from lockfile/SBOM review.
- Clean npm ci install; CI passes on the selected Node version.
- Electron/OS/CPU packaging and native SQLite loading are smoke-tested.
- Japanese and English fixtures have expected outputs checked into tests.
- PDF page indices and Office sheet/cell/paragraph provenance are retained where available.
- Malformed, encrypted, oversized, and archive-heavy inputs fail safely under explicit limits.
- Original bytes remain unchanged when extraction fails or is cancelled.
- Every capability reports supported / partial / unsupported / unverified accurately.

## Primary sources

- MCP SDK v2: https://github.com/modelcontextprotocol/typescript-sdk
- MCP server package: https://www.npmjs.com/package/@modelcontextprotocol/server
- MCP client API: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/client/
- Zod v4: https://zod.dev/v4
- better-sqlite3 package and engine metadata: https://www.npmjs.com/package/better-sqlite3 and https://github.com/WiseLibs/better-sqlite3/blob/master/package.json
- SQLite FTS5: https://www.sqlite.org/fts5.html
- pdfjs-dist: https://www.npmjs.com/package/pdfjs-dist
- Mammoth and its security note: https://www.npmjs.com/package/mammoth and https://github.com/mwilliamson/mammoth.js
- ExcelJS package/release history: https://www.npmjs.com/package/exceljs and https://github.com/exceljs/exceljs/releases
- file-type: https://github.com/sindresorhus/file-type
- sqlite-vec alpha dist-tag issue: https://github.com/asg017/sqlite-vec/issues/264
- XLSX alternatives: https://www.npmjs.com/package/@stackline/xlsx and https://www.npmjs.com/package/@office-kit/xlsx

## Non-goals

- Do not install every candidate at once.
- Do not add vector search only because semantic search is a long-term goal.
- Do not claim format support before fixture tests pass.
- Do not migrate legacy SIGMACore/knowledgeDB data.
- Do not put dependency comparison tables in README.
