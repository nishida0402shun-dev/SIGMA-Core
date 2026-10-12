# SIGMA Core — Format Library Shortlist

**Reviewed:** 2026-10-12  
**Decision status:** Shortlist only. No candidate below is approved for production or added as a dependency. Published registry metadata can change; verify the exact pinned package tarball and metadata again before selection.

## Summary

| Format | Candidate | Public metadata observed | Fit | Risks / required spike |
|---|---|---|---|---|
| PDF | `pdfjs-dist` | npm listed version 6.4.299, Apache-2.0, 0 runtime dependencies, published about a week before this review | Direct PDF.js API offers fine-grained per-page text extraction and less wrapper abstraction | Verify exact Node engine requirements and Electron compatibility for this version; worker/standard-font packaging; memory/time limits; encrypted and malformed files; scanned PDFs need OCR; Japanese reading order and columns need fixtures |
| PDF | `unpdf` | npm listed version 1.8.1, MIT, 0 runtime dependencies, published about two months before this review; bundles a serverless PDF.js build | Convenience API for page text, links, and text items; may simplify Node/serverless setup | Adds wrapper/build choices and the bundled PDF.js version; its documentation warns that page fan-out and image-size/time limits are the application's responsibility; structured text items have additional requirements |
| DOCX | `mammoth` | npm listed version 1.13.0, BSD-2-Clause, published about 11 days before this review | Maintained DOCX-to-HTML/text-oriented conversion; raw text extraction available | Not a faithful Word renderer; source document HTML output is not sanitized; untrusted input must not be rendered without sanitization; test tables, headers/footers, footnotes, tracked changes, images, hyperlinks, and Japanese layout |
| XLSX | `exceljs` | npm listed version 4.4.0, MIT; registry showed last publish about two years before this review | Broad workbook model and access to sheets, rows, cells, formulas, and styles | Release cadence is a maintenance-review item; test formulas vs cached values, merged cells, hidden sheets, dates, external links, macros (XLSM is not the same as XLSX), large workbooks, and resource limits |

## Preliminary recommendation

1. **PDF:** Start the feasibility spike with direct `pdfjs-dist` because the required provenance includes per-page extraction and the direct API avoids an extra abstraction. This is a test candidate, not a production approval. If the current release's Node/Electron engine requirements or worker packaging conflict with the target runtime, compare a compatible pinned PDF.js release or `unpdf`.
2. **DOCX:** Use `mammoth` as the first spike candidate for text-oriented extraction, not as a complete fidelity representation of Word. Treat its output as untrusted and keep original bytes unchanged.
3. **XLSX:** Use `exceljs` as the first spike candidate, but require a release/maintenance review before approval. Preserve cell coordinates, sheet names, formula and cached-value distinctions, and number formats in normalized extraction records.
4. Keep all three behind format-specific adapters. Do not let library-specific object models become the canonical data model.
5. Do not add OCR, vector, or embedding dependencies in this step. Scanned PDF support is a separate capability requiring an OCR model/runtime decision.

## Acceptance tests before adding dependencies

- A committed fixture set with known expected output: Japanese and English; multi-page PDF; columns and tables; blank pages; rotated pages; encrypted and malformed PDF; DOCX tables/headers/footers/images; XLSX multiple sheets, formulas, cached values, merged cells, hidden sheets, dates, and large sparse sheets.
- Per-page, per-paragraph, or per-sheet/cell provenance sufficient to jump back to the original source.
- Explicit partial-success and unsupported-format statuses; no silent claim of complete extraction.
- File-size, page-count, ZIP expansion, memory, and wall-clock limits; cancellation and cleanup.
- License notices and full transitive dependency/advisory inventory based on the exact lockfile-resolved tree.
- Reproducible clean install and tests in CI, followed by target Electron packaging checks.
- A benchmark and expected-output diff; no performance or fidelity claim until measured.

## Dependency reproducibility blocker

The repository currently has no committed `package-lock.json`, and CI uses `npm install`. Therefore exact resolved versions and the full transitive dependency tree are not yet available for a defensible license/advisory audit. Do not hand-write a lockfile. Generate it with npm in a controlled checkout, commit it, change CI to `npm ci`, and verify a clean install before approving any parser dependency.

## Sources

- PDF.js package: https://www.npmjs.com/package/pdfjs-dist (version, license, dependency count, publish date); upstream: https://github.com/mozilla/pdf.js
- unpdf package: https://www.npmjs.com/package/unpdf (version, license, dependency count, API and untrusted-PDF resource-limit guidance); upstream: https://github.com/unjs/unpdf
- Mammoth package: https://www.npmjs.com/package/mammoth (version, license, publish date); upstream and security note: https://github.com/mwilliamson/mammoth.js
- ExcelJS package: https://www.npmjs.com/package/exceljs (version, license, publish date); upstream: https://github.com/exceljs/exceljs
- SIGMA Core manifest: https://github.com/nishida0402shun-dev/SIGMA-Core/blob/main/package.json
- SIGMA Core CI: https://github.com/nishida0402shun-dev/SIGMA-Core/blob/main/.github/workflows/ci.yml
