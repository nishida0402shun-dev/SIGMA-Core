import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { CapabilityStatus, DetectionResult, SourceRecord, TextExtraction } from "../index.js";

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
const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sources (
  sha256 TEXT PRIMARY KEY, byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  detected_format TEXT NOT NULL, detection_status TEXT NOT NULL,
  evidence_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
  source_sha256 TEXT NOT NULL REFERENCES sources(sha256),
  extraction_status TEXT NOT NULL, extracted_text TEXT, warnings_json TEXT NOT NULL,
  extractor_id TEXT NOT NULL, extractor_version TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_extractions_source ON extractions(source_sha256);
PRAGMA user_version = 1;
`;

export class SqliteCoreRepository {
  readonly #db: Database.Database;
  constructor(databasePath: string) {
    this.#db = new Database(databasePath);
    this.#db.pragma("journal_mode = WAL");
    this.#db.pragma("foreign_keys = ON");
    this.#db.exec(SCHEMA);
  }
  close(): void { this.#db.close(); }

  saveImport(input: ImportInput): PersistedImport {
    if (!input.idempotencyKey.trim()) throw new Error("idempotencyKey must not be empty");
    if (!input.extractorId.trim() || !input.extractorVersion.trim()) {
      throw new Error("extractorId and extractorVersion must not be empty");
    }
    const run = this.#db.transaction(() => {
      const previous = this.#db.prepare("SELECT * FROM extractions WHERE idempotency_key = ?")
        .get(input.idempotencyKey) as ImportRow | undefined;
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
      if (!storedSource || storedSource.byte_length !== input.source.byteLength) {
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
      return this.#toPersisted(this.#db.prepare("SELECT * FROM extractions WHERE id = ?").get(id) as ImportRow);
    });
    return run();
  }

  getImportByKey(idempotencyKey: string): PersistedImport | undefined {
    const row = this.#db.prepare("SELECT * FROM extractions WHERE idempotency_key = ?")
      .get(idempotencyKey) as ImportRow | undefined;
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
      warnings: JSON.parse(row.warnings_json) as string[], source,
    };
    return {
      id: row.id, idempotencyKey: row.idempotency_key, source, extraction,
      extractorId: row.extractor_id, extractorVersion: row.extractor_version, createdAt: row.created_at,
    };
  }
}
