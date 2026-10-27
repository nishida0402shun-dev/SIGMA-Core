# OCR benchmark

- Generated: 2026-10-27T15:06:12.360Z
- Dataset: Synthetic OCR regression cases. PDF cases use the embedded-font Japanese fixture; canvas cases render text with a system font. Categories are printed-document, table, multi-column, formula, photo, and handwriting-proxy. These are not representative scans.
- Preprocessing: contrast
- Platform: linux x64
- Node.js: v24.21.0
- Tesseract: 5.3.4

| Case | Category | Language | CER | WER | Confidence | ms |
|---|---|---|---:|---:|---:|---:|
| ja-p1-clean | printed-document | jpn+eng | 0.00% | n/a | 0.9336 | 1731 |
| ja-p1-low-res | printed-document | jpn+eng | 43.33% | n/a | 0.7313 | 915 |
| ja-p1-rotate-2 | printed-document | jpn+eng | 6.67% | n/a | 0.8351 | 1200 |
| ja-p1-blur-1 | printed-document | jpn+eng | 0.00% | n/a | 0.9137 | 1115 |
| ja-p1-noise | printed-document | jpn+eng | 0.00% | n/a | 0.9348 | 1711 |
| ja-p1-low-contrast | printed-document | jpn+eng | 0.00% | n/a | 0.9348 | 1241 |
| ja-p2-clean | printed-document | jpn+eng | 0.00% | n/a | 0.9180 | 1009 |
| ja-p2-low-res | printed-document | jpn+eng | 78.95% | n/a | 0.4235 | 687 |
| ja-p2-rotate-2 | printed-document | jpn+eng | 0.00% | n/a | 0.8837 | 962 |
| ja-p2-blur-1 | printed-document | jpn+eng | 0.00% | n/a | 0.9249 | 768 |
| ja-p2-noise | printed-document | jpn+eng | 0.00% | n/a | 0.8764 | 1640 |
| ja-p2-low-contrast | printed-document | jpn+eng | 0.00% | n/a | 0.9186 | 951 |
| en-clean | printed-document | eng | 0.00% | 0.00% | 0.9621 | 298 |
| en-low-res | printed-document | eng | 0.00% | 0.00% | 0.9578 | 292 |
| en-rotate-2 | printed-document | eng | 0.00% | 0.00% | 0.9628 | 306 |
| en-blur-1 | printed-document | eng | 0.00% | 0.00% | 0.9610 | 360 |
| en-noise | printed-document | eng | 0.00% | 0.00% | 0.9618 | 411 |
| en-low-contrast | printed-document | eng | 0.00% | 0.00% | 0.9613 | 314 |
| en-table-clean | table | eng | 0.00% | n/a | 0.9574 | 401 |
| en-table-low-res | table | eng | 0.00% | n/a | 0.9664 | 653 |
| en-columns-clean | multi-column | eng | 30.14% | 33.33% | 0.9637 | 697 |
| en-formula-clean | formula | eng | 21.74% | n/a | 0.5299 | 396 |
| en-photo-clean | photo | eng | 0.00% | 0.00% | 0.9616 | 436 |
| en-handwriting-clean | handwriting-proxy | eng | 7.14% | 33.33% | 0.8185 | 250 |

## Category summary

| Category | Cases | Mean CER | Mean WER |
|---|---:|---:|---:|
| printed-document | 18 | 7.16% | 0.00% |
| table | 2 | 0.00% | n/a |
| multi-column | 1 | 30.14% | 33.33% |
| formula | 1 | 21.74% | n/a |
| photo | 1 | 0.00% | 0.00% |
| handwriting-proxy | 1 | 7.14% | 33.33% |

- Mean CER: 7.83%
- Mean WER (English cases): 7.41%
- Confidence vs CER: Pearson -0.818, Spearman -0.509 (n=24)
- Total OCR time: 18744 ms
- Peak RSS: 213.0 MiB

Synthetic cases are regression signals. Table, column, formula, photo, and handwriting proxies are rendered with system fonts and distortions; they do not establish accuracy on representative scans or target hardware.
