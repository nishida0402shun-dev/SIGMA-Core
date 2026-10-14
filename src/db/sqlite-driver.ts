/**
 * Unified SQLite Driver for SIGMA Core.
 * Supports Node 22+ built-in `node:sqlite` (DatabaseSync) and fallback to `better-sqlite3`.
 * This provides zero-dependency, reproducible native execution across all platforms
 * while keeping 100% compatibility with SQLite3 features (WAL, FTS5, Foreign Keys).
 */

export interface SqliteRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  pragma(pragmaSql: string, options?: { simple?: boolean }): unknown;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

import { createRequire } from "node:module";

const esmRequire = createRequire(import.meta.url);

/**
 * Creates a SqliteDatabase instance using Node.js built-in `node:sqlite` (DatabaseSync)
 * or `better-sqlite3` if node:sqlite is unavailable.
 */
export function openSqliteDatabase(path: string): SqliteDatabase {
  try {
    const { DatabaseSync } = esmRequire("node:sqlite");
    return createNodeSqliteWrapper(new DatabaseSync(path));
  } catch {
    try {
      const BetterSqlite3 = esmRequire("better-sqlite3");
      const db = new BetterSqlite3(path);
      return createBetterSqliteWrapper(db);
    } catch (err) {
      throw new Error(
        `Failed to open SQLite database at ${path}. Neither node:sqlite nor better-sqlite3 is available. Cause: ${err}`,
      );
    }
  }
}

function createNodeSqliteWrapper(db: any): SqliteDatabase {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]): SqliteRunResult {
          const norm = normalizeParams(params);
          const result = norm.isNamed ? stmt.run(norm.val) : stmt.run(...norm.val);
          return {
            changes: result.changes ?? 0,
            lastInsertRowid: result.lastInsertRowid ?? 0,
          };
        },
        get(...params: unknown[]): Record<string, unknown> | undefined {
          const norm = normalizeParams(params);
          const row = norm.isNamed ? stmt.get(norm.val) : stmt.get(...norm.val);
          if (!row) return undefined;
          return { ...row } as Record<string, unknown>;
        },
        all(...params: unknown[]): Array<Record<string, unknown>> {
          const norm = normalizeParams(params);
          const rows = norm.isNamed ? stmt.all(norm.val) : stmt.all(...norm.val);
          return rows.map((r: any) => ({ ...r }));
        },
      };
    },
    pragma(pragmaSql: string, options?: { simple?: boolean }): unknown {
      if (options?.simple) {
        const stmt = db.prepare(`PRAGMA ${pragmaSql}`);
        const row = stmt.get();
        if (!row) return undefined;
        const keys = Object.keys(row);
        const firstKey = keys[0];
        return firstKey !== undefined ? (row as any)[firstKey] : undefined;
      }
      return db.exec(`PRAGMA ${pragmaSql}`);
    },
    transaction<T>(fn: () => T): () => T {
      return () => {
        db.exec("BEGIN");
        try {
          const result = fn();
          db.exec("COMMIT");
          return result;
        } catch (err) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // ignore rollback failure
          }
          throw err;
        }
      };
    },
    close(): void {
      db.close();
    },
  };
}

function normalizeParams(params: unknown[]): { isNamed: boolean; val: any } {
  if (params.length === 0) return { isNamed: false, val: [] };
  if (params.length === 1 && typeof params[0] === "object" && params[0] !== null && !Array.isArray(params[0])) {
    const obj = params[0] as Record<string, unknown>;
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      clean[key.startsWith("@") || key.startsWith(":") || key.startsWith("$") ? key.slice(1) : key] = value;
    }
    return { isNamed: true, val: clean };
  }
  return { isNamed: false, val: params };
}

function createBetterSqliteWrapper(db: any): SqliteDatabase {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]): SqliteRunResult {
          const result = stmt.run(...params);
          return {
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        get(...params: unknown[]): Record<string, unknown> | undefined {
          return stmt.get(...params);
        },
        all(...params: unknown[]): Array<Record<string, unknown>> {
          return stmt.all(...params);
        },
      };
    },
    pragma(pragmaSql: string, options?: { simple?: boolean }): unknown {
      return db.pragma(pragmaSql, options);
    },
    transaction<T>(fn: () => T): () => T {
      return db.transaction(fn);
    },
    close(): void {
      db.close();
    },
  };
}
