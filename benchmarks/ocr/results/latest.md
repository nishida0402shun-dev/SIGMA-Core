# OCR benchmark

- Generated: 2026-10-27T12:25:11.488Z
- Dataset: Synthetic OCR regression cases. PDF cases use the embedded-font Japanese fixture; canvas cases render text with a system font. These are not representative scans.
- Preprocessing: none
- Platform: linux x64
- Node.js: v24.21.0
- Tesseract: 5.3.4

| Case | Language | CER | WER | Confidence | ms |
|---|---|---:|---:|---:|---:|
| ja-p1-clean | jpn+eng | 0.00% | n/a | 0.9336 | 1097 |
| ja-p1-low-res | jpn+eng | 43.33% | n/a | 0.7421 | 857 |
| ja-p1-rotate-2 | jpn+eng | 6.67% | n/a | 0.8407 | 838 |
| ja-p1-blur-1 | jpn+eng | 0.00% | n/a | 0.9143 | 928 |
| ja-p1-noise | jpn+eng | 0.00% | n/a | 0.8885 | 1124 |
| ja-p1-low-contrast | jpn+eng | 0.00% | n/a | 0.9304 | 951 |
| ja-p2-clean | jpn+eng | 0.00% | n/a | 0.9180 | 633 |
| ja-p2-low-res | jpn+eng | 31.58% | n/a | 0.6121 | 579 |
| ja-p2-rotate-2 | jpn+eng | 0.00% | n/a | 0.9007 | 1040 |
| ja-p2-blur-1 | jpn+eng | 0.00% | n/a | 0.9272 | 611 |
| ja-p2-noise | jpn+eng | 100.00% | n/a | n/a | 1227 |
| ja-p2-low-contrast | jpn+eng | 0.00% | n/a | 0.9124 | 768 |
| en-clean | eng | 0.00% | 0.00% | 0.9621 | 330 |
| en-low-res | eng | 0.00% | 0.00% | 0.9578 | 258 |
| en-rotate-2 | eng | 0.00% | 0.00% | 0.9628 | 294 |
| en-blur-1 | eng | 0.00% | 0.00% | 0.9610 | 309 |
| en-noise | eng | 0.00% | 0.00% | 0.9639 | 401 |
| en-low-contrast | eng | 0.00% | 0.00% | 0.9605 | 350 |

- Mean CER: 10.09%
- Mean WER (English cases): 0.00%
- Confidence vs CER: Pearson -0.873, Spearman -0.661 (n=18)
- Total OCR time: 12595 ms
- Peak RSS: 183.4 MiB

Synthetic cases are regression signals. They do not establish accuracy on representative scans or target hardware.
