import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { eq, inArray, isNotNull, lt, and } from "drizzle-orm";
import type { Db } from "../db";
import { bookFiles, books, chapters } from "../db/schema";
import { newId } from "../ids";
import { errorMessage, type Logger } from "../log";
import { pickCoverImage, storeCover } from "./covers";
import type { LibraryFolder } from "./folders";
import { AUDIO_EXTENSIONS, DISC_FOLDER, IMAGE_EXTENSIONS, buildBookMetadata, extname, naturalCompare, type ScannedAudioFile } from "./parse";
import { createLimiter, createUnreadable, extractEmbeddedCover, probeFile } from "./probe";
import { fileDetails, type FoundFile, runScan, type ScanState, type ScanStats, walkTree } from "./scan-loop";
import { bumpChanges } from "../changes";

interface ScannerDeps {
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

interface BookFile extends FoundFile {
  name: string; // relative to the book folder, e.g. "CD 1/01.mp3"
}

interface BookFiles {
  relDir: string;
  audio: BookFile[];
  images: BookFile[];
  descTxt: BookFile | null;
  readerTxt: BookFile | null;
}

interface FoundBook extends BookFiles {
  folderId: number;
  root: string;
  signature: string;
  contentKey: string;
}

/**
 * Part of every book's scan signature. Bump it whenever parse.ts rules change, so an
 * upgrade re-reads every book once instead of keeping metadata from the old rules.
 */
const SCAN_RULES_VERSION = 2;

const toPosix = (p: string) => p.split(path.sep).join("/");
const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

class LibraryUnavailableError extends Error {}

/** What a file in a book folder is for, if anything. */
function bookFileKind(name: string): "audio" | "image" | "desc" | "reader" | null {
  const ext = extname(name);
  const lower = name.toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (lower === "desc.txt" || lower === "description.txt") return "desc";
  if (lower === "reader.txt" || lower === "narrator.txt") return "reader";
  return null;
}

/** Folders to rescan, by library folder id, relative with forward slashes; "" is the whole folder. */
type ScanScopes = Map<number, string[]>;

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
  const byDir = new Map<string, BookFiles>();
  const first = (a: BookFile | null, b: BookFile) => (a && a.name < b.name ? a : b);
  const bookIn = (relDir: string) => {
    let book = byDir.get(relDir);
    if (!book) byDir.set(relDir, (book = { relDir, audio: [], images: [], descTxt: null, readerTxt: null }));
    return book;
  };
  try {
    await walkTree(
      folder.path,
      log,
      async (rel, files) => {
        // A disc folder's audio belongs to the book above it, named "CD 1/01.mp3" inside it.
        // Anything below a disc folder isn't part of the book.
        const below = (startRel ? rel.slice(startRel.length + 1) : rel).split("/").slice(0, -1);
        if (rel !== startRel && below.some((p) => DISC_FOLDER.test(p))) return;
        const parent = path.posix.dirname(rel);
        const disc = rel !== startRel && DISC_FOLDER.test(path.posix.basename(rel));
        const relDir = disc ? (parent === "." ? "" : parent) : rel;
        await Promise.all(
          files.map(async ({ name, relPath }) => {
            const kind = bookFileKind(name);
            if (!kind || (disc && kind !== "audio")) return;
            const file = { ...(await fileDetails(folder.path, relPath)), name: relPath.slice(relDir ? relDir.length + 1 : 0) };
            const book = bookIn(relDir);
            if (kind === "audio") book.audio.push(file);
            else if (kind === "image") book.images.push(file);
            // With both desc.txt and description.txt (or reader.txt and narrator.txt), the first name wins.
            else if (kind === "desc") book.descTxt = first(book.descTxt, file);
            else book.readerTxt = first(book.readerTxt, file);
          }),
        );
      },
      startRel,
    );
  } catch (err) {
    log.warn("cannot read folder, skipping", { folder: startRel, error: errorMessage(err) });
    return [];
  }

  return [...byDir.values()]
    .filter((book) => book.relDir && book.audio.length > 0)
    .sort((a, b) => naturalCompare(a.relDir, b.relDir))
    .map((book) => {
      const all = [...book.audio, ...book.images, book.descTxt, book.readerTxt].filter((f): f is BookFile => f !== null);
      const signature = sha1(`rules:${SCAN_RULES_VERSION}\n` + all.map((f) => `${f.name}|${f.size}|${f.mtimeMs}`).sort().join("\n"));
      const contentKey = sha1(book.audio.map((f) => `${path.posix.basename(f.name)}|${f.size}`).sort().join("\n"));
      return { ...book, folderId: folder.id, root: folder.path, signature, contentKey };
    });
}

export function createScanner(deps: ScannerDeps) {
  const { db, log, state } = deps;
  const limit = createLimiter(Math.max(1, deps.probeConcurrency));
  const unreadable = createUnreadable();

  async function readText(root: string, file: BookFile | null): Promise<string | null> {
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
    const keyOf = (f: BookFile) => `${found.folderId}:${f.relPath}`;
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
    const id = existingId ?? newId();

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
    const stats = { found: foundBooks.length, added: 0, updated: 0, moved: 0, unchanged: 0, missing: 0, removed: 0, failed: 0 };
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
  function scan(scopes?: ScanScopes): Promise<void> {
    enqueue(scopes);
    return runScan({
      state,
      log,
      name: "scan",
      afterScan: deps.afterScan,
      once: async () => {
        const pass = queued;
        queued = null;
        const done = await runOnce(pass === "full" || pass === null ? undefined : pass);
        return { ...done, ...(pass === "full" ? {} : { finished: "folder rescan finished" }) };
      },
    });
  }

  /** Rescans just the folders holding these changed paths (absolute, from the file watcher). */
  function scanChanged(paths: string[]): Promise<void> {
    const scopes = scopesFor(deps.folders(), paths);
    return scopes.size ? scan(scopes) : Promise.resolve();
  }

  return { scan, scanChanged };
}

export type Scanner = ReturnType<typeof createScanner>;
