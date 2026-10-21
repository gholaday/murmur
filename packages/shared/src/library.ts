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

/** A library folder path plus a folder name, with the separator the path already uses. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
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

