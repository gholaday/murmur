import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Logger } from "../log";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;
export type Sqlite = Database.Database;

export interface DbHandle {
  sqlite: Sqlite;
  db: Db;
}

interface OpenOptions {
  dbPath: string;
  migrationsDir: string;
  backupsDir: string;
  log: Logger;
}

function countJournalEntries(migrationsDir: string): number {
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8"),
  ) as { entries: unknown[] };
  return journal.entries.length;
}

function countAppliedMigrations(sqlite: Sqlite): number {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return 0;
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number };
  return row.n;
}

/**
 * Opens the database, tunes it for a small always-on server, and applies pending
 * migrations. An existing database is copied to the backups folder before any
 * migration runs, so a bad update can always be rolled back by hand.
 */
export async function openDatabase({ dbPath, migrationsDir, backupsDir, log }: OpenOptions): Promise<DbHandle> {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("temp_store = MEMORY");
  sqlite.pragma("cache_size = -16000"); // 16 MB

  const pending = countJournalEntries(migrationsDir) - countAppliedMigrations(sqlite);
  if (pending > 0) {
    if (countAppliedMigrations(sqlite) > 0) {
      fs.mkdirSync(backupsDir, { recursive: true });
      const file = path.join(backupsDir, `pre-migration-${timestamp()}.db`);
      await sqlite.backup(file);
      log.info("database backed up before migration", { file, pending });
      pruneBackups(backupsDir, "pre-migration-", 5);
    }
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: migrationsDir });
    log.info("migrations applied", { count: pending });
  }

  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export async function backupDatabase(sqlite: Sqlite, backupsDir: string, keep: number, log: Logger) {
  fs.mkdirSync(backupsDir, { recursive: true });
  const file = path.join(backupsDir, `nightly-${timestamp()}.db`);
  await sqlite.backup(file);
  pruneBackups(backupsDir, "nightly-", keep);
  log.info("nightly backup written", { file });
}

function pruneBackups(dir: string, prefix: string, keep: number) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".db"))
    .sort(); // timestamps sort lexically
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
