import fs from "node:fs/promises";
import path from "node:path";
import { errorMessage, type Logger } from "../log";
import { isIgnoredName } from "./parse";
import { createLimiter } from "./probe";
import type { ScanState, ScanStats } from "./scanner";

/** What's shared by the book, music and watch scanners: running one pass at a time, and walking a folder. */

export interface ScanPass {
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
      try {
        const { stats, problems, finished } = await once();
        state.lastStats = stats;
        state.lastError = problems.length ? problems.join(" ") : null;
        log.info(finished ?? `${name} finished`, { ...stats, ms: Date.now() - started });
        // Not awaited: online lookups mustn't hold up the next scan or the status.
        void afterScan?.().catch((err: unknown) => log.warn("after-scan step failed", { error: errorMessage(err) }));
      } catch (err) {
        state.lastError = errorMessage(err);
        log.error(`${name} failed`, { error: state.lastError });
      } finally {
        state.lastFinishedAt = Date.now();
        state.lastDurationMs = Date.now() - started;
      }
    } while (state.rerunRequested);
  } finally {
    state.running = false;
  }
}

const fsLimit = createLimiter(16);

export interface WalkedFile {
  name: string;
  relPath: string;
}

/** A file's details for telling whether it changed. */
export async function fileDetails(root: string, relPath: string) {
  const st = await fsLimit(() => fs.stat(path.join(root, relPath)));
  return { relPath, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
}

/** Calls `onFolder` with each folder's files, in any order. A subfolder that can't be read is skipped; the root can't be. */
export async function walkTree(root: string, log: Logger, onFolder: (rel: string, files: WalkedFile[]) => Promise<void>): Promise<void> {
  async function visit(rel: string): Promise<void> {
    let entries;
    try {
      entries = (await fsLimit(() => fs.readdir(path.join(root, rel), { withFileTypes: true }))).filter((e) => !isIgnoredName(e.name));
    } catch (err) {
      if (rel === "") throw err;
      log.warn("cannot read folder, skipping", { folder: rel, error: errorMessage(err) });
      return;
    }
    const inside = (name: string) => (rel ? `${rel}/${name}` : name);
    const files = entries.filter((e) => e.isFile()).map((e) => ({ name: e.name, relPath: inside(e.name) }));
    await Promise.all([onFolder(rel, files), ...entries.filter((e) => e.isDirectory()).map((e) => visit(inside(e.name)))]);
  }
  await visit("");
}
