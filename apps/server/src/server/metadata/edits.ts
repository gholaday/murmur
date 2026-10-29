import path from "node:path";
import type { BookEditInfo, BookEditInput, BookEditValues, ChaptersEditInput, EditableField, KnownSeries } from "@murmur/shared";
import { getBook, scannedChapters } from "../books";
import type { AppContext } from "../context";
import { env } from "../env";
import { HttpError } from "../http";
import { storeCover } from "../library/covers";
import { readCapped, safeFetch } from "../safe-fetch";

// Hand edits share book_overrides with Match: a null column means "use the files", an empty
// string clears the field. Editing never touches the provider columns, so a match stays a match.

interface ScannedRow {
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  series_position: number | null;
  year: string | null;
  description: string | null;
  cover_hash: string | null;
  folder_path: string;
  root: string | null;
}

interface OverrideRow {
  title: string | null;
  author: string | null;
  narrator: string | null;
  series: string | null;
  series_position: number | null;
  year: string | null;
  description: string | null;
  cover_hash: string | null;
  chapters: string | null;
}

function scannedRow(ctx: AppContext, bookId: string): ScannedRow {
  const row = ctx.sqlite
    .prepare(
      `SELECT b.title, b.author, b.narrator, b.series, b.series_position, b.year, b.description, b.cover_hash,
         b.folder_path, lf.path AS root
       FROM books b LEFT JOIN library_folders lf ON lf.id = b.library_folder_id WHERE b.id = ?`,
    )
    .get(bookId) as ScannedRow | undefined;
  if (!row) throw new HttpError(404, "Book not found.");
  return row;
}

function overrideRow(ctx: AppContext, bookId: string): OverrideRow | undefined {
  return ctx.sqlite.prepare("SELECT * FROM book_overrides WHERE book_id = ?").get(bookId) as OverrideRow | undefined;
}

/** Writes the given override columns, creating the row if needed. Other columns are kept. */
function writeOverride(ctx: AppContext, bookId: string, patch: Partial<OverrideRow>) {
  const cols = Object.keys(patch) as Array<keyof OverrideRow>;
  ctx.sqlite
    .prepare(
      `INSERT INTO book_overrides (book_id, ${cols.join(", ")}, edited_at)
       VALUES (@bookId, ${cols.map((c) => `@${c}`).join(", ")}, @editedAt)
       ON CONFLICT (book_id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}, edited_at = excluded.edited_at`,
    )
    .run({ bookId, ...patch, editedAt: Date.now() });
}

export async function getEditInfo(ctx: AppContext, bookId: string): Promise<BookEditInfo> {
  const book = await getBook(ctx, bookId, 0);
  if (!book) throw new HttpError(404, "Book not found.");
  const s = scannedRow(ctx, bookId);
  const o = overrideRow(ctx, bookId);
  const scanned: BookEditValues = {
    title: s.title,
    author: s.author,
    narrator: s.narrator,
    series: s.series,
    seriesPosition: s.series_position,
    year: s.year,
    description: s.description,
  };
  const edited: EditableField[] = [];
  if (o) {
    for (const f of ["title", "author", "narrator", "year", "description"] as const) {
      if (o[f] !== null && o[f] !== (scanned[f] ?? "")) edited.push(f);
    }
    if (o.series !== null && (o.series !== (scanned.series ?? "") || o.series_position !== scanned.seriesPosition)) {
      edited.push("series", "seriesPosition");
    }
  }
  const files = ctx.sqlite
    .prepare("SELECT rel_path, size, duration_sec, mime_type FROM book_files WHERE book_id = ? ORDER BY idx")
    .all(bookId) as Array<{ rel_path: string; size: number; duration_sec: number; mime_type: string }>;
  const prefix = s.folder_path ? `${s.folder_path}/` : "";
  return {
    book,
    scanned,
    edited,
    chaptersEdited: !!o?.chapters,
    scannedChapters: scannedChapters(ctx, bookId),
    coverSource: o?.cover_hash ? "custom" : s.cover_hash ? "files" : "none",
    scannedCoverHash: s.cover_hash,
    folder: s.root ? path.join(s.root, s.folder_path) : null,
    files: files.map((f) => ({
      name: f.rel_path.startsWith(prefix) ? f.rel_path.slice(prefix.length) : f.rel_path,
      size: f.size,
      durationSec: f.duration_sec,
      mimeType: f.mime_type,
    })),
    knownSeries: knownSeries(ctx),
  };
}

/** Each series as shown (edits and matches win over the files), with how many books it has. */
function knownSeries(ctx: AppContext): KnownSeries[] {
  return ctx.sqlite
    .prepare(
      `SELECT series AS name, COUNT(*) AS books FROM (
         SELECT CASE WHEN o.series IS NOT NULL THEN NULLIF(o.series, '') ELSE b.series END AS series
         FROM books b LEFT JOIN book_overrides o ON o.book_id = b.id WHERE b.missing_since IS NULL
       ) WHERE series IS NOT NULL GROUP BY series ORDER BY series COLLATE NOCASE`,
    )
    .all() as KnownSeries[];
}

/** Saves the details form. Values equal to the files' go back to "use the files". */
export function saveDetails(ctx: AppContext, bookId: string, input: BookEditInput) {
  const s = scannedRow(ctx, bookId);
  const pick = (value: string, scanned: string | null) => {
    const v = value.trim();
    return v === (scanned ?? "") ? null : v;
  };
  const title = pick(input.title, s.title);
  const series = input.series.trim();
  const position = series ? (input.seriesPosition ?? null) : null;
  const seriesSame = series === (s.series ?? "") && position === s.series_position;
  writeOverride(ctx, bookId, {
    // A title can't be blank; clearing it means "use the files".
    title: title === "" ? null : title,
    author: pick(input.author, s.author),
    narrator: pick(input.narrator, s.narrator),
    series: seriesSame ? null : series,
    series_position: seriesSame ? null : position,
    year: pick(input.year, s.year),
    description: pick(input.description, s.description),
  });
}

/** Saves hand-edited chapters, or goes back to the files' chapters when given null. */
export async function saveChapters(ctx: AppContext, bookId: string, input: ChaptersEditInput) {
  const book = await getBook(ctx, bookId, 0);
  if (!book) throw new HttpError(404, "Book not found.");
  if (!input.chapters) {
    writeOverride(ctx, bookId, { chapters: null });
    return;
  }
  const list = [...input.chapters].sort((a, b) => a.startSec - b.startSec);
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (c.startSec >= book.durationSec) throw new HttpError(400, `"${c.title}" starts after the book ends.`);
    if (i > 0 && c.startSec === list[i - 1]!.startSec) throw new HttpError(400, `Two chapters start at the same time ("${c.title}").`);
  }
  // The first chapter always starts at zero so the whole timeline is covered.
  list[0] = { ...list[0]!, startSec: 0 };
  const chapters = list.map((c, i) => ({
    index: i,
    title: c.title,
    startSec: c.startSec,
    endSec: i === list.length - 1 ? book.durationSec : list[i + 1]!.startSec,
  }));
  writeOverride(ctx, bookId, { chapters: JSON.stringify(chapters) });
}

const MAX_COVER_BYTES = 20 * 1024 * 1024;

/** Stores an uploaded or downloaded image as the book's cover. */
export async function setCover(ctx: AppContext, bookId: string, image: Buffer) {
  scannedRow(ctx, bookId);
  if (image.length > MAX_COVER_BYTES) throw new HttpError(400, "That image is over 20 MB.");
  let hash: string;
  try {
    hash = await storeCover(env.coversDir, image);
  } catch {
    throw new HttpError(400, "That file isn't an image Murmur can read. Use a JPG, PNG or WebP.");
  }
  writeOverride(ctx, bookId, { cover_hash: hash });
}

export async function setCoverFromUrl(ctx: AppContext, bookId: string, url: string) {
  let res: Response;
  try {
    res = await safeFetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": `Murmur/${env.version}` } });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Couldn't download that image.");
  }
  if (!res.ok) throw new HttpError(400, `Couldn't download that image (the site answered ${res.status}).`);
  await setCover(ctx, bookId, await readCapped(res, MAX_COVER_BYTES, "That image"));
}

/** Goes back to the cover found in the files. */
export function resetCover(ctx: AppContext, bookId: string) {
  scannedRow(ctx, bookId);
  writeOverride(ctx, bookId, { cover_hash: null });
}

/** Makes the next scan read this book's files again, then starts that scan. */
export function rescanBook(ctx: AppContext, bookId: string) {
  const info = ctx.sqlite.prepare("UPDATE books SET scan_signature = '' WHERE id = ?").run(bookId);
  if (info.changes === 0) throw new HttpError(404, "Book not found.");
  void ctx.scanner.scan();
}
