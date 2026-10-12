# SIGMA Core — Library and Technology Evaluation

**Status:** Initial evaluation recorded; no new dependency approved by this document.
**Date:** 2026-10-12
**Scope:** Initial dependency shortlist and validation gates. This is not a claim that candidate libraries have been installed or tested in SIGMA Core.

## Executive summary

Do not add a PDF, Office, OCR, embedding, or vector-search dependency until the feasibility spike is reproducible and representative fixtures pass. Keep the existing implementation intact during evaluation; do not treat the current `better-sqlite3` implementation as proof that SQLite has been selected as the final canonical database.

The current design target is local-first, single-device-first, a common canonical database, original bytes stored separately, rebuildable indexes, and a future path for CLI/Web AI, MCP, and Skills. Prefer the smallest stack that meets these requirements without blocking future extension.

## Candidate assessment

| Capability | Candidate | Preliminary fit | Risks / open checks | Status |
|---|---|---|---|---|
| Runtime | TypeScript + Node.js | Strong ecosystem and straightforward integration with a JavaScript/Electron host | Confirm supported Node/Electron versions, packaging, native module rebuilds, process isolation, and CLI support | Candidate; not finally approved |
| Relational canonical store | SQLite via current `better-sqlite3` implementation | Local deployment, transactions, schema migrations; can keep metadata and provenance in one file | Native addon packaging across OS/CPU; write concurrency; backup/restore while open; FTS5 availability in the bundled SQLite; operational requirements for multiple processes | Existing implementation; final engine decision open |
| Relational alternative | PostgreSQL | Strong multi-client concurrency and mature transactions | Requires service installation/operation for local-first use; adds deployment, backup, upgrade, and support burden | Alternative; no migration authorized |
| Full-text search | SQLite FTS5 (if SQLite remains selected) | Avoids another service; supports token-based full-text matching, snippets, and ranking functions | Confirm the actual SQLite build includes FTS5; Japanese tokenization/search quality requires dedicated evaluation and may need a tokenizer strategy | Candidate; unverified in this project |
| Vector search | PostgreSQL + pgvector, or a separate rebuildable local vector index | pgvector supports exact/approximate nearest-neighbor search when PostgreSQL is available | A PostgreSQL server is a material deployment choice; separate indexes introduce consistency and rebuild complexity. Local vector option not yet selected | Open; do not add yet |
| PDF text extraction | Mozilla PDF.js / `pdfjs-dist` | JavaScript implementation and page-level text extraction are a plausible fit | Verify the published package entry points, current supported Node range, worker behavior, license notices, memory/time limits, malformed/encrypted PDF behavior, and Japanese fixtures. Upstream's current package metadata has a Node engine floor higher than plain `>=22`, so choose a compatible pinned release only after checking its exact metadata | Candidate only; not installed/tested here |
| DOCX / XLSX | Separate format-specific parser candidates, to be evaluated independently | Separate adapters allow format-specific validation and provenance | Do not select a generic “supports many formats” package without inspecting transitive dependencies, archive-bomb defenses, macros/embedded content behavior, table/formula fidelity, and license | Not selected |
| OCR / image / audio / video | Separate adapters or isolated workers, chosen by declared operations | Prevents one heavyweight runtime/dependency from controlling all formats | Hardware, offline requirements, models, licensing, binary distribution, privacy, quality thresholds, and resource limits are not yet specified | Not selected |
| Embeddings / model provider | Provider-neutral interface; choose model/provider after retrieval requirements are tested | Allows local and hosted options to be compared without binding the data model to one provider | Japanese quality, dimensions, licensing, offline operation, cost, privacy, model versioning, and index rebuilds remain open | Interface direction only; provider/model not selected |

## Decision gates

No dependency should be marked **selected** until all relevant gates are recorded:

1. **Requirements:** formats, operations, supported platforms, offline expectations, maximum file sizes, expected corpus, and user workflows.
2. **Package verification:** exact package name and pinned version, release activity, supported Node/Electron versions, license and notice obligations, transitive dependencies, known advisories, native binaries, and package size.
3. **Representative fixtures:** Japanese and English text; multi-page PDF; scanned PDF; encrypted/malformed file; DOCX/XLSX with tables and embedded content; large and adversarial archive cases where applicable.
4. **Fidelity:** compare output to known expected text/structure; retain page/region/row/slide provenance; explicitly report gaps rather than silently returning partial success.
5. **Safety:** size/time/memory bounds; no execution of embedded files/macros; archive expansion limits; cancellation; isolation for risky parsers.
6. **Operational behavior:** Windows/macOS/Linux packaging where supported; startup latency; UI responsiveness; cancellation and recovery; no loss of original bytes on parser failure.
7. **Reproducibility:** lockfile, clean install, unit/integration tests, CI on supported platforms, and documented acceptance thresholds.
8. **Reconsideration cost:** keep parsers behind adapters; canonical records must not depend on a parser's proprietary object model.

## Initial database recommendation (not final approval)

Keep SQLite as the leading local-first candidate while testing the actual build and FTS5 behavior. Do not switch to PostgreSQL solely to obtain vector search: first determine whether SIGMA Core's deployment model can support a managed PostgreSQL service and whether a separate derived vector index is acceptable. The canonical store must remain authoritative and indexes must be rebuildable.

The current repository's `better-sqlite3` usage is an implementation already present, not a completed comparison against PostgreSQL or a formal approval of the long-term database.

## Immediate evaluation sequence

1. Record the target OS, Electron/Node versions, offline requirements, and expected library size.
2. Add a dependency inventory with exact versions and licenses for packages already present.
3. Verify the current SQLite binary's FTS5 capability and test Japanese full-text behavior.
4. Build a small PDF.js feasibility spike outside production ingestion, using fixed fixtures and expected per-page output. Do not wire it into ingestion until it passes.
5. Compare at least one DOCX and XLSX parser using the same fidelity/security checklist.
6. Evaluate embedding candidates only after defining search queries and quality measures.
7. Make one documented decision at a time; update package manifests and lockfile only after the relevant gate passes.

## Primary sources

- SQLite FTS5 documentation: https://www.sqlite.org/fts5.html
- pgvector upstream repository and installation/platform notes: https://github.com/pgvector/pgvector
- Mozilla PDF.js upstream repository: https://github.com/mozilla/pdf.js
- PDF.js upstream package metadata (engine and license must be checked again for the exact release selected): https://github.com/mozilla/pdf.js/blob/master/package.json
- SIGMA Core's current implementation manifest: https://github.com/nishida0402shun-dev/SIGMA-Core/blob/main/package.json
- SIGMA Core's design decision record: https://github.com/nishida0402shun-dev/SIGMA-Core/blob/main/docs/DECISIONS.md

## Verification record

- Repository manifest and design documents were inspected on 2026-10-12.
- Public upstream repository/package metadata and SQLite/pgvector documentation were inspected for this shortlist.
- No dependency was installed or added as part of this evaluation.
- No PDF, DOCX, XLSX, FTS5, or embedding feasibility test is claimed to have passed.
