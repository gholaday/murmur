// Editing and matching a book, for admins: the pieces the web's and the app's Edit and Match both use.

import type { BookEditInfo, BookEditValues, ChapterDto, LibraryList, MatchField, MatchPreview, MatchProvider, MatchValues } from "./index";
import { seriesLabel } from "./format";

export const BOOK_PROVIDER_NAME: Record<MatchProvider, string> = { audible: "Audible", google: "Google Books", itunes: "Apple Books" };

// ---------- Details ----------

/** Edit's Details fields, as the text in their boxes. */
export interface BookEditForm {
  title: string;
  author: string;
  narrator: string;
  series: string;
  seriesPosition: string;
  year: string;
  description: string;
}

export const BOOK_FIELD_LABELS: Record<keyof BookEditForm, string> = {
  title: "Title",
  author: "Author",
  narrator: "Narrator",
  series: "Series",
  seriesPosition: "Book number",
  year: "Year",
  description: "Description",
};

export function bookFormOf(info: BookEditInfo): BookEditForm {
  const b = info.book;
  return {
    title: b.title,
    author: b.author ?? "",
    narrator: b.narrator ?? "",
    series: b.series ?? "",
    seriesPosition: b.seriesPosition === null ? "" : String(b.seriesPosition),
    year: b.year ?? "",
    description: b.description ?? "",
  };
}

/** What the files say for a field, as box text, for "From the files". */
export function scannedText(s: BookEditValues, f: keyof BookEditForm): string {
  if (f === "seriesPosition") return s.seriesPosition === null ? "" : String(s.seriesPosition);
  return s[f] ?? "";
}

// ---------- Chapters ----------

/** "1:02:03", "62:03" or "3723" to seconds; null when it can't be read. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((sum, p) => sum * 60 + Number(p), 0);
}

/** Always h:mm:ss, so a chapter list's start times line up. */
export function formatClock(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** One chapter being edited. `sec` is the exact original start, kept when the shown (rounded) time isn't changed. */
export type ChapterRow = { title: string; start: string; sec?: number };

export const chapterRowsOf = (chapters: ChapterDto[]): ChapterRow[] =>
  chapters.map((c) => ({ title: c.title, start: formatClock(c.startSec), sec: c.startSec }));
export const chapterStartOf = (r: ChapterRow) => (r.sec !== undefined && r.start === formatClock(r.sec) ? r.sec : parseClock(r.start));
export const sameChapterRow = (a: ChapterRow, b: ChapterRow) => a.title === b.title && a.start === b.start;

// ---------- Files ----------

/** 1.2 GB, 340 MB or 12 KB. */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---------- Match ----------

/** A match result's value for a field as text: what's compared, and whether there's anything to apply. */
export function bookMatchText(v: MatchValues, field: MatchField): string | null {
  switch (field) {
    case "cover":
      return v.coverUrl;
    case "series":
      return seriesLabel(v.series, v.seriesPosition);
    case "chapters":
      return v.chapterCount ? `${v.chapterCount} chapters` : null;
    default:
      return v[field];
  }
}

// Only stray spaces at the ends are ignored: a change of case or spelling is worth applying.
const norm = (s: string | null) => (s ?? "").trim();

/** The book already has exactly the result's value. Covers and chapter lists can't be told apart from here, so they never are. */
export function matchIsSame(preview: MatchPreview, field: MatchField): boolean {
  if (field === "cover" || field === "chapters") return false;
  const proposed = bookMatchText(preview.proposed, field);
  return !!proposed && norm(bookMatchText(preview.current, field)) === norm(proposed);
}

/** The result has a new value for the field, and it can be applied. */
export function matchCanApply(preview: MatchPreview, field: MatchField): boolean {
  const blocked = field === "chapters" && !!preview.chaptersNote;
  return !!bookMatchText(preview.proposed, field) && !blocked && !matchIsSame(preview, field);
}

// ---------- You > Library lists ----------

export const LIBRARY_LIST_TEXT: Record<LibraryList, { title: string; sub: string; empty: string }> = {
  attention: { title: "Needs attention", sub: "Books with no cover, no author or missing files", empty: "Nothing to fix here." },
  unmatched: { title: "Not matched", sub: "Books with no online match yet", empty: "Every book is matched." },
  albums: { title: "Not matched", sub: "Albums with no online match yet", empty: "Every album is matched." },
};

/** The kinds of folder the server reads, with what one item and many are called. */
export const FOLDER_KINDS = {
  books: { item: "book", things: "books" },
  music: { item: "album", things: "albums" },
  movies: { item: "movie", things: "movies" },
  shows: { item: "show", things: "shows" },
} as const;
export type FolderKind = keyof typeof FOLDER_KINDS;
