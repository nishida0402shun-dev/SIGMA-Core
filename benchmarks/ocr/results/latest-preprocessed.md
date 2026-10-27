# OCR benchmark

- Generated: 2026-10-27T12:25:34.176Z
- Dataset: Synthetic OCR regression cases. PDF cases use the embedded-font Japanese fixture; canvas cases render text with a system font. These are not representative scans.
- Preprocessing: deskew+upscale+contrast
- Platform: linux x64
- Node.js: v24.21.0
- Tesseract: 5.3.4

| Case | Language | CER | WER | Confidence | ms |
|---|---|---:|---:|---:|---:|
| ja-p1-clean | jpn+eng | 3.33% | n/a | 0.8529 | 1261 |
| ja-p1-low-res | jpn+eng | 3.33% | n/a | 0.8517 | 917 |
| ja-p1-rotate-2 | jpn+eng | 3.33% | n/a | 0.7992 | 1317 |
| ja-p1-blur-1 | jpn+eng | 0.00% | n/a | 0.9083 | 1204 |
| ja-p1-noise | jpn+eng | 0.00% | n/a | 0.8486 | 1835 |
| ja-p1-low-contrast | jpn+eng | 0.00% | n/a | 0.8566 | 1306 |
| ja-p2-clean | jpn+eng | 0.00% | n/a | 0.9007 | 1058 |
| ja-p2-low-res | jpn+eng | 0.00% | n/a | 0.9066 | 758 |
| ja-p2-rotate-2 | jpn+eng | 0.00% | n/a | 0.8837 | 1044 |
| ja-p2-blur-1 | jpn+eng | 0.00% | n/a | 0.9119 | 867 |
| ja-p2-noise | jpn+eng | 0.00% | n/a | 0.8870 | 1727 |
| ja-p2-low-contrast | jpn+eng | 0.00% | n/a | 0.8998 | 1007 |
| en-clean | eng | 0.00% | 0.00% | 0.9577 | 351 |
| en-low-res | eng | 0.00% | 0.00% | 0.9615 | 352 |
| en-rotate-2 | eng | 0.00% | 0.00% | 0.9640 | 438 |
| en-blur-1 | eng | 0.00% | 0.00% | 0.9616 | 365 |
| en-noise | eng | 0.00% | 0.00% | 0.9606 | 457 |
| en-low-contrast | eng | 0.00% | 0.00% | 0.9585 | 441 |

- Mean CER: 0.56%
- Mean WER (English cases): 0.00%
- Confidence vs CER: Pearson -0.644, Spearman -0.589 (n=18)
- Total OCR time: 16706 ms
- Peak RSS: 234.1 MiB

Synthetic cases are regression signals. They do not establish accuracy on representative scans or target hardware.
