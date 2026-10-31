import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { eq, inArray, isNotNull, lt, and } from "drizzle-orm";
import type { Db } from "../db";
import { bookFiles, books, chapters } from "../db/schema";
import { errorMessage, type Logger } from "../log";
import { pickCoverImage, storeCover } from "./covers";
import type { LibraryFolder } from "./folders";
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  buildBookMetadata,
  extname,
  isIgnoredName,
  naturalCompare,
  type ScannedAudioFile,
} from "./parse";
import { createLimiter, createUnreadable, extractEmbeddedCover, probeFile } from "./probe";
import { bumpChanges } from "../changes";

export interface ScannerDeps {
  db: Db;
  /** The library folders to read, looked up at the start of every scan. */
  folders: () => LibraryFolder[];
  coversDir: string;
  probeConcurrency: number;
  missingGraceMs: number;
  log: Logger;
  state: ScanState;
  /** Runs after each scan, for lookups that need the new books (matching on their own). */
  afterScan?: () => Promise<void>;
}

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
  moved: number;
  unchanged: number;
  missing: number;
  removed: number;
  failed: number;
}

export function createScanState(): ScanState {
  return { running: false, rerunRequested: false, lastFinishedAt: null, lastDurationMs: null, lastError: null, lastStats: null };
}

interface FoundFile {
  name: string; // relative to the book folder, e.g. "CD 1/01.mp3"
  relPath: string; // relative to the library folder
  size: number;
  mtimeMs: number;
}

export interface FoundBook {
  folderId: number;
  root: string;
  relDir: string;
  audio: FoundFile[];
  images: FoundFile[];
  descTxt: FoundFile | null;
  readerTxt: FoundFile | null;
  signature: string;
  contentKey: string;
}

/**
 * Part of every book's scan signature. Bump it whenever parse.ts rules change, so an
 * upgrade re-reads every book once instead of keeping metadata from the old rules.
 */
const SCAN_RULES_VERSION = 2;

/** "CD 1", "Disc 2", "Part 03" subfolders belong to the book above them. */
const DISC_FOLDER = /^(?:cd|disc|disk|part)\s*\d+$/i;
/** Folder listings and file stats in flight at once while walking a library. */
const WALK_CONCURRENCY = 16;

const toPosix = (p: string) => p.split(path.sep).join("/");
const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

export class LibraryUnavailableError extends Error {}

// Folder listings and file stats run a few at a time: one by one, a large library on a
// network share spends most of a scan waiting on round trips.
const fsLimit = createLimiter(WALK_CONCURRENCY);

async function listDir(abs: string) {
  return (await fsLimit(() => fs.readdir(abs, { withFileTypes: true }))).filter((e) => !isIgnoredName(e.name));
}

async function fileInfo(absDir: string, relDir: string, prefix: string, name: string): Promise<FoundFile> {
  const st = await fsLimit(() => fs.stat(path.join(absDir, name)));
  const inBook = prefix ? `${prefix}/${name}` : name;
  return { name: inBook, relPath: relDir ? `${relDir}/${inBook}` : inBook, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
}

/** Folders to rescan, by library folder id, relative with forward slashes; "" is the whole folder. */
export type ScanScopes = Map<number, string[]>;

/**
 * The changed paths grouped by library folder, relative to it, with paths inside another
 * changed path dropped. `scanStart` turns each into the folder to walk.
 */
export function scopesFor(folders: LibraryFolder[], changed: string[]): ScanScopes {
  const scopes: ScanScopes = new Map();
  for (const p of changed) {
    const folder = folders.find((f) => {
      const rel = path.relative(f.path, p);
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    });
    if (!folder) continue;
    const list = scopes.get(folder.id) ?? [];
    list.push(toPosix(path.relative(folder.path, p)));
    scopes.set(folder.id, list);
  }
  for (const [id, list] of scopes) scopes.set(id, collapseScopes(list));
  return scopes;
}

/** `rel` is the folder `scope` or inside it. */
const withinScope = (rel: string, scope: string) => scope === "" || rel === scope || rel.startsWith(`${scope}/`);

/** Drops duplicates and folders inside another one in the list. */
function collapseScopes(list: string[]): string[] {
  const unique = [...new Set(list)];
  return unique.filter((s) => !unique.some((other) => other !== s && withinScope(s, other)));
}

/**
 * The folder to walk for a changed path: the path itself when it's a folder (a new book or
 * author), else the nearest folder above it, so a changed file rescans its book and a deleted
 * book its author. A disc folder ("CD 1") stands for the book above it.
 */
export async function scanStart(root: string, rel: string): Promise<string> {
  const parts = rel ? rel.split("/") : [];
  while (parts.length) {
    if (!DISC_FOLDER.test(parts.at(-1)!)) {
      try {
        if ((await fs.stat(path.join(root, ...parts))).isDirectory()) break;
      } catch {
        // gone: try its parent
      }
    }
    parts.pop();
  }
  return parts.join("/");
}

/**
 * Walks one library folder, or the part of it under `startRel`, and returns every folder
 * in it that holds audio files directly.
 */
export async function walkFolder(folder: LibraryFolder, log: Logger, startRel = ""): Promise<FoundBook[]> {
  const libraryDir = folder.path;

  /** The book in `relDir`, if it holds audio, then those in its subfolders, in folder order. */
  async function visit(relDir: string): Promise<FoundBook[]> {
    const absDir = path.join(libraryDir, relDir);
    let entries;
    try {
      entries = await listDir(absDir);
    } catch (err) {
      log.warn("cannot read folder, skipping", { folder: relDir, error: errorMessage(err) });
      return [];
    }
    const book: Omit<FoundBook, "signature" | "contentKey" | "folderId" | "root"> = { relDir, audio: [], images: [], descTxt: null, readerTxt: null };
    const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const discDirs = subdirs.filter((d) => DISC_FOLDER.test(d)).sort(naturalCompare);
    const [files, discs] = await Promise.all([
      Promise.all(entries.filter((e) => e.isFile()).map((e) => classify(absDir, relDir, "", e.name))),
      Promise.all(
        discDirs.map(async (disc) => {
          const absDisc = path.join(absDir, disc);
          const audio = (await listDir(absDisc)).filter((e) => e.isFile() && AUDIO_EXTENSIONS.has(extname(e.name)));
          return Promise.all(audio.map((e) => fileInfo(absDisc, relDir, disc, e.name)));
        }),
      ),
    ]);
    for (const f of files) {
      if (f?.kind === "audio") book.audio.push(f.file);
      else if (f?.kind === "image") book.images.push(f.file);
      else if (f?.kind === "desc") book.descTxt = f.file;
      else if (f?.kind === "reader") book.readerTxt = f.file;
    }
    book.audio.push(...discs.flat());
    const nested = await Promise.all(
      subdirs.filter((d) => !(discDirs.length > 0 && DISC_FOLDER.test(d))).map((d) => visit(relDir ? `${relDir}/${d}` : d)),
    );
    return [...(book.audio.length > 0 && relDir ? [finish(book)] : []), ...nested.flat()];
  }

  async function classify(absDir: string, relDir: string, prefix: string, name: string) {
    const ext = extname(name);
    const lower = name.toLowerCase();
    const kind = AUDIO_EXTENSIONS.has(ext)
      ? "audio"
      : IMAGE_EXTENSIONS.has(ext)
        ? "image"
        : lower === "desc.txt" || lower === "description.txt"
          ? "desc"
          : lower === "reader.txt" || lower === "narrator.txt"
            ? "reader"
            : null;
    return kind ? { kind, file: await fileInfo(absDir, relDir, prefix, name) } : null;
  }

  function finish(book: Omit<FoundBook, "signature" | "contentKey" | "folderId" | "root">): FoundBook {
    const all = [...book.audio, ...book.images, book.descTxt, book.readerTxt].filter((f): f is FoundFile => f !== null);
    const signature = sha1(
      `rules:${SCAN_RULES_VERSION}\n` + all.map((f) => `${f.name}|${f.size}|${f.mtimeMs}`).sort().join("\n"),
    );
    const contentKey = sha1(book.audio.map((f) => `${path.posix.basename(f.name)}|${f.size}`).sort().join("\n"));
    return { ...book, folderId: folder.id, root: libraryDir, signature, contentKey };
  }

  return visit(startRel);
}

export function createScanner(deps: ScannerDeps) {
  const { db, log, state } = deps;
  const limit = createLimiter(Math.max(1, deps.probeConcurrency));
  const unreadable = createUnreadable();

  async function readText(root: string, file: FoundFile | null): Promise<string | null> {
    if (!file) return null;
    try {
      return await fs.readFile(path.join(root, file.relPath), "utf8");
    } catch {
      return null;
    }
  }

  async function resolveCover(found: FoundBook, audio: ScannedAudioFile[]): Promise<string | null> {
    try {
      const imageName = pickCoverImage(found.images.map((i) => i.name));
      if (imageName) {
        const image = found.images.find((i) => i.name === imageName)!;
        return await storeCover(deps.coversDir, await fs.readFile(path.join(found.root, image.relPath)));
      }
      const withArt = audio.find((a) => a.probe.hasEmbeddedCover);
      if (withArt) {
        const bytes = await extractEmbeddedCover(path.join(found.root, withArt.relPath));
        if (bytes) return await storeCover(deps.coversDir, bytes);
      }
    } catch (err) {
      log.warn("cover could not be processed", { folder: found.relDir, error: errorMessage(err) });
    }
    return null;
  }

  /** Probes every file of one book and writes it. Returns false if the book couldn't be read. */
  async function importBook(found: FoundBook, existingId: string | null, now: number): Promise<boolean> {
    const keyOf = (f: FoundFile) => `${found.folderId}:${f.relPath}`;
    if (found.audio.some((f) => unreadable.skip(keyOf(f), f))) return false;
    let audio: ScannedAudioFile[];
    try {
      audio = await Promise.all(
        found.audio.map((f) =>
          limit(async () => {
            try {
              const probe = await probeFile(path.join(found.root, f.relPath));
              unreadable.read(keyOf(f));
              return { ...f, probe };
            } catch (err) {
              unreadable.failed(keyOf(f), f);
              throw err;
            }
          }),
        ),
      );
    } catch (err) {
      log.warn("book skipped: a file could not be read", { folder: found.relDir, error: errorMessage(err) });
      return false;
    }
    const meta = buildBookMetadata({
      relDir: found.relDir,
      files: audio,
      descTxt: await readText(found.root, found.descTxt),
      readerTxt: await readText(found.root, found.readerTxt),
    });
    const coverHash = await resolveCover(found, audio);
    const id = existingId ?? crypto.randomBytes(9).toString("base64url");

    db.transaction((tx) => {
      const values = {
        libraryFolderId: found.folderId,
        folderPath: found.relDir,
        contentKey: found.contentKey,
        scanSignature: found.signature,
        title: meta.title,
        author: meta.author,
        narrator: meta.narrator,
        series: meta.series,
        seriesPosition: meta.seriesPosition,
        description: meta.description,
        year: meta.year,
        asin: meta.asin,
        durationSec: meta.durationSec,
        coverHash,
        updatedAt: now,
        missingSince: null,
      };
      if (existingId) {
        tx.update(books).set(values).where(eq(books.id, id)).run();
        tx.delete(bookFiles).where(eq(bookFiles.bookId, id)).run();
        tx.delete(chapters).where(eq(chapters.bookId, id)).run();
      } else {
        tx.insert(books).values({ id, addedAt: now, ...values }).run();
      }
      if (meta.files.length) tx.insert(bookFiles).values(meta.files.map((f, idx) => ({ bookId: id, idx, ...f }))).run();
      if (meta.chapters.length) tx.insert(chapters).values(meta.chapters.map((c, idx) => ({ bookId: id, idx, ...c }))).run();
    });
    return true;
  }

  /**
   * Scans every library folder, or with `scopes` only those parts of them (after file
   * changes). A scoped scan only compares, moves and marks missing the books inside its scopes.
   */
  async function runOnce(scopes?: ScanScopes): Promise<{ stats: ScanStats; problems: string[] }> {
    const now = Date.now();
    const allFolders = deps.folders();
    if (allFolders.length === 0) throw new LibraryUnavailableError("No book folder is mounted. Mount your books at /audiobooks.");
    const folders = scopes ? allFolders.filter((f) => scopes.has(f.id)) : allFolders;

    const allExisting = db
      .select({
        id: books.id,
        folderId: books.libraryFolderId,
        folderPath: books.folderPath,
        contentKey: books.contentKey,
        scanSignature: books.scanSignature,
        missingSince: books.missingSince,
      })
      .from(books)
      .all();

    // Each folder is checked on its own: one unmounted share leaves its books alone
    // (an empty folder almost always means that, not deleted books) while the rest scan.
    const problems: string[] = [];
    const unavailable = new Set<number>();
    const foundBooks: FoundBook[] = [];
    // The parts of each folder walked: each changed path becomes the folder to walk.
    const walked = new Map<number, string[]>();
    for (const folder of folders) {
      try {
        await fs.access(folder.path);
      } catch {
        unavailable.add(folder.id);
        problems.push(`${folder.path} is not reachable; its books were left as they were.`);
        continue;
      }
      const starts = collapseScopes(await Promise.all((scopes?.get(folder.id) ?? [""]).map((s) => scanStart(folder.path, s))));
      walked.set(folder.id, starts);
      const inFolder = (await Promise.all(starts.map((s) => walkFolder(folder, log, s)))).flat();
      const known = allExisting.filter((b) => b.folderId === folder.id && b.missingSince === null).length;
      if (starts.includes("") && inFolder.length === 0 && known > 0) {
        unavailable.add(folder.id);
        problems.push(`${folder.path} looks empty but ${known} books are known there; they were left as they were.`);
        continue;
      }
      foundBooks.push(...inFolder);
    }
    if (folders.length && unavailable.size === folders.length) throw new LibraryUnavailableError(problems.join(" "));
    const existing = scopes
      ? allExisting.filter((b) => b.folderId !== null && (walked.get(b.folderId) ?? []).some((s) => withinScope(b.folderPath, s)))
      : allExisting;

    const keyOf = (folderId: number | null, relDir: string) => `${folderId}:${relDir}`;
    const stats: ScanStats = { found: foundBooks.length, added: 0, updated: 0, moved: 0, unchanged: 0, missing: 0, removed: 0, failed: 0 };
    const byPath = new Map(existing.map((b) => [keyOf(b.folderId, b.folderPath), b]));
    const foundPaths = new Set(foundBooks.map((b) => keyOf(b.folderId, toPosix(b.relDir))));
    const claimed = new Set<string>();
    const seen = new Set<string>();
    const folderIds = new Set(folders.map((f) => f.id));
    const isOrphan = (folderId: number | null) => folderId === null || !folderIds.has(folderId);
    const isUnavailable = (folderId: number | null) => folderId !== null && unavailable.has(folderId);

    const tasks = foundBooks.map(async (found) => {
      const current = byPath.get(keyOf(found.folderId, found.relDir));
      if (current) {
        seen.add(current.id);
        if (current.scanSignature === found.signature) {
          if (current.missingSince !== null) db.update(books).set({ missingSince: null }).where(eq(books.id, current.id)).run();
          stats.unchanged++;
          return;
        }
        if (await importBook(found, current.id, now)) {
          stats.updated++;
          bumpChanges("books");
        } else stats.failed++;
        return;
      }
      // A new folder whose files match a book whose old folder is gone: the folder was moved or renamed.
      const movedFrom = existing.find(
        (b) =>
          b.contentKey === found.contentKey &&
          !foundPaths.has(keyOf(b.folderId, b.folderPath)) &&
          !isUnavailable(b.folderId) &&
          !claimed.has(b.id),
      );
      if (movedFrom) {
        claimed.add(movedFrom.id);
        seen.add(movedFrom.id);
        if (await importBook(found, movedFrom.id, now)) {
          stats.moved++;
          bumpChanges("books");
          log.info("book folder moved", { from: movedFrom.folderPath, to: found.relDir });
        } else stats.failed++;
        return;
      }
      if (await importBook(found, null, now)) {
        stats.added++;
        bumpChanges("books");
      } else stats.failed++;
    });
    await Promise.all(tasks);

    // Books from a folder that was removed in Settings, and not found elsewhere, leave now.
    const orphans = scopes ? [] : existing.filter((b) => !seen.has(b.id) && isOrphan(b.folderId)).map((b) => b.id);
    if (orphans.length) {
      db.delete(books).where(inArray(books.id, orphans)).run();
      stats.removed += orphans.length;
    }
    // Other books we didn't see are marked missing, never deleted straight away.
    const newlyMissing = existing
      .filter((b) => !seen.has(b.id) && !isOrphan(b.folderId) && !isUnavailable(b.folderId) && b.missingSince === null)
      .map((b) => b.id);
    if (newlyMissing.length) {
      db.update(books).set({ missingSince: now }).where(inArray(books.id, newlyMissing)).run();
      stats.missing = newlyMissing.length;
    }
    // After the grace period they are removed; listening progress is kept regardless.
    const removed = db
      .delete(books)
      .where(and(isNotNull(books.missingSince), lt(books.missingSince, now - deps.missingGraceMs)))
      .returning({ id: books.id })
      .all();
    stats.removed += removed.length;
    if (stats.removed || stats.missing) bumpChanges("books");
    return { stats, problems };
  }

  /** What the next pass covers: everything, or the scopes asked for while one was running. */
  let queued: ScanScopes | "full" | null = null;

  function enqueue(scopes?: ScanScopes) {
    if (!scopes || queued === "full") {
      queued = "full";
      return;
    }
    const next: ScanScopes = new Map(queued ?? []);
    for (const [id, list] of scopes) next.set(id, collapseScopes([...(next.get(id) ?? []), ...list]));
    queued = next;
  }

  /**
   * Runs a scan of everything, or with `scopes` of just those folders. If one is already
   * running, another pass is queued to start right after, merging what was asked for.
   */
  async function scan(scopes?: ScanScopes): Promise<void> {
    enqueue(scopes);
    if (state.running) {
      state.rerunRequested = true;
      return;
    }
    state.running = true;
    try {
      do {
        state.rerunRequested = false;
        const pass = queued;
        queued = null;
        const started = Date.now();
        try {
          const { stats, problems } = await runOnce(pass === "full" || pass === null ? undefined : pass);
          state.lastStats = stats;
          state.lastError = problems.length ? problems.join(" ") : null;
          log.info(pass === "full" ? "scan finished" : "folder rescan finished", { ...stats, ms: Date.now() - started });
          // Not awaited: online lookups mustn't hold up the next scan or the status.
          void deps.afterScan?.().catch((err: unknown) => log.warn("after-scan step failed", { error: errorMessage(err) }));
        } catch (err) {
          state.lastError = errorMessage(err);
          log.error("scan failed", { error: state.lastError });
        } finally {
          state.lastFinishedAt = Date.now();
          state.lastDurationMs = Date.now() - started;
        }
      } while (state.rerunRequested);
    } finally {
      state.running = false;
    }
  }

  /** Rescans just the folders holding these changed paths (absolute, from the file watcher). */
  function scanChanged(paths: string[]): Promise<void> {
    const scopes = scopesFor(deps.folders(), paths);
    return scopes.size ? scan(scopes) : Promise.resolve();
  }

  return { scan, scanChanged };
}

export type Scanner = ReturnType<typeof createScanner>;
