# PDF test fixtures

- `japanese-two-pages.pdf`: two-page Japanese text PDF generated with ReportLab
  using Noto Sans JP (SIL Open Font License 1.1). The font is subset-embedded in
  the fixture; the font file itself is not committed.
  - Page 1 heading: `二次関数の最大値と最小値`
  - Page 2 heading: `練習問題`
- `encrypted.pdf`: two-page text PDF encrypted with password `secret` using
  `pypdf`, used to verify fail-closed behavior for password-protected PDFs.

The English multi-page, blank-page, and scanned-like fixtures are generated
deterministically at test time by `tests/pdf-fixture.ts`.
