import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

describe("SQLite runtime capabilities", () => {
  it("provides FTS5 virtual tables and indexed matching", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE VIRTUAL TABLE search_probe USING fts5(content)");
      const insert = db.prepare("INSERT INTO search_probe (content) VALUES (?)");
      insert.run("SIGMA Studio local search");
      insert.run("日本語の検索テスト");
      const english = db.prepare(
        "SELECT content FROM search_probe WHERE search_probe MATCH ?",
      ).all("SIGMA") as Array<{ content: string }>;
      const japaneseExactPhrase = db.prepare(
        "SELECT content FROM search_probe WHERE search_probe MATCH ?",
      ).all('"日本語の検索テスト"') as Array<{ content: string }>;

      expect(english.map((row) => row.content)).toContain("SIGMA Studio local search");
      expect(japaneseExactPhrase.map((row) => row.content)).toContain("日本語の検索テスト");
    } finally {
      db.close();
    }
  });

  it("does not imply Japanese substring/tokenization quality from FTS5 availability", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE VIRTUAL TABLE search_probe USING fts5(content)");
      db.prepare("INSERT INTO search_probe (content) VALUES (?)").run("日本語の検索テスト");
      const substring = db.prepare(
        "SELECT content FROM search_probe WHERE search_probe MATCH ?",
      ).all('"検索"') as Array<{ content: string }>;

      // unicode61 does not provide a Japanese morphological tokenizer.
      // This assertion records the limitation rather than promising substring search.
      expect(substring).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
