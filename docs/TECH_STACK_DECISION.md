# SIGMA Core — Technology Stack Decision

Status: Architecture direction approved; package and runtime compatibility gates remain open.

## Purpose

SIGMA Core is a new implementation dedicated to SIGMA Studio. It is not a continuation of legacy SIGMACore or knowledgeDB. Its primary responsibility is the canonical data layer: persistence, data integrity, search primitives, source provenance, authorization, and backup/restore. AI inference is delegated to CLI-based AI and Web AI providers.

## Approved architecture

### Two interfaces, one Core

SIGMA Core exposes two distinct interfaces over the same service layer and canonical data model:

1. **User-facing interface/API** — for people to browse, search, inspect provenance, edit or delete data, and manage backup/synchronization.
2. **AI-facing interface** — MCP tools and APIs for AI clients to search, retrieve source passages, inspect provenance, and perform explicitly authorized data operations.

These are two interfaces, not two databases. Both must use the same authorization-enforcing application services. Do not duplicate business rules or let either adapter bypass validation and permissions.

### MCP topology

Support both:
- **Local MCP server** for compatible local clients, including CLI-based AI.
- **Remote MCP server** for compatible Web AI services and remote clients, with authenticated access.

Both adapters call the same Core service/API contracts. A remote MCP server must not assume it can reach a user's local process or local database: remote connectivity, user authentication, authorization, transport security, and whether a request can be served from local or server-side data must be explicitly implemented and tested. Do not create an independently authoritative second database merely to expose remote MCP.

MCP is a tool interface, not an AI capability guarantee. Search, embeddings, reranking, and web browsing may be delegated to a provider only when that provider actually exposes the required capability and access path.

### Data authority and backup

- Local data is canonical.
- The cloud service is initially a backup destination, not an independently authoritative live database.
- Encrypt data client-side before upload.
- Support manual and automatic backups.
- Detect conflicts, retain history, and require user resolution where needed.
- Workspace selection is user-controlled; do not create a separate canonical database per Workspace.
- Search indexes and embeddings are derived data and must be rebuildable. Preserve source provenance and the metadata needed to rebuild them.

## Database decision

**SQLite is the initial local canonical database**, subject to clean-install, Electron ABI, supported-OS/CPU, backup/restore, and concurrency tests. Keep original file bytes in separate content-addressed file storage. Use SQLite FTS5 as the initial keyword-search baseline; Japanese search quality and substring behavior require dedicated fixtures and measurement.

Do not add a vector extension or embedding model until retrieval requirements and Japanese evaluation fixtures are defined. Keep a provider-neutral interface so embeddings or reranking can be delegated to a compatible AI provider, with a local fallback where required. The Core remains responsible for canonical data, deterministic filtering, authorization, provenance, and safe fallback behavior.

The exact remote data-serving mechanism remains an implementation gate. Do not assume that an encrypted backup is queryable, and do not silently turn the backup into a second source of truth. Evaluate a secure local gateway versus a separately derived/queryable server index only against the required Web AI connectivity and offline behavior.

## Runtime and dependency feasibility

Use TypeScript on Node.js with ESM for the initial Core service and adapters, subject to package/runtime verification. Keep format-specific extraction behind adapters so isolated workers can be added only when justified.

- Keep `better-sqlite3` as the initial SQLite driver, subject to reproducible install and Electron native-addon smoke tests.
- Use SQLite FTS5 for the initial keyword baseline; do not claim high-quality Japanese morphological search without evidence.
- Expose Core functionality through the official TypeScript MCP SDK, but pin the SDK major and TypeScript versions only after checking the current official requirements, license, lockfile, and actual tool-call tests.
- Add outbound MCP client functionality only when a first milestone needs Core itself to call external MCP servers.
- Keep PDF/Office parsers behind adapters and do not claim format support before fixture tests pass.
- Do not select embeddings, vector search, reranking, or OCR packages merely to fill out the architecture; validate Japanese quality, privacy, offline behavior, licensing, and packaging first.

## Implementation sequence

1. Generate and commit a real `package-lock.json`; audit exact dependency versions, licenses, advisories, and transitive dependencies; use `npm ci` in CI.
2. Confirm the supported Electron/Node, OS, and CPU matrix; run clean install and native SQLite smoke tests.
3. Implement a shared application-service layer with authorization and provenance, independent of UI and MCP transport.
4. Implement user-facing and AI-facing adapters over that same service layer.
5. Add local MCP and validate a real tool invocation, including denied/invalid requests.
6. Implement remote MCP only with explicit authentication, authorization, secure transport, and a tested remote data path. Keep cloud backup semantics separate from query-serving semantics.
7. Add file extraction and keyword search with Japanese/English fixtures, source locations, resource limits, and failure tests.
8. Evaluate embeddings, vector retrieval, and AI/provider-based reranking against a measured Japanese retrieval set before selecting concrete packages.

## Mandatory acceptance checks

- Clean `npm ci` install and passing typecheck/unit tests.
- Electron/OS/CPU packaging and native SQLite loading smoke-tested.
- User-facing and AI-facing adapters share the same authorization-enforcing service layer.
- Real MCP calls tested for success, invalid input, permission denial, and unavailable dependencies.
- Remote MCP authentication and data reachability tested without exposing a local database directly to the public internet.
- Backup/restore, client-side encryption, conflict history, and failure recovery tested.
- Japanese and English fixtures verify search quality and retained source provenance.
- Malformed, encrypted, oversized, and archive-heavy inputs fail safely under explicit limits.
- Report implemented, tested, partially supported, and unverified capabilities separately.

## Primary sources

- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP server package: https://www.npmjs.com/package/@modelcontextprotocol/server
- MCP client API: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/client/
- Zod v4: https://zod.dev/v4
- better-sqlite3: https://www.npmjs.com/package/better-sqlite3
- SQLite FTS5: https://www.sqlite.org/fts5.html
- pdfjs-dist: https://www.npmjs.com/package/pdfjs-dist
- Mammoth and its security note: https://www.npmjs.com/package/mammoth and https://github.com/mwilliamson/mammoth.js
- file-type: https://github.com/sindresorhus/file-type

## Non-goals

- Do not migrate legacy SIGMACore/knowledgeDB data.
- Do not create separate user-facing and AI-facing databases.
- Do not make the cloud backup an independent source of truth.
- Do not install every candidate package at once.
- Do not claim format, search, or MCP capabilities before the corresponding tests pass.
- Do not put dependency comparison tables in README.
