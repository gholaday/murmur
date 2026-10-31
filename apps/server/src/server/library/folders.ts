import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import type { LibraryFolderDto } from "@murmur/shared";
import type { Db, Sqlite } from "../db";
import { books, libraryFolders } from "../db/schema";

// The folders the library is read from, books, music, movies and shows each with their own list.
// They come from what's mounted: on every start each kind picks up its folder (LIBRARY_DIR,
// MUSIC_DIR, MOVIES_DIR, SHOWS_DIR) and any beside it named like it, so /audiobooks-2 is a second
// book folder. Nothing is set up in Settings.

export type FolderKind = "books" | "music" | "movies" | "shows";

export interface LibraryFolder {
  id: number;
  path: string;
}

export function listFolders(db: Db, kind: FolderKind = "books"): LibraryFolder[] {
  return db
    .select({ id: libraryFolders.id, path: libraryFolders.path })
    .from(libraryFolders)
    .where(eq(libraryFolders.kind, kind))
    .orderBy(asc(libraryFolders.id))
    .all();
}

/** A kind's folder and the ones beside it named like it, a dash and anything: /audiobooks, /audiobooks-2. */
export function isMountName(name: string, base: string): boolean {
  return name === base || name.startsWith(`${base}-`);
}

/**
 * A folder as the disk has it, so one directory compares equal however its path was spelled (the
 * case on Windows and macOS, a symlink), and whether it's gone. Only a path that no longer exists
 * counts as gone: one the server can't read right now (permissions, a flaky share) stays, and the
 * scan reports it.
 */
async function onDisk(p: string): Promise<{ real: string; gone: boolean }> {
  try {
    return { real: await fs.realpath(p), gone: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { real: p, gone: code === "ENOENT" || code === "ENOTDIR" };
  }
}

/**
 * Makes a kind's folder list match what's mounted: folders named like `dir` are added, and a folder
 * whose path is gone (taken out of the compose file) is dropped. One that's there but empty, like a
 * network share that hasn't come up, stays. A path another kind already reads is left to that kind.
 */
export async function syncFolders(db: Db, kind: FolderKind, dir: string): Promise<void> {
  const parent = path.dirname(dir);
  const entries = await fs.readdir(parent, { withFileTypes: true }).catch(() => []);
  const mounted = entries
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && isMountName(e.name, path.basename(dir)))
    .map((e) => path.join(parent, e.name))
    .sort();
  const all = db.select({ path: libraryFolders.path, kind: libraryFolders.kind }).from(libraryFolders).all();
  const taken = new Set(await Promise.all(all.filter((f) => f.kind !== kind).map(async (f) => (await onDisk(f.path)).real)));
  const current = await Promise.all(listFolders(db, kind).map(async (f) => ({ path: f.path, ...(await onDisk(f.path)) })));
  const kept = current.filter((f) => !f.gone);
  const have = new Set(kept.map((f) => f.real));
  const added: string[] = [];
  for (const p of mounted) {
    const { real } = await onDisk(p);
    if (have.has(real) || taken.has(real)) continue;
    have.add(real);
    added.push(p);
  }
  if (added.length || kept.length !== current.length) saveFolders(db, [...kept.map((f) => f.path), ...added], kind);
}

/** The folders with their book (or album) counts and whether the server can open them, for Settings. */
export async function folderList(db: Db, sqlite: Sqlite, kind: FolderKind = "books"): Promise<LibraryFolderDto[]> {
  const counts: Record<FolderKind, string> = {
    books: "SELECT library_folder_id AS id, COUNT(*) AS n FROM books WHERE missing_since IS NULL GROUP BY library_folder_id",
    music: "SELECT folder_id AS id, COUNT(DISTINCT album_id) AS n FROM tracks WHERE missing_since IS NULL GROUP BY folder_id",
    movies: "SELECT folder_id AS id, COUNT(DISTINCT movie_id) AS n FROM videos WHERE kind = 'movie' AND missing_since IS NULL GROUP BY folder_id",
    shows: "SELECT folder_id AS id, COUNT(*) AS n FROM shows GROUP BY folder_id",
  };
  const rows = sqlite.prepare(counts[kind]).all() as Array<{ id: number | null; n: number }>;
  const byFolder = new Map(rows.map((r) => [r.id, r.n]));
  return Promise.all(
    listFolders(db, kind).map(async (f) => ({
      id: f.id,
      path: f.path,
      books: byFolder.get(f.id) ?? 0,
      reachable: await fs.access(f.path).then(() => true, () => false),
    })),
  );
}

/**
 * Replaces the folder list. Books in a removed folder lose their folder; the next scan
 * either finds them in another folder (keeping their progress) or removes them.
 */
function saveFolders(db: Db, paths: string[], kind: FolderKind) {
  const wanted = new Set(paths);
  db.transaction((tx) => {
    const current = tx
      .select({ id: libraryFolders.id, path: libraryFolders.path })
      .from(libraryFolders)
      .where(eq(libraryFolders.kind, kind))
      .all();
    for (const f of current) {
      if (wanted.has(f.path)) continue;
      // Songs, videos and shows lose their folder by the foreign key; the next scan removes them.
      if (kind === "books") tx.update(books).set({ libraryFolderId: null }).where(eq(books.libraryFolderId, f.id)).run();
      tx.delete(libraryFolders).where(and(eq(libraryFolders.id, f.id), eq(libraryFolders.kind, kind))).run();
    }
    const have = new Set(current.map((f) => f.path));
    for (const p of paths) {
      if (!have.has(p)) tx.insert(libraryFolders).values({ path: p, kind, createdAt: Date.now() }).run();
    }
  });
}
