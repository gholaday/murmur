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
import { createLimiter, extractEmbeddedCover, probeFile } from "./probe";

export interface ScannerDeps {
  db: Db;
  /** The library folders to read, looked up at the start of every scan. */
  folders: () => LibraryFolder[];
  coversDir: string;
  probeConcurrency: number;
  missingGraceMs: number;
  log: Logger;
  state: ScanState;
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

interface FoundBook {
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

const toPosix = (p: string) => p.split(path.sep).join("/");
const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

export class LibraryUnavailableError extends Error {}

export function createScanner(deps: ScannerDeps) {
  const { db, log, state } = deps;
  const limit = createLimiter(Math.max(1, deps.probeConcurrency));

  async function listDir(abs: string) {
    return (await fs.readdir(abs, { withFileTypes: true })).filter((e) => !isIgnoredName(e.name));
  }

  async function fileInfo(absDir: string, relDir: string, prefix: string, name: string): Promise<FoundFile> {
    const st = await fs.stat(path.join(absDir, name));
    const inBook = prefix ? `${prefix}/${name}` : name;
    return { name: inBook, relPath: relDir ? `${relDir}/${inBook}` : inBook, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
  }

  /** Walks one library folder and returns every folder in it that holds audio files directly. */
  async function walk(folder: LibraryFolder): Promise<FoundBook[]> {
    const found: FoundBook[] = [];
    const libraryDir = folder.path;

    async function visit(relDir: string) {
      const absDir = path.join(libraryDir, relDir);
      let entries;
      try {
        entries = await listDir(absDir);
      } catch (err) {
        log.warn("cannot read folder, skipping", { folder: relDir, error: errorMessage(err) });
        return;
      }
      const book: Omit<FoundBook, "signature" | "contentKey" | "folderId" | "root"> = { relDir, audio: [], images: [], descTxt: null, readerTxt: null };
      const subdirs: string[] = [];
      for (const e of entries) {
        if (e.isDirectory()) subdirs.push(e.name);
        else if (e.isFile()) await classify(book, absDir, relDir, "", e.name);
      }
      const discDirs = subdirs.filter((d) => DISC_FOLDER.test(d)).sort(naturalCompare);
      if (discDirs.length > 0) {
        for (const disc of discDirs) {
          const absDisc = path.join(absDir, disc);
          for (const e of await listDir(absDisc)) {
            if (e.isFile() && AUDIO_EXTENSIONS.has(extname(e.name))) {
              book.audio.push(await fileInfo(absDisc, relDir, disc, e.name));
            }
          }
        }
      }
      if (book.audio.length > 0 && relDir) found.push(finish(book));
      for (const d of subdirs) {
        if (discDirs.length > 0 && DISC_FOLDER.test(d)) continue;
        await visit(relDir ? `${relDir}/${d}` : d);
      }
    }

    async function classify(book: Omit<FoundBook, "signature" | "contentKey" | "folderId" | "root">, absDir: string, relDir: string, prefix: string, name: string) {
      const ext = extname(name);
      const lower = name.toLowerCase();
      if (AUDIO_EXTENSIONS.has(ext)) book.audio.push(await fileInfo(absDir, relDir, prefix, name));
      else if (IMAGE_EXTENSIONS.has(ext)) book.images.push(await fileInfo(absDir, relDir, prefix, name));
      else if (lower === "desc.txt" || lower === "description.txt") book.descTxt = await fileInfo(absDir, relDir, prefix, name);
      else if (lower === "reader.txt" || lower === "narrator.txt") book.readerTxt = await fileInfo(absDir, relDir, prefix, name);
    }

    function finish(book: Omit<FoundBook, "signature" | "contentKey" | "folderId" | "root">): FoundBook {
      const all = [...book.audio, ...book.images, book.descTxt, book.readerTxt].filter((f): f is FoundFile => f !== null);
      const signature = sha1(
        `rules:${SCAN_RULES_VERSION}\n` + all.map((f) => `${f.name}|${f.size}|${f.mtimeMs}`).sort().join("\n"),
      );
      const contentKey = sha1(book.audio.map((f) => `${path.posix.basename(f.name)}|${f.size}`).sort().join("\n"));
      return { ...book, folderId: folder.id, root: libraryDir, signature, contentKey };
    }

    await visit("");
    return found;
  }

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
    let audio: ScannedAudioFile[];
    try {
      audio = await Promise.all(
        found.audio.map((f) =>
          limit(async () => ({ ...f, probe: await probeFile(path.join(found.root, f.relPath)) })),
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

  async function runOnce(): Promise<{ stats: ScanStats; problems: string[] }> {
    const now = Date.now();
    const folders = deps.folders();
    if (folders.length === 0) throw new LibraryUnavailableError("No library folders are set. Add one in Settings.");

    const existing = db
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
    for (const folder of folders) {
      try {
        await fs.access(folder.path);
      } catch {
        unavailable.add(folder.id);
        problems.push(`${folder.path} is not reachable; its books were left as they were.`);
        continue;
      }
      const inFolder = await walk(folder);
      const known = existing.filter((b) => b.folderId === folder.id && b.missingSince === null).length;
      if (inFolder.length === 0 && known > 0) {
        unavailable.add(folder.id);
        problems.push(`${folder.path} looks empty but ${known} books are known there; they were left as they were.`);
        continue;
      }
      foundBooks.push(...inFolder);
    }
    if (unavailable.size === folders.length) throw new LibraryUnavailableError(problems.join(" "));

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
        if (await importBook(found, current.id, now)) stats.updated++;
        else stats.failed++;
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
          log.info("book folder moved", { from: movedFrom.folderPath, to: found.relDir });
        } else stats.failed++;
        return;
      }
      if (await importBook(found, null, now)) stats.added++;
      else stats.failed++;
    });
    await Promise.all(tasks);

    // Books from a folder that was removed in Settings, and not found elsewhere, leave now.
    const orphans = existing.filter((b) => !seen.has(b.id) && isOrphan(b.folderId)).map((b) => b.id);
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
    return { stats, problems };
  }

  /** Runs a scan; if one is already running, another pass is queued to start right after. */
  async function scan(): Promise<void> {
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
          const { stats, problems } = await runOnce();
          state.lastStats = stats;
          state.lastError = problems.length ? problems.join(" ") : null;
          log.info("scan finished", { ...stats, ms: Date.now() - started });
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

  return { scan };
}

export type Scanner = ReturnType<typeof createScanner>;
