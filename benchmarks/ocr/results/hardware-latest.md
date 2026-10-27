# Target hardware readiness report

- Generated: 2026-10-27T15:00:19.735Z

| Field | Value |
|---|---|
| os.platform | linux |
| os.release | 6.8.0-1064-azure |
| os.version | #72~22.04.1-Ubuntu SMP Wed Jul 22 23:39:45 UTC 2026 |
| os.arch | x64 |
| os.hostname | codespaces-7b133f |
| hardware.cpu | AMD EPYC 7763 64-Core Processor |
| hardware.logicalCpus | 2 |
| hardware.totalRamMiB | 7942.3 |
| hardware.freeRamMiB | 3773.9 |
| hardware.diskTotalGiB | 31.3 |
| hardware.diskFreeGiB | 14.9 |
| runtime.node | v24.21.0 |
| runtime.v8 | 13.6.233.17-node.53 |
| runtime.modules | 137 |
| runtime.canvas | loaded |
| tesseract.executable | tesseract |
| tesseract.version | 5.3.4 |
| tesseract.languages | eng,jpn,osd |
| tesseract.requestedLanguage | eng |

## Checks

| Check | Required | Status | ms | Detail |
|---|---|---|---:|---|
| native-canvas | yes | PASS | n/a | PNG 110 bytes |
| sqlite-fts5 | yes | PASS | n/a | driver=node:sqlite, sqlite=3.53.4, fts5=true |
| tesseract | yes | PASS | n/a | version=5.3.4, languages=eng,jpn,osd |
| pdf-render | yes | PASS | 288 | PNG 31826 bytes |
| ocr-smoke | yes | PASS | 333 | language=eng, confidence=0.9620 |

## Warnings

- OCR smoke text: "SIGMA hardware check 12345" (CER 0.00%)

This report proves the local runtime can execute the OCR path. It does not measure representative-scan accuracy; use `scripts/ocr-benchmark.ts` with real, consented data for that.
