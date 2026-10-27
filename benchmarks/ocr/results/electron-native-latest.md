# Electron / native-module probe

- Generated: 2026-10-27T15:01:03.708Z
- Platform: linux x64
- Electron: not running under Electron

| Check | Required | Status | Detail |
|---|---|---|---|
| electron-runtime | no | PASS | plain Node 24.21.0, ABI 137 (run under Electron for the packaged check) |
| native-canvas | yes | PASS | PNG 270 bytes, ABI 137 |
| sqlite-driver | yes | PASS | node:sqlite 3.53.4 with FTS5 |
| tesseract-cli | no | PASS | tesseract 5.3.4 |
| pdf-rasterization | yes | PASS | PNG 31826 bytes |

A plain-Node pass does not prove packaged Electron startup. Run this script under the packaged Electron binary on the target machine and verify `app.asar.unpacked` native binaries and `extraResources` Tesseract paths.
