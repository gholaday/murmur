import type { BookDetail, BookSummary, ChapterDto, MatchProvider } from "@murmur/shared";
import type { AppContext } from "./context";
import { env } from "./env";
import { coverColors } from "./library/covers";

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  series_position: number | null;
  duration_sec: number;
  cover_hash: string | null;
  added_at: number;
  missing_since: number | null;
  p_position: number | null;
  p_finished: number | null;
  p_updated: number | null;
  p_speed: number | null;
}

// Matched values (book_overrides) win over scanned ones; a null override keeps the file's value.
const SUMMARY_COLUMNS = `
  b.id, COALESCE(o.title, b.title) AS title, COALESCE(o.author, b.author) AS author,
  COALESCE(o.narrator, b.narrator) AS narrator,
  CASE WHEN o.series IS NOT NULL THEN o.series ELSE b.series END AS series,
  CASE WHEN o.series IS NOT NULL THEN o.series_position ELSE b.series_position END AS series_position,
  b.duration_sec, COALESCE(o.cover_hash, b.cover_hash) AS cover_hash, b.added_at, b.missing_since,
  p.position_sec AS p_position, p.finished AS p_finished, p.updated_at AS p_updated, p.speed AS p_speed`;

const JOINS = `
  LEFT JOIN book_overrides o ON o.book_id = b.id
  LEFT JOIN progress p ON p.user_id = ? AND p.item_type = 'book' AND p.item_id = b.id`;

function toSummary(r: BookRow, colors: Map<string, string>): BookSummary {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    narrator: r.narrator,
    series: r.series,
    seriesPosition: r.series_position,
    durationSec: r.duration_sec,
    coverHash: r.cover_hash,
    coverColor: r.cover_hash ? (colors.get(r.cover_hash) ?? null) : null,
    addedAt: r.added_at,
    missingSince: r.missing_since,
    progress:
      r.p_updated === null
        ? null
        : {
            positionSec: r.p_position ?? 0,
            finished: r.p_finished === 1,
            speed: r.p_speed ?? 1,
            updatedAt: r.p_updated,
          },
  };
}

/** One query for the whole library, newest first. */
export async function listBooks(ctx: AppContext, userId: number): Promise<BookSummary[]> {
  const rows = ctx.sqlite
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM books b ${JOINS}
       WHERE b.missing_since IS NULL OR b.missing_since > ?
       ORDER BY b.added_at DESC, b.title`,
    )
    .all(userId, Date.now() - env.missingGraceMs) as BookRow[];
  const colors = await coverColors(env.coversDir, rows.map((r) => r.cover_hash));
  return rows.map((r) => toSummary(r, colors));
}

/** Summaries for specific books, in no particular order. */
export async function booksByIds(ctx: AppContext, ids: string[], userId: number): Promise<BookSummary[]> {
  if (ids.length === 0) return [];
  const rows = ctx.sqlite
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM books b ${JOINS} WHERE b.id IN (${ids.map(() => "?").join(",")})`)
    .all(userId, ...ids) as BookRow[];
  const colors = await coverColors(env.coversDir, rows.map((r) => r.cover_hash));
  return rows.map((r) => toSummary(r, colors));
}

export async function getBook(ctx: AppContext, id: string, userId: number): Promise<BookDetail | null> {
  const row = ctx.sqlite
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, COALESCE(o.description, b.description) AS description,
         COALESCE(o.year, b.year) AS year, b.asin, o.chapters AS o_chapters,
         o.provider AS o_provider, o.provider_id AS o_provider_id, o.matched_at AS o_matched_at
       FROM books b ${JOINS} WHERE b.id = ?`,
    )
    .get(userId, id) as
    | (BookRow & {
        description: string | null;
        year: string | null;
        asin: string | null;
        o_chapters: string | null;
        o_provider: MatchProvider | null;
        o_provider_id: string | null;
        o_matched_at: number | null;
      })
    | undefined;
  if (!row) return null;
  const files = ctx.sqlite
    .prepare("SELECT idx, duration_sec, start_sec, mime_type FROM book_files WHERE book_id = ? ORDER BY idx")
    .all(id) as Array<{ idx: number; duration_sec: number; start_sec: number; mime_type: string }>;
  const colors = await coverColors(env.coversDir, [row.cover_hash]);
  return {
    ...toSummary(row, colors),
    description: row.description,
    year: row.year,
    asin: row.o_provider === "audible" ? row.o_provider_id : row.asin,
    files: files.map((f) => ({ index: f.idx, durationSec: f.duration_sec, startSec: f.start_sec, mimeType: f.mime_type })),
    chapters: row.o_chapters ? (JSON.parse(row.o_chapters) as ChapterDto[]) : scannedChapters(ctx, id),
    match:
      row.o_provider && row.o_provider_id && row.o_matched_at
        ? { provider: row.o_provider, providerId: row.o_provider_id, matchedAt: row.o_matched_at }
        : null,
  };
}

/** Chapters as read from the files, ignoring any match. */
export function scannedChapters(ctx: AppContext, bookId: string): ChapterDto[] {
  const rows = ctx.sqlite
    .prepare("SELECT idx, title, start_sec, end_sec FROM chapters WHERE book_id = ? ORDER BY idx")
    .all(bookId) as Array<{ idx: number; title: string; start_sec: number; end_sec: number }>;
  return rows.map((c) => ({ index: c.idx, title: c.title, startSec: c.start_sec, endSec: c.end_sec }));
}

export function getBookFile(ctx: AppContext, bookId: string, index: number) {
  return ctx.sqlite
    .prepare("SELECT rel_path AS relPath, mime_type AS mimeType FROM book_files WHERE book_id = ? AND idx = ?")
    .get(bookId, index) as { relPath: string; mimeType: string } | undefined;
}

/** The cover a book shows, which may come from a match. */
export function getCoverHash(ctx: AppContext, bookId: string): string | null {
  const row = ctx.sqlite
    .prepare(
      `SELECT COALESCE(o.cover_hash, b.cover_hash) AS cover_hash
       FROM books b LEFT JOIN book_overrides o ON o.book_id = b.id WHERE b.id = ?`,
    )
    .get(bookId) as { cover_hash: string | null } | undefined;
  return row?.cover_hash ?? null;
}
