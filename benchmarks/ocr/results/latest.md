# OCR benchmark

- Generated: 2026-10-27T15:05:22.177Z
- Dataset: Synthetic OCR regression cases. PDF cases use the embedded-font Japanese fixture; canvas cases render text with a system font. Categories are printed-document, table, multi-column, formula, photo, and handwriting-proxy. These are not representative scans.
- Preprocessing: none
- Platform: linux x64
- Node.js: v24.21.0
- Tesseract: 5.3.4

| Case | Category | Language | CER | WER | Confidence | ms |
|---|---|---|---:|---:|---:|---:|
| ja-p1-clean | printed-document | jpn+eng | 0.00% | n/a | 0.9336 | 1075 |
| ja-p1-low-res | printed-document | jpn+eng | 43.33% | n/a | 0.7421 | 904 |
| ja-p1-rotate-2 | printed-document | jpn+eng | 6.67% | n/a | 0.8407 | 960 |
| ja-p1-blur-1 | printed-document | jpn+eng | 0.00% | n/a | 0.9143 | 854 |
| ja-p1-noise | printed-document | jpn+eng | 0.00% | n/a | 0.8885 | 1237 |
| ja-p1-low-contrast | printed-document | jpn+eng | 0.00% | n/a | 0.9304 | 986 |
| ja-p2-clean | printed-document | jpn+eng | 0.00% | n/a | 0.9180 | 660 |
| ja-p2-low-res | printed-document | jpn+eng | 31.58% | n/a | 0.6121 | 581 |
| ja-p2-rotate-2 | printed-document | jpn+eng | 0.00% | n/a | 0.9007 | 811 |
| ja-p2-blur-1 | printed-document | jpn+eng | 0.00% | n/a | 0.9272 | 638 |
| ja-p2-noise | printed-document | jpn+eng | 100.00% | n/a | n/a | 1304 |
| ja-p2-low-contrast | printed-document | jpn+eng | 0.00% | n/a | 0.9124 | 806 |
| en-clean | printed-document | eng | 0.00% | 0.00% | 0.9621 | 334 |
| en-low-res | printed-document | eng | 0.00% | 0.00% | 0.9578 | 257 |
| en-rotate-2 | printed-document | eng | 0.00% | 0.00% | 0.9628 | 367 |
| en-blur-1 | printed-document | eng | 0.00% | 0.00% | 0.9610 | 368 |
| en-noise | printed-document | eng | 0.00% | 0.00% | 0.9639 | 411 |
| en-low-contrast | printed-document | eng | 0.00% | 0.00% | 0.9605 | 282 |
| en-table-clean | table | eng | 0.00% | n/a | 0.9574 | 352 |
| en-table-low-res | table | eng | 0.00% | n/a | 0.9664 | 542 |
| en-columns-clean | multi-column | eng | 30.14% | 33.33% | 0.9637 | 534 |
| en-formula-clean | formula | eng | 21.74% | n/a | 0.5299 | 372 |
| en-photo-clean | photo | eng | 0.00% | 0.00% | 0.9628 | 420 |
| en-handwriting-clean | handwriting-proxy | eng | 7.14% | 33.33% | 0.8185 | 223 |

## Category summary

| Category | Cases | Mean CER | Mean WER |
|---|---:|---:|---:|
| printed-document | 18 | 10.09% | 0.00% |
| table | 2 | 0.00% | n/a |
| multi-column | 1 | 30.14% | 33.33% |
| formula | 1 | 21.74% | n/a |
| photo | 1 | 0.00% | 0.00% |
| handwriting-proxy | 1 | 7.14% | 33.33% |

- Mean CER: 10.02%
- Mean WER (English cases): 7.41%
- Confidence vs CER: Pearson -0.677, Spearman -0.527 (n=24)
- Total OCR time: 15278 ms
- Peak RSS: 184.5 MiB

Synthetic cases are regression signals. Table, column, formula, photo, and handwriting proxies are rendered with system fonts and distortions; they do not establish accuracy on representative scans or target hardware.
