import { openSqliteDatabase } from "../src/db/sqlite-driver.ts";
import { afterEach, describe, expect, it } from "./test-shim.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteCoreRepository } from "../src/persistence/sqlite-repository.ts";
import { CoreRepository } from "../src/persistence/core-repository.ts";
import { MIGRATIONS } from "../src/db/migrations.ts";

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

  it("migrates the canonical repository to the latest schema with artifact warnings", () => {
    const path = tempDb();
    const repository = new CoreRepository(path);
    repository.close();
    const db = openSqliteDatabase(path);
    expect(db.pragma("user_version", { simple: true })).toBe(5);
    const columns = db.prepare("PRAGMA table_info(extracted_artifacts)").all()
      .map((row) => row.name);
    expect(columns).toContain("warnings_json");
    expect(columns).toContain("page_count");
    const locationColumns = db.prepare("PRAGMA table_info(source_locations)").all()
      .map((row) => row.name);
    expect(locationColumns).toContain("extraction_method");
    expect(locationColumns).toContain("warnings_json");
    expect(locationColumns).toContain("ocr_engine_id");
    expect(locationColumns).toContain("ocr_engine_version");
    expect(locationColumns).toContain("ocr_language");
    expect(locationColumns).toContain("ocr_confidence");
    db.close();
  });

  it("upgrades an existing version 2 database and preserves existing artifacts and locations", () => {
    const path = tempDb();
    const db = openSqliteDatabase(path);
    db.exec(MIGRATIONS[0]!.sql);
    db.exec(MIGRATIONS[1]!.sql);
    db.exec(`
      INSERT INTO source_objects
        (object_id, owner_id, scope_id, status, version, content_hash, metadata_json, created_at, updated_at)
      VALUES ('obj_old', 'user', 'ws', 'Active', 1, 'hash', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO extracted_artifacts
        (artifact_id, object_id, source_version, extractor_id, extractor_version, status, created_at)
      VALUES ('art_old', 'obj_old', 1, 'builtin-plain-text', '1.0.0', 'complete', '2026-01-01T00:00:00Z');
      INSERT INTO source_locations
        (location_id, artifact_id, object_id, page_number, text_content, semantic_type, created_at)
      VALUES ('loc_old', 'art_old', 'obj_old', 1, 'old text', 'unknown', '2026-01-01T00:00:00Z');
    `);
    db.pragma("user_version = 2");
    db.close();

    const repository = new CoreRepository(path);
    const artifacts = repository.listExtractedArtifacts("obj_old");
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]!.warnings.length).toBe(0);
    expect(artifacts[0]!.pageCount).toBeUndefined();
    const locations = repository.getSourceLocations("obj_old");
    expect(locations.length).toBe(1);
    expect(locations[0]!.textContent).toBe("old text");
    expect(locations[0]!.extractionMethod).toBeUndefined();
    expect(locations[0]!.warnings).toEqual([]);
    expect(locations[0]!.ocrLanguage).toBeUndefined();
    expect(locations[0]!.ocrConfidence).toBeUndefined();
    repository.close();

    const migrated = openSqliteDatabase(path);
    expect(migrated.pragma("user_version", { simple: true })).toBe(5);
    migrated.close();
  });

  it("refuses to open a canonical database created by a newer schema version", () => {
    const path = tempDb();
    const db = openSqliteDatabase(path);
    db.pragma("user_version = 999");
    db.close();
    expect(() => new CoreRepository(path)).toThrow("newer than supported version");
  });

  it("refuses to open a database created by a newer schema version", () => {
    const path = tempDb();
    const db = openSqliteDatabase(path);
    db.pragma("user_version = 999");
    db.close();
    expect(() => new SqliteCoreRepository(path)).toThrow("newer than supported version");
  });
});
