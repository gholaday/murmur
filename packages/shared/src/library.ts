import type { BookSummary } from "./index";

// Library ordering shared by the web player and the Android app.

export type BookSort = "added" | "title" | "author" | "listened";

/** The sort choices, in the order the sort sheet lists them. */
export const BOOK_SORTS: { id: BookSort; label: string }[] = [
  { id: "added", label: "Recently added" },
  { id: "listened", label: "Recently listened" },
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
];
/** Device storage key for the chosen sort. */
export const LIBRARY_SORT_KEY = "murmur.librarySort";

/** How far through a book you are, 0 to 100, for its progress bar. */
export function progressPct(b: BookSummary): number {
  if (!b.progress || b.durationSec <= 0) return 0;
  return Math.min(100, (b.progress.positionSec / b.durationSec) * 100);
}

/** Under a Next in series card: which book it is (series names are too long to fit), else the author. */
export const nextInSeriesSub = (b: BookSummary) => (b.seriesPosition !== null ? `Book ${b.seriesPosition}` : b.author);

/** Problems an admin can fix from a book's Edit, listed under Needs attention. */
const BOOK_ISSUES: Array<{ label: string; test: (b: BookSummary) => boolean }> = [
  { label: "No cover", test: (b) => !b.coverHash },
  { label: "Unknown author", test: (b) => !b.author },
  { label: "Files missing", test: (b) => b.missingSince !== null },
];

/** A book's problems, as labels for under its cover; none means it's fine. */
export const bookIssues = (b: BookSummary): string[] => BOOK_ISSUES.filter((i) => i.test(b)).map((i) => i.label);

export interface ScanStatusDto {
  running: boolean;
  lastFinishedAt: number | null;
  lastError: string | null;
}

/** You > Library for admins: each kind's counts, scan and what needs a look. */
export interface LibraryAdminDto {
  books: { total: number; attention: number; unmatched: number; scan: ScanStatusDto };
  music: { albums: number; unmatched: number; scan: ScanStatusDto };
  watch: { movies: number; shows: number; scan: ScanStatusDto };
}

/** Under a kind's count in You > Library: whether it's scanning, failed, or when it last scanned. */
export function scanStatusText(scan: ScanStatusDto, now = Date.now()): string {
  if (scan.running) return "Scanning now";
  if (scan.lastError) return scan.lastError;
  if (!scan.lastFinishedAt) return "Not scanned yet";
  const mins = Math.round((now - scan.lastFinishedAt) / 60_000);
  if (mins < 1) return "Scanned just now";
  if (mins < 60) return `Scanned ${mins} ${mins === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Scanned ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `Scanned ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** Under "No books yet": why the library is empty, from the scan state in `/api/health`. */
export function emptyLibraryReason(scan: { running: boolean; lastError: string | null }): string {
  if (scan.running) return "The first scan is running. Books appear as soon as it finishes.";
  return scan.lastError ?? "Check that the library folder is mounted, then rescan from You > Library.";
}

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** "The Martian" files under M. */
export const sortTitle = (t: string) => t.replace(/^(the|a|an)\s+/i, "");

export function sortBooks(books: BookSummary[], sort: BookSort): BookSummary[] {
  const out = [...books];
  switch (sort) {
    case "title":
      return out.sort((a, b) => collator.compare(sortTitle(a.title), sortTitle(b.title)));
    case "author":
      return out.sort(
        (a, b) =>
          collator.compare(a.author ?? "~", b.author ?? "~") ||
          collator.compare(a.series ?? "", b.series ?? "") ||
          (a.seriesPosition ?? 0) - (b.seriesPosition ?? 0) ||
          collator.compare(sortTitle(a.title), sortTitle(b.title)),
      );
    case "listened":
      return out.sort((a, b) => (b.progress?.updatedAt ?? 0) - (a.progress?.updatedAt ?? 0) || b.addedAt - a.addedAt);
    default:
      return out.sort((a, b) => b.addedAt - a.addedAt);
  }
}

export function bySeriesOrder(a: BookSummary, b: BookSummary) {
  return (a.seriesPosition ?? 9999) - (b.seriesPosition ?? 9999) || collator.compare(a.title, b.title);
}

export function groupBy(books: BookSummary[], key: (b: BookSummary) => string | null) {
  const map = new Map<string, BookSummary[]>();
  for (const b of books) {
    const k = key(b);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), b]);
  }
  return [...map.entries()].sort(([a], [b]) => collator.compare(sortTitle(a), sortTitle(b)));
}

export function matchesBook(b: BookSummary, q: string) {
  return [b.title, b.author, b.narrator, b.series].some((v) => v?.toLowerCase().includes(q));
}


const searchKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Existing series to offer while a series name is typed: names that contain what's typed,
 * ignoring case, accents and punctuation, with ones where a word starts with it first. A name typed
 * exactly is left out; one that only differs in case or punctuation stays in, so the
 * library's spelling can be picked.
 */
export function suggestSeries<T extends { name: string }>(known: T[], typed: string, limit = 6): T[] {
  const q = searchKey(typed);
  if (!q) return [];
  const hits = known.filter((s) => s.name !== typed.trim() && searchKey(s.name).includes(q));
  const starts = (s: T) => (` ${searchKey(s.name)}`.includes(` ${q}`) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b)).slice(0, limit);
}
