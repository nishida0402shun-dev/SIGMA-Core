# OCR benchmark

- Generated: 2026-10-27T15:07:01.223Z
- Dataset: Synthetic OCR regression cases. PDF cases use the embedded-font Japanese fixture; canvas cases render text with a system font. Categories are printed-document, table, multi-column, formula, photo, and handwriting-proxy. These are not representative scans.
- Preprocessing: upscale+contrast+deskew
- Platform: linux x64
- Node.js: v24.21.0
- Tesseract: 5.3.4

| Case | Category | Language | CER | WER | Confidence | ms |
|---|---|---|---:|---:|---:|---:|
| ja-p1-clean | printed-document | jpn+eng | 3.33% | n/a | 0.8529 | 1399 |
| ja-p1-low-res | printed-document | jpn+eng | 3.33% | n/a | 0.8517 | 1122 |
| ja-p1-rotate-2 | printed-document | jpn+eng | 3.33% | n/a | 0.7992 | 1372 |
| ja-p1-blur-1 | printed-document | jpn+eng | 0.00% | n/a | 0.9083 | 1318 |
| ja-p1-noise | printed-document | jpn+eng | 0.00% | n/a | 0.8486 | 1847 |
| ja-p1-low-contrast | printed-document | jpn+eng | 0.00% | n/a | 0.8566 | 1275 |
| ja-p2-clean | printed-document | jpn+eng | 0.00% | n/a | 0.9007 | 1038 |
| ja-p2-low-res | printed-document | jpn+eng | 0.00% | n/a | 0.9066 | 783 |
| ja-p2-rotate-2 | printed-document | jpn+eng | 0.00% | n/a | 0.8837 | 1054 |
| ja-p2-blur-1 | printed-document | jpn+eng | 0.00% | n/a | 0.9119 | 974 |
| ja-p2-noise | printed-document | jpn+eng | 0.00% | n/a | 0.8870 | 1576 |
| ja-p2-low-contrast | printed-document | jpn+eng | 0.00% | n/a | 0.8998 | 1124 |
| en-clean | printed-document | eng | 0.00% | 0.00% | 0.9621 | 391 |
| en-low-res | printed-document | eng | 0.00% | 0.00% | 0.9615 | 351 |
| en-rotate-2 | printed-document | eng | 0.00% | 0.00% | 0.9639 | 444 |
| en-blur-1 | printed-document | eng | 0.00% | 0.00% | 0.9610 | 301 |
| en-noise | printed-document | eng | 0.00% | 0.00% | 0.9618 | 412 |
| en-low-contrast | printed-document | eng | 0.00% | 0.00% | 0.9613 | 340 |
| en-table-clean | table | eng | 0.00% | n/a | 0.9574 | 446 |
| en-table-low-res | table | eng | 80.49% | n/a | 0.5921 | 379 |
| en-columns-clean | multi-column | eng | 30.14% | 33.33% | 0.9637 | 645 |
| en-formula-clean | formula | eng | 21.74% | n/a | 0.5299 | 363 |
| en-photo-clean | photo | eng | 0.00% | 0.00% | 0.9348 | 633 |
| en-handwriting-clean | handwriting-proxy | eng | 7.14% | 33.33% | 0.9351 | 301 |

## Category summary

| Category | Cases | Mean CER | Mean WER |
|---|---:|---:|---:|
| printed-document | 18 | 0.56% | 0.00% |
| table | 2 | 40.24% | n/a |
| multi-column | 1 | 30.14% | 33.33% |
| formula | 1 | 21.74% | n/a |
| photo | 1 | 0.00% | 0.00% |
| handwriting-proxy | 1 | 7.14% | 33.33% |

- Mean CER: 6.23%
- Mean WER (English cases): 7.41%
- Confidence vs CER: Pearson -0.652, Spearman -0.383 (n=24)
- Total OCR time: 19887 ms
- Peak RSS: 214.4 MiB

Synthetic cases are regression signals. Table, column, formula, photo, and handwriting proxies are rendered with system fonts and distortions; they do not establish accuracy on representative scans or target hardware.
