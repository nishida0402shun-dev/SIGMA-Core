import { openSqliteDatabase, type SqliteDatabase } from "../db/sqlite-driver.ts";
import { randomUUID } from "node:crypto";
import type { CapabilityStatus, DetectionResult, SourceRecord, TextExtraction } from "../index.ts";

export interface PersistedImport {
  id: string;
  idempotencyKey: string;
  source: SourceRecord;
  extraction: TextExtraction;
  extractorId: string;
  extractorVersion: string;
  createdAt: string;
}
export interface ImportInput {
  idempotencyKey: string;
  source: SourceRecord;
  extraction: TextExtraction;
  extractorId: string;
  extractorVersion: string;
}
interface SourceRow {
  sha256: string; byte_length: number; detected_format: SourceRecord["detected"]["format"];
  detection_status: CapabilityStatus; evidence_json: string; created_at: string;
}
interface ImportRow {
  id: string; idempotency_key: string; source_sha256: string;
  extraction_status: TextExtraction["status"]; extracted_text: string | null;
  warnings_json: string; extractor_id: string; extractor_version: string; created_at: string;
}
const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE sources (
        sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
        byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
        detected_format TEXT NOT NULL,
        detection_status TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE extractions (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) > 0),
        source_sha256 TEXT NOT NULL REFERENCES sources(sha256),
        extraction_status TEXT NOT NULL,
        extracted_text TEXT,
        warnings_json TEXT NOT NULL,
        extractor_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_extractions_source ON extractions(source_sha256);
    `,
  },
];

export class SqliteCoreRepository {
  readonly #db: SqliteDatabase;
  constructor(databasePath: string) {
    this.#db = openSqliteDatabase(databasePath);
    try {
      this.#db.pragma("journal_mode = WAL");
      this.#db.pragma("foreign_keys = ON");
      this.#migrate();
    } catch (err) {
      this.#db.close();
      throw err;
    }
  }
  close(): void { this.#db.close(); }

  #migrate(): void {
    const currentVersion = Number(this.#db.pragma("user_version", { simple: true }));
    const latestVersion = MIGRATIONS.at(-1)?.version ?? 0;
    if (!Number.isInteger(currentVersion) || currentVersion < 0) {
      throw new Error("Invalid SQLite schema version");
    }
    if (currentVersion > latestVersion) {
      throw new Error(`Database schema version ${currentVersion} is newer than supported version ${latestVersion}`);
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue;
      if (migration.version !== Number(this.#db.pragma("user_version", { simple: true })) + 1) {
        throw new Error("Database schema migration sequence has a gap");
      }
      this.#db.transaction(() => {
        this.#db.exec(migration.sql);
        this.#db.pragma(`user_version = ${migration.version}`);
      })();
    }
  }

  saveImport(input: ImportInput): PersistedImport {
    if (!input.idempotencyKey.trim()) throw new Error("idempotencyKey must not be empty");
    if (!input.extractorId.trim() || !input.extractorVersion.trim()) {
      throw new Error("extractorId and extractorVersion must not be empty");
    }
    const run = this.#db.transaction(() => {
      const previous = this.#db.prepare("SELECT * FROM extractions WHERE idempotency_key = ?")
        .get(input.idempotencyKey) as unknown as unknown as ImportRow | undefined;
      if (previous) {
        if (previous.source_sha256 !== input.source.sha256) {
          throw new Error("Idempotency key conflict: the key was already used for different source bytes");
        }
        return this.#toPersisted(previous);
      }
      const createdAt = new Date().toISOString();
      this.#db.prepare(`
        INSERT INTO sources (sha256, byte_length, detected_format, detection_status, evidence_json, created_at)
        VALUES (@sha256, @byteLength, @format, @status, @evidence, @createdAt)
        ON CONFLICT(sha256) DO NOTHING
      `).run({
        sha256: input.source.sha256, byteLength: input.source.byteLength,
        format: input.source.detected.format, status: input.source.detected.status,
        evidence: JSON.stringify(input.source.detected.evidence), createdAt,
      });
      const storedSource = this.#db.prepare("SELECT * FROM sources WHERE sha256 = ?")
        .get(input.source.sha256) as SourceRow | undefined;
      if (
        !storedSource ||
        storedSource.byte_length !== input.source.byteLength ||
        storedSource.detected_format !== input.source.detected.format ||
        storedSource.detection_status !== input.source.detected.status ||
        storedSource.evidence_json !== JSON.stringify(input.source.detected.evidence)
      ) {
        throw new Error("Source metadata integrity check failed");
      }
      const id = randomUUID();
      this.#db.prepare(`
        INSERT INTO extractions
          (id, idempotency_key, source_sha256, extraction_status, extracted_text, warnings_json, extractor_id, extractor_version, created_at)
        VALUES (@id, @key, @sha, @status, @text, @warnings, @extractorId, @extractorVersion, @createdAt)
      `).run({
        id, key: input.idempotencyKey, sha: input.source.sha256,
        status: input.extraction.status, text: input.extraction.text ?? null,
        warnings: JSON.stringify(input.extraction.warnings), extractorId: input.extractorId,
        extractorVersion: input.extractorVersion, createdAt,
      });
      return this.#toPersisted(this.#db.prepare("SELECT * FROM extractions WHERE id = ?").get(id) as unknown as ImportRow);
    });
    return run();
  }

  getImportByKey(idempotencyKey: string): PersistedImport | undefined {
    const row = this.#db.prepare("SELECT * FROM extractions WHERE idempotency_key = ?")
      .get(idempotencyKey) as unknown as ImportRow | undefined;
    return row ? this.#toPersisted(row) : undefined;
  }
  #toPersisted(row: ImportRow): PersistedImport {
    const sourceRow = this.#db.prepare("SELECT * FROM sources WHERE sha256 = ?")
      .get(row.source_sha256) as SourceRow | undefined;
    if (!sourceRow) throw new Error("Stored extraction references a missing source");
    const detected: DetectionResult = {
      format: sourceRow.detected_format, status: sourceRow.detection_status,
      evidence: JSON.parse(sourceRow.evidence_json) as string[],
    };
    const source: SourceRecord = {
      sourceId: sourceRow.sha256, sha256: sourceRow.sha256,
      byteLength: sourceRow.byte_length, detected,
    };
    const extraction: TextExtraction = {
      status: row.extraction_status,
      ...(row.extracted_text === null ? {} : { text: row.extracted_text }),
      // This legacy import table stores merged text only, not page provenance.
      pages: [],
      warnings: JSON.parse(row.warnings_json) as string[], source,
      extractorId: row.extractor_id,
      extractorVersion: row.extractor_version,
    };
    return {
      id: row.id, idempotencyKey: row.idempotency_key, source, extraction,
      extractorId: row.extractor_id, extractorVersion: row.extractor_version, createdAt: row.created_at,
    };
  }
}
