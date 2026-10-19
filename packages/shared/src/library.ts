import type { BookSummary } from "./index";

// Library ordering shared by the web player and the Android app.

export type BookSort = "added" | "title" | "author" | "listened";

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

