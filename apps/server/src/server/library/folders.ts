import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { LibraryFolderDto } from "@murmur/shared";
import type { Db, Sqlite } from "../db";
import { books, libraryFolders } from "../db/schema";
import { readState, writeState } from "../settings";
import { isIgnoredName } from "./parse";

// The folders the library is read from, books and music each with their own list. An admin
// manages them in Settings; on first start the book list is seeded with LIBRARY_DIR so existing
// setups keep working unchanged, and the music list with MUSIC_DIR once that's mounted.

export type FolderKind = "books" | "music";

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

/** Every folder of both kinds, for overlap checks: no folder may be scanned twice. */
export function allFolderPaths(db: Db): Array<{ path: string; kind: FolderKind }> {
  return db.select({ path: libraryFolders.path, kind: libraryFolders.kind }).from(libraryFolders).all();
}

/** Seeds the book folder list with LIBRARY_DIR when it's empty, and files existing books under it. */
export function ensureDefaultFolder(db: Db, defaultDir: string) {
  if (listFolders(db).length > 0) return;
  db.transaction((tx) => {
    const row = tx.insert(libraryFolders).values({ path: defaultDir, createdAt: Date.now() }).returning({ id: libraryFolders.id }).get();
    tx.update(books).set({ libraryFolderId: row.id }).where(isNull(books.libraryFolderId)).run();
  });
}

/**
 * Adds MUSIC_DIR (/music by default) as the first music folder once it's mounted. It's added only
 * once, so a folder an admin removes stays removed; with nothing mounted there, music stays off.
 */
export async function ensureDefaultMusicFolder(db: Db, sqlite: Sqlite, musicDir: string) {
  if (readState<boolean>(sqlite, "musicFolderSeeded")) return;
  if (listFolders(db, "music").length === 0) {
    const mounted = await fs.stat(musicDir).then((s) => s.isDirectory(), () => false);
    if (!mounted) return;
    if (allFolderPaths(db).some((f) => f.path === musicDir)) return;
    db.insert(libraryFolders).values({ path: musicDir, kind: "music", createdAt: Date.now() }).run();
  }
  writeState(sqlite, "musicFolderSeeded", true);
}

/** Normalises what an admin typed: absolute, no trailing slash. */
export function normalizeFolder(input: string): string {
  const trimmed = input.trim();
  const resolved = path.resolve(trimmed);
  return resolved.length > 1 ? resolved.replace(/[\\/]+$/, "") : resolved;
}

const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

export interface FolderCheck {
  path: string;
  ok: boolean;
  /** Why it can't be used, or a warning worth showing even when it can. */
  message: string;
  /** Subfolders directly inside, as a hint that it's the right place. */
  subfolders: number;
}

/** Checks that a folder exists, can be read, and doesn't overlap the other folders. */
export async function checkFolder(input: string, others: string[]): Promise<FolderCheck> {
  const p = normalizeFolder(input);
  if (!path.isAbsolute(input.trim())) return { path: p, ok: false, message: "Use a full path, starting with /.", subfolders: 0 };
  const overlap = others.find((o) => isInside(p, o) || isInside(o, p));
  if (overlap) {
    return {
      path: p,
      ok: false,
      message: p === overlap ? "That folder is already in the list." : `Overlaps ${overlap}; books would be found twice.`,
      subfolders: 0,
    };
  }
  let entries;
  try {
    const st = await fs.stat(p);
    if (!st.isDirectory()) return { path: p, ok: false, message: "That's a file, not a folder.", subfolders: 0 };
    entries = await fs.readdir(p, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const message =
      code === "ENOENT"
        ? "The server can't find that folder. In Docker, mount it into the container first."
        : code === "EACCES" || code === "EPERM"
          ? "The server isn't allowed to read that folder."
          : "The server can't open that folder.";
    return { path: p, ok: false, message, subfolders: 0 };
  }
  const subfolders = entries.filter((e) => e.isDirectory() && !isIgnoredName(e.name)).length;
  return {
    path: p,
    ok: true,
    message: subfolders === 0 ? "Readable, but it has no subfolders yet." : `Readable, ${subfolders} ${subfolders === 1 ? "folder" : "folders"} inside.`,
    subfolders,
  };
}

/** The folders with their book (or album) counts and whether the server can open them, for Settings. */
export async function folderList(db: Db, sqlite: Sqlite, kind: FolderKind = "books"): Promise<LibraryFolderDto[]> {
  const rows = sqlite
    .prepare(
      kind === "books"
        ? "SELECT library_folder_id AS id, COUNT(*) AS n FROM books WHERE missing_since IS NULL GROUP BY library_folder_id"
        : "SELECT folder_id AS id, COUNT(DISTINCT album_id) AS n FROM tracks WHERE missing_since IS NULL GROUP BY folder_id",
    )
    .all() as Array<{ id: number | null; n: number }>;
  const counts = new Map(rows.map((r) => [r.id, r.n]));
  return Promise.all(
    listFolders(db, kind).map(async (f) => ({
      id: f.id,
      path: f.path,
      books: counts.get(f.id) ?? 0,
      reachable: await fs.access(f.path).then(() => true, () => false),
    })),
  );
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  folders: string[];
}

/** Lists the subfolders of a folder so an admin can pick one instead of typing a path. */
export async function browseFolder(input: string): Promise<BrowseResult> {
  const p = normalizeFolder(input || "/");
  const entries = await fs.readdir(p, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory() && !isIgnoredName(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const parent = path.dirname(p);
  return { path: p, parent: parent === p ? null : parent, folders };
}

/**
 * Replaces the folder list. Books in a removed folder lose their folder; the next scan
 * either finds them in another folder (keeping their progress) or removes them.
 */
export function saveFolders(db: Db, paths: string[], kind: FolderKind = "books"): LibraryFolder[] {
  const wanted = new Set(paths);
  db.transaction((tx) => {
    const current = tx
      .select({ id: libraryFolders.id, path: libraryFolders.path })
      .from(libraryFolders)
      .where(eq(libraryFolders.kind, kind))
      .all();
    for (const f of current) {
      if (wanted.has(f.path)) continue;
      // Music tracks lose their folder by the foreign key; the next scan removes them.
      if (kind === "books") tx.update(books).set({ libraryFolderId: null }).where(eq(books.libraryFolderId, f.id)).run();
      tx.delete(libraryFolders).where(and(eq(libraryFolders.id, f.id), eq(libraryFolders.kind, kind))).run();
    }
    const have = new Set(current.map((f) => f.path));
    for (const p of paths) {
      if (!have.has(p)) tx.insert(libraryFolders).values({ path: p, kind, createdAt: Date.now() }).run();
    }
  });
  return listFolders(db, kind);
}
