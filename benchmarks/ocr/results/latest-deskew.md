# OCR benchmark

- Generated: 2026-10-27T15:06:35.260Z
- Dataset: Synthetic OCR regression cases. PDF cases use the embedded-font Japanese fixture; canvas cases render text with a system font. Categories are printed-document, table, multi-column, formula, photo, and handwriting-proxy. These are not representative scans.
- Preprocessing: deskew
- Platform: linux x64
- Node.js: v24.21.0
- Tesseract: 5.3.4

| Case | Category | Language | CER | WER | Confidence | ms |
|---|---|---|---:|---:|---:|---:|
| ja-p1-clean | printed-document | jpn+eng | 3.33% | n/a | 0.8529 | 1150 |
| ja-p1-low-res | printed-document | jpn+eng | 10.00% | n/a | 0.6810 | 938 |
| ja-p1-rotate-2 | printed-document | jpn+eng | 3.33% | n/a | 0.8110 | 1341 |
| ja-p1-blur-1 | printed-document | jpn+eng | 0.00% | n/a | 0.9078 | 1015 |
| ja-p1-noise | printed-document | jpn+eng | 0.00% | n/a | 0.8602 | 1608 |
| ja-p1-low-contrast | printed-document | jpn+eng | 100.00% | n/a | n/a | 754 |
| ja-p2-clean | printed-document | jpn+eng | 0.00% | n/a | 0.9007 | 956 |
| ja-p2-low-res | printed-document | jpn+eng | 31.58% | n/a | 0.7477 | 670 |
| ja-p2-rotate-2 | printed-document | jpn+eng | 0.00% | n/a | 0.9007 | 898 |
| ja-p2-blur-1 | printed-document | jpn+eng | 0.00% | n/a | 0.9181 | 866 |
| ja-p2-noise | printed-document | jpn+eng | 0.00% | n/a | 0.9101 | 1466 |
| ja-p2-low-contrast | printed-document | jpn+eng | 100.00% | n/a | n/a | 702 |
| en-clean | printed-document | eng | 0.00% | 0.00% | 0.9621 | 307 |
| en-low-res | printed-document | eng | 0.00% | 0.00% | 0.9578 | 271 |
| en-rotate-2 | printed-document | eng | 0.00% | 0.00% | 0.9639 | 587 |
| en-blur-1 | printed-document | eng | 0.00% | 0.00% | 0.9610 | 310 |
| en-noise | printed-document | eng | 0.00% | 0.00% | 0.9639 | 457 |
| en-low-contrast | printed-document | eng | 0.00% | 0.00% | 0.9605 | 302 |
| en-table-clean | table | eng | 0.00% | n/a | 0.9574 | 507 |
| en-table-low-res | table | eng | 0.00% | n/a | 0.9664 | 379 |
| en-columns-clean | multi-column | eng | 30.14% | 33.33% | 0.9637 | 563 |
| en-formula-clean | formula | eng | 21.74% | n/a | 0.5299 | 375 |
| en-photo-clean | photo | eng | 0.00% | 0.00% | 0.9230 | 609 |
| en-handwriting-clean | handwriting-proxy | eng | 7.14% | 33.33% | 0.9351 | 262 |

## Category summary

| Category | Cases | Mean CER | Mean WER |
|---|---:|---:|---:|
| printed-document | 18 | 13.79% | 0.00% |
| table | 2 | 0.00% | n/a |
| multi-column | 1 | 30.14% | 33.33% |
| formula | 1 | 21.74% | n/a |
| photo | 1 | 0.00% | 0.00% |
| handwriting-proxy | 1 | 7.14% | 33.33% |

- Mean CER: 12.80%
- Mean WER (English cases): 7.41%
- Confidence vs CER: Pearson -0.531, Spearman -0.487 (n=24)
- Total OCR time: 17296 ms
- Peak RSS: 214.8 MiB

Synthetic cases are regression signals. Table, column, formula, photo, and handwriting proxies are rendered with system fonts and distortions; they do not establish accuracy on representative scans or target hardware.
