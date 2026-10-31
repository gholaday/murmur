import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { expect, it } from "vitest";
import { createLogger } from "../log";
import { openDatabase } from "./index";
import * as schema from "./schema";

const MIGRATIONS = path.resolve(__dirname, "../../../drizzle");
/** 0.7.0 shipped with migrations up to 0019_watch_match. */
const V0_7_MIGRATIONS = 20;

/** A copy of the migrations folder holding only the first `count`, as an older release had. */
function olderMigrations(dir: string, count: number): string {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
  const entries = journal.entries.slice(0, count);
  fs.mkdirSync(path.join(dir, "meta"), { recursive: true });
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const e of entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

it("upgrades a 0.7 database to today's without losing anything", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-upgrade-"));
  const dbPath = path.join(tmp, "murmur.db");
  const backupsDir = path.join(tmp, "backups");
  const log = createLogger("test");
  try {
    const old = await openDatabase({ dbPath, migrationsDir: olderMigrations(path.join(tmp, "old"), V0_7_MIGRATIONS), backupsDir, log });
    old.sqlite.prepare("INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (1, 'reader', 'x', 1, 0)").run();
    old.sqlite
      .prepare(
        "INSERT INTO books (id, folder_path, content_key, scan_signature, title, author, duration_sec, added_at, updated_at) VALUES ('b1', 'Author/Book', 'k', 's', 'Book', 'Author', 3600, 0, 0)",
      )
      .run();
    old.sqlite.prepare("INSERT INTO progress (user_id, item_type, item_id, position_sec, duration_sec, updated_at) VALUES (1, 'book', 'b1', 1234, 3600, 0)").run();
    old.sqlite.close();

    const { sqlite, db } = await openDatabase({ dbPath, migrationsDir: MIGRATIONS, backupsDir, log });
    try {
      // Every table the code knows reads back, so no column it expects is missing.
      for (const table of Object.values(schema)) {
        if (is(table, SQLiteTable)) expect(() => db.select().from(table).all(), getTableName(table)).not.toThrow();
      }
      expect(sqlite.prepare("SELECT username FROM users").get()).toEqual({ username: "reader" });
      expect(sqlite.prepare("SELECT title FROM books WHERE id = 'b1'").get()).toEqual({ title: "Book" });
      expect(sqlite.prepare("SELECT position_sec FROM progress WHERE item_id = 'b1'").get()).toEqual({ position_sec: 1234 });
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(fs.readdirSync(backupsDir).some((f) => f.startsWith("pre-migration-"))).toBe(true);
    } finally {
      sqlite.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
