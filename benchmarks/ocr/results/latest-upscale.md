# OCR benchmark

- Generated: 2026-10-27T15:05:47.657Z
- Dataset: Synthetic OCR regression cases. PDF cases use the embedded-font Japanese fixture; canvas cases render text with a system font. Categories are printed-document, table, multi-column, formula, photo, and handwriting-proxy. These are not representative scans.
- Preprocessing: upscale
- Platform: linux x64
- Node.js: v24.21.0
- Tesseract: 5.3.4

| Case | Category | Language | CER | WER | Confidence | ms |
|---|---|---|---:|---:|---:|---:|
| ja-p1-clean | printed-document | jpn+eng | 0.00% | n/a | 0.9336 | 1230 |
| ja-p1-low-res | printed-document | jpn+eng | 6.67% | n/a | 0.7510 | 1114 |
| ja-p1-rotate-2 | printed-document | jpn+eng | 6.67% | n/a | 0.8407 | 1104 |
| ja-p1-blur-1 | printed-document | jpn+eng | 0.00% | n/a | 0.9143 | 925 |
| ja-p1-noise | printed-document | jpn+eng | 0.00% | n/a | 0.8885 | 1888 |
| ja-p1-low-contrast | printed-document | jpn+eng | 0.00% | n/a | 0.9304 | 1047 |
| ja-p2-clean | printed-document | jpn+eng | 0.00% | n/a | 0.9180 | 747 |
| ja-p2-low-res | printed-document | jpn+eng | 0.00% | n/a | 0.8820 | 933 |
| ja-p2-rotate-2 | printed-document | jpn+eng | 0.00% | n/a | 0.9007 | 921 |
| ja-p2-blur-1 | printed-document | jpn+eng | 0.00% | n/a | 0.9272 | 796 |
| ja-p2-noise | printed-document | jpn+eng | 100.00% | n/a | n/a | 2469 |
| ja-p2-low-contrast | printed-document | jpn+eng | 0.00% | n/a | 0.9124 | 871 |
| en-clean | printed-document | eng | 0.00% | 0.00% | 0.9621 | 318 |
| en-low-res | printed-document | eng | 0.00% | 0.00% | 0.9615 | 482 |
| en-rotate-2 | printed-document | eng | 0.00% | 0.00% | 0.9628 | 381 |
| en-blur-1 | printed-document | eng | 0.00% | 0.00% | 0.9610 | 316 |
| en-noise | printed-document | eng | 0.00% | 0.00% | 0.9639 | 429 |
| en-low-contrast | printed-document | eng | 0.00% | 0.00% | 0.9605 | 346 |
| en-table-clean | table | eng | 0.00% | n/a | 0.9574 | 579 |
| en-table-low-res | table | eng | 80.49% | n/a | 0.5921 | 423 |
| en-columns-clean | multi-column | eng | 30.14% | 33.33% | 0.9637 | 624 |
| en-formula-clean | formula | eng | 21.74% | n/a | 0.5299 | 458 |
| en-photo-clean | photo | eng | 0.00% | 0.00% | 0.9628 | 614 |
| en-handwriting-clean | handwriting-proxy | eng | 7.14% | 33.33% | 0.8185 | 308 |

## Category summary

| Category | Cases | Mean CER | Mean WER |
|---|---:|---:|---:|
| printed-document | 18 | 6.30% | 0.00% |
| table | 2 | 40.24% | n/a |
| multi-column | 1 | 30.14% | 33.33% |
| formula | 1 | 21.74% | n/a |
| photo | 1 | 0.00% | 0.00% |
| handwriting-proxy | 1 | 7.14% | 33.33% |

- Mean CER: 10.54%
- Mean WER (English cases): 7.41%
- Confidence vs CER: Pearson -0.676, Spearman -0.489 (n=24)
- Total OCR time: 19324 ms
- Peak RSS: 204.4 MiB

Synthetic cases are regression signals. Table, column, formula, photo, and handwriting proxies are rendered with system fonts and distortions; they do not establish accuracy on representative scans or target hardware.
