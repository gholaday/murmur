import fs from "node:fs/promises";
import path from "node:path";
import type { Sqlite } from "../db";
import { errorMessage, type Logger } from "../log";
import { isIgnoredName } from "./parse";
import { createLimiter } from "./probe";

/**
 * What's shared by the book, music and watch scanners: running one pass at a time, walking a
 * folder, and keeping track of files that went missing.
 */

export interface ScanState {
  running: boolean;
  rerunRequested: boolean;
  lastFinishedAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastStats: ScanStats | null;
}

export interface ScanStats {
  found: number;
  added: number;
  updated: number;
  /** Books only: a folder renamed or moved, matched by its files. */
  moved?: number;
  unchanged: number;
  missing: number;
  removed: number;
  failed: number;
}

export function createScanState(): ScanState {
  return { running: false, rerunRequested: false, lastFinishedAt: null, lastDurationMs: null, lastError: null, lastStats: null };
}

export const emptyStats = (): ScanStats => ({ found: 0, added: 0, updated: 0, unchanged: 0, missing: 0, removed: 0, failed: 0 });

interface ScanPass {
  stats: ScanStats;
  problems: string[];
  /** The log line, when it isn't `<name> finished`. */
  finished?: string;
}

/**
 * Runs passes of a scan until nobody's waiting for another. If one is already running, another
 * pass is asked for and starts right after it.
 */
export async function runScan(opts: { state: ScanState; log: Logger; name: string; once: () => Promise<ScanPass>; afterScan?: () => Promise<void> }): Promise<void> {
  const { state, log, name, once, afterScan } = opts;
  if (state.running) {
    state.rerunRequested = true;
    return;
  }
  state.running = true;
  try {
    do {
      state.rerunRequested = false;
      const started = Date.now();
      let finishedAt = 0;
      try {
        const { stats, problems, finished } = await once();
        state.lastStats = stats;
        state.lastError = problems.length ? problems.join(" ") : null;
        log.info(finished ?? `${name} finished`, { ...stats, ms: Date.now() - started });
        // Not awaited: online lookups mustn't hold up the next scan or the status.
        // Its failure shows beside this scan's own problems, unless another scan has finished since.
        void afterScan?.().catch((err: unknown) => {
          log.warn("after-scan step failed", { error: errorMessage(err) });
          if (state.lastFinishedAt !== finishedAt) return;
          const message = `After the scan: ${errorMessage(err)}`;
          state.lastError = state.lastError ? `${state.lastError} ${message}` : message;
        });
      } catch (err) {
        state.lastError = errorMessage(err);
        log.error(`${name} failed`, { error: state.lastError });
      } finally {
        finishedAt = Date.now();
        state.lastFinishedAt = finishedAt;
        state.lastDurationMs = finishedAt - started;
      }
    } while (state.rerunRequested);
  } finally {
    state.running = false;
  }
}

// Folder listings and file stats run a few at a time: one by one, a large library on a
// network share spends most of a scan waiting on round trips.
const fsLimit = createLimiter(16);

interface WalkedFile {
  name: string;
  relPath: string;
}

export interface FoundFile {
  relPath: string;
  size: number;
  mtimeMs: number;
}

/** A file's details for telling whether it changed. */
export async function fileDetails(root: string, relPath: string): Promise<FoundFile> {
  const st = await fsLimit(() => fs.stat(path.join(root, relPath)));
  return { relPath, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
}

/**
 * Calls `onFolder` with each folder's files, in any order, from `start` (relative, forward
 * slashes) down. A subfolder that can't be read is skipped; the start can't be.
 */
export async function walkTree(
  root: string,
  log: Logger,
  onFolder: (rel: string, files: WalkedFile[]) => Promise<void>,
  start = "",
): Promise<void> {
  async function visit(rel: string): Promise<void> {
    let entries;
    try {
      entries = (await fsLimit(() => fs.readdir(path.join(root, rel), { withFileTypes: true }))).filter((e) => !isIgnoredName(e.name));
    } catch (err) {
      if (rel === start) throw err;
      log.warn("cannot read folder, skipping", { folder: rel, error: errorMessage(err) });
      return;
    }
    const inside = (name: string) => (rel ? `${rel}/${name}` : name);
    const files = entries.filter((e) => e.isFile()).map((e) => ({ name: e.name, relPath: inside(e.name) }));
    await Promise.all([onFolder(rel, files), ...entries.filter((e) => e.isDirectory()).map((e) => visit(inside(e.name)))]);
  }
  await visit(start);
}

export interface FileRow {
  id: string;
  rel_path: string;
  size: number;
  mtime_ms: number;
  missing_since: number | null;
}

/**
 * The rows of a one-row-per-file table (songs, videos) checked against what a scan found. A file
 * not found is marked missing, and deleted once it's been gone `graceMs` or its folder was removed.
 */
export function fileRows<R extends FileRow>(sqlite: Sqlite, table: "tracks" | "videos", extraColumns: string[] = []) {
  const select = sqlite.prepare(`SELECT ${["id", "rel_path", "size", "mtime_ms", "missing_since", ...extraColumns].join(", ")} FROM ${table} WHERE folder_id = ?`);
  const setMissing = sqlite.prepare(`UPDATE ${table} SET missing_since = ? WHERE id = ? AND missing_since IS NULL`);
  const clearMissing = sqlite.prepare(`UPDATE ${table} SET missing_since = NULL WHERE id = ?`);
  const expired = sqlite.prepare(`DELETE FROM ${table} WHERE folder_id IS NULL OR (missing_since IS NOT NULL AND missing_since < ?)`);
  return {
    /** A folder's rows by path. Take each found file out; what's left wasn't found. */
    inFolder: (folderId: number) => new Map((select.all(folderId) as R[]).map((r) => [r.rel_path, r])),
    /** The file is as recorded; a row marked missing comes back. */
    unchanged(row: R | undefined, file: FoundFile): row is R {
      if (!row || row.size !== file.size || row.mtime_ms !== file.mtimeMs) return false;
      if (row.missing_since !== null) clearMissing.run(row.id);
      return true;
    },
    /** Marks rows missing, returning how many. */
    markMissing(rows: Iterable<R>, now: number): number {
      let n = 0;
      for (const r of rows) {
        n++;
        setMissing.run(now, r.id);
      }
      return n;
    },
    /** Deletes rows gone long enough or whose folder was removed, returning how many. */
    removeExpired: (now: number, graceMs: number) => expired.run(now - graceMs).changes,
  };
}
