import { openSqliteDatabase } from "../src/db/sqlite-driver.ts";
import { afterEach, describe, expect, it } from "./test-shim.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteCoreRepository } from "../src/persistence/sqlite-repository.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "sigma-migration-test-"));
  dirs.push(dir);
  return join(dir, "core.sqlite");
}

describe("SQLite schema migrations", () => {
  it("initializes a new database at the latest supported version", () => {
    const path = tempDb();
    const repository = new SqliteCoreRepository(path);
    repository.close();
    const db = openSqliteDatabase(path);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("sources")).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("extractions")).toBeTruthy();
    db.close();
  });

  it("refuses to open a database created by a newer schema version", () => {
    const path = tempDb();
    const db = openSqliteDatabase(path);
    db.pragma("user_version = 999");
    db.close();
    expect(() => new SqliteCoreRepository(path)).toThrow("newer than supported version");
  });
});
