#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = resolve(root, "package-lock.json");
const reportPath = resolve(root, "docs/DEPENDENCY_LICENSE_INVENTORY.md");
const checkOnly = process.argv.includes("--check");

const lock = JSON.parse(await readFile(lockPath, "utf8"));
if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") {
  throw new Error("Unsupported or invalid package-lock.json; expected npm lockfile v3.");
}

const entries = Object.entries(lock.packages)
  .filter(([path]) => path !== "")
  .sort(([a], [b]) => a.localeCompare(b));

const missing = entries.filter(([, pkg]) => {
  const license = pkg.license ?? pkg.licenses;
  return license === undefined || license === null || license === "";
});
if (missing.length) {
  console.error("Missing license metadata in package-lock.json:");
  for (const [path, pkg] of missing) console.error(\`- \${path}@\${pkg.version ?? "unknown"}\`);
}

const escapeCell = (value) => String(value).replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
const rows = entries.map(([path, pkg]) => {
  const name = path.slice("node_modules/".length);
  const license = pkg.license ?? (pkg.licenses ? JSON.stringify(pkg.licenses) : "MISSING");
  const classification = pkg.dev ? "Development" : pkg.optional ? "Optional" : "Production";
  return \`| \\\`\${escapeCell(name)}\\\` | \${escapeCell(pkg.version ?? "unknown")} | \${escapeCell(license)} | \${classification} |\`;
});

const report = \`# SIGMA Core — Locked Dependency License Inventory

**Source of truth:** \\\`package-lock.json\\\` (npm lockfile v3)  
**Generation:** \\\`node scripts/check-license-inventory.mjs\\\`  
**Scope:** All \${entries.length} resolved non-root package entries, including transitive, development, and optional dependencies.

This report reproduces the license metadata recorded in the committed npm lockfile. It is a screening inventory, **not legal advice** and not proof that all required license texts, notices, attribution, source offers, or distribution obligations have been satisfied. Package metadata can be incomplete or inaccurate; verify upstream license files and bundled native components before distribution. SPDX expressions are preserved as published and are not automatically adjudicated.

| Package | Locked version | Lockfile license metadata | Classification |
|---|---:|---|---|
\${rows.join("\\n")}

## Review notes

- \\\`MISSING\\\` license metadata causes the CI inventory check to fail. A present value still requires human review of the upstream package and shipped artifacts.
- \\\`(MIT OR WTFPL)\` and \\\`(BSD-2-Clause OR MIT OR Apache-2.0)\` are alternative-license expressions as recorded in the lockfile; this check does not choose a license on the project's behalf.
- Optional native package \\\`better-sqlite3\\\` is listed from lockfile metadata. This report does not enumerate OS-level libraries or prove Electron ABI compatibility.
- Security advisories are checked separately by \\\`npm audit --omit=dev --audit-level=high\\\`; that command is not a license compliance check.
- Before redistributing SIGMA Core, review applicable upstream \\\`LICENSE\\\`, \\\`NOTICE\\\`, and bundled third-party notices, including any native binaries included by the final packaging process.

## References

- [package.json](../package.json)
- [package-lock.json](../package-lock.json)
- [npm package-lock documentation](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json)
- [SPDX License List](https://spdx.org/licenses/)
\`;

if (checkOnly) {
  let current;
  try {
    current = await readFile(reportPath, "utf8");
  } catch {
    console.error("License inventory report is missing. Run: node scripts/check-license-inventory.mjs");
    process.exit(1);
  }
  if (current !== report) {
    console.error("License inventory is out of date. Run: node scripts/check-license-inventory.mjs and commit the regenerated report.");
    process.exit(1);
  }
  if (missing.length) process.exit(1);
  console.log(\`License inventory is current (\${entries.length} locked packages; all have license metadata).\`);
} else {
  await writeFile(reportPath, report, "utf8");
  console.log(\`Wrote docs/DEPENDENCY_LICENSE_INVENTORY.md (\${entries.length} locked packages).\`);
  if (missing.length) process.exit(1);
}
