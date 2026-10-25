# File Recognition and Support Policy

**Status:** Requirements and validation policy. PDF text-page extraction, UTF-8 plain-text extraction, and standalone PNG/JPEG OCR behind an injected engine are implemented; OCR for text-less PDF pages and images is unverified for accuracy. Other listed formats are not yet claimed as supported.

## Definition

A format counts as supported only when SIGMA Core can recognize and analyze its contents for a declared operation with evidence from relevant tests. Being able to store, hash, list, or preview a file is not sufficient.

Support is operation-specific: a format may support text extraction but only partially support layout, formulas, embedded media, metadata, or semantic interpretation.

## Capability states

| State | Meaning |
|---|---|
| Supported | The declared content/operation has an implemented path and meets its documented validation criteria on representative tests. |
| Partially supported | Some content is recognized, but known structures, encodings, or cases are not reliably handled. Limitations must be visible. |
| Unsupported | No safe and suitable recognition/analysis path is available for the requested operation. |
| Unverified | There is insufficient implementation or test evidence to make a reliable support claim. |

Do not conflate unsupported with unverified.

## Current implementation matrix

| Format / operation | State | Evidence and limits |
|---|---|---|
| UTF-8 plain text / text extraction | Supported | `plainTextExtractor`; invalid UTF-8 fails closed. |
| PDF / text extraction | Partially supported | `builtin-pdf` extracts page text and page-level provenance from text PDFs. Encrypted, malformed, oversized, over-page-limit, and timed-out inputs fail closed. Pages without embedded text can be rasterized (unpdf + optional `@napi-rs/canvas`) and OCRed only when the host injects an `OcrEngine`; the stdio entrypoint injects a Tesseract 5 CLI adapter that reports itself unavailable when Tesseract is missing. OCR text is marked `partial` with `PDF_PAGE_OCR_APPLIED`. A two-page Japanese embedded-font fixture verifies basic Japanese text/page boundaries. OCR accuracy (CER/WER), multi-column reading order, complex layout, Windows/Tesseract packaging, and region-level coordinates remain unverified. |
| PNG / JPEG / OCR text extraction | Partially supported | `builtin-image-ocr` detects PNG and JPEG signatures and sends the image to an injected OCR engine as page 1. Success is marked `partial` with `IMAGE_OCR_APPLIED` and engine provenance. Missing/unavailable engines, empty OCR output, execution failures, timeouts, and oversized input fail closed. Only single-frame PNG/JPEG is claimed; EXIF orientation, GIF/WebP/TIFF, OCR language selection, and real-photograph accuracy remain unverified. |
| ZIP, Office, HTML, audio/video, embeddings | Unverified or unsupported | No production extractor is registered. A ZIP signature is recognized but its contents are not inspected. |

## Required recognition pipeline

1. Check file size and resource constraints before processing.
2. Identify actual format using safe inspection; do not trust extension alone.
3. Choose an appropriate recognizer/extractor adapter.
4. Preserve the original source and associate stable source identity.
5. Extract available content and structure, recording page/region/offset information where feasible.
6. Run format-appropriate validation and detect gaps, suspiciously empty output, duplicates, and malformed structure.
7. Record limitations, confidence/evidence, validation method, and unverified areas.
8. Present the result for preview and required approval before downstream use or formal registration.

Unknown files must not be executed to inspect them. Archives and compound formats need limits for recursion depth, entry count, decompressed size, and processing time. External converters must run within appropriate trust and resource boundaries.

## Keep representations separate

- **Original:** byte-preserved source when retained.
- **Faithful extraction:** content attributed to the source, not rewritten as an AI interpretation.
- **AI interpretation:** summaries, inferred structure, classifications, and generated content, linked to the exact source/extraction versions used.

OCR, vision, layout analysis, and conversion can be useful fallbacks, but their outputs are not automatically equivalent to faithful extraction. Label the method and uncertainty.

## Initial format-family inventory

This is a candidate inventory, not a statement that these formats already work. Each family needs a support matrix by specific format and operation.

- Documents: PDF, TXT, Markdown, RTF, DOCX, ODT, HTML/XML.
- Images: PNG and JPEG have an OCR path behind an injected engine; GIF, WebP, TIFF, SVG, and other image formats are not yet implemented.
- Spreadsheets/data: XLSX, ODS, CSV, TSV, JSON, XML, YAML, Parquet and similar structured data.
- Presentations: PPTX, ODP, and PDF-rendered slide decks.
- Audio: common encoded audio formats, with transcription and metadata handled as distinct capabilities.
- Video: common container/codec combinations, with metadata, frame sampling, OCR, and transcription tracked separately.
- Code/text source: common programming languages, configuration formats, notebooks, and plain-text logs.
- Archives/compound files: ZIP, TAR, and other archive types with strict extraction limits.
- Email and message exports: EML, MBOX, and common structured exports.
- 3D/CAD/scientific/specialist formats: evaluated individually; do not claim general support without suitable parsers and tests.
- Unknown/binary/proprietary formats: report as unsupported or unverified for content analysis unless a safe, validated recognizer is available.

The list is deliberately broad. Prioritize by actual user workflows and available trustworthy parsers rather than claiming universal coverage.

## Validation requirements

For each format/operation pair, record:
- test fixtures and representative edge cases;
- which content types are recognized (text, layout, tables, formulas, figures, audio, video, metadata, structure);
- page/region/offset provenance capabilities;
- known gaps and failure detection;
- quality checks and acceptance thresholds;
- dependency licensing, security, maintenance, and platform compatibility;
- performance/resource limits;
- whether OCR, conversion, or external AI is involved;
- whether user review is required before the result can be used.

No format should be marked fully supported solely because a library successfully opens it. Do not claim “all content extracted” without coverage evidence and explicit treatment of unverified regions.
