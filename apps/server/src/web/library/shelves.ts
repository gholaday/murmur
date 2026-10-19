import type { BookSummary } from "@murmur/shared";

/** The rows at the top of the Books tab. Each heading opens its full list (`?shelf=`). */
export type ShelfId = "continue" | "next" | "added" | "unstarted";

export const SHELF_TITLES: Record<ShelfId, string> = {
  continue: "Continue listening",
  next: "Next in series",
  added: "Recently added",
  unstarted: "Not started",
};

/** How many books a shelf shows before "see all". */
export const SHELF_SIZE = 12;

const present = (b: BookSummary) => b.missingSince === null;
const started = (b: BookSummary) => !!b.progress && (b.progress.finished || b.progress.positionSec > 5);
const listening = (b: BookSummary) => !!b.progress && !b.progress.finished && b.progress.positionSec > 5;

/** Books you're part way through, most recently played first. */
export function continueListening(books: BookSummary[]): BookSummary[] {
  return books.filter((b) => present(b) && listening(b)).sort((a, b) => b.progress!.updatedAt - a.progress!.updatedAt);
}

/**
 * For each series you've finished a book of, the first book after the last finished one
 * that you haven't started. Series with a book in progress are left out; that book is
 * already in Continue listening. Most recently finished series first.
 */
export function nextInSeries(books: BookSummary[]): BookSummary[] {
  const bySeries = new Map<string, BookSummary[]>();
  for (const b of books) {
    if (!b.series || !present(b)) continue;
    bySeries.set(b.series, [...(bySeries.get(b.series) ?? []), b]);
  }
  const picks: Array<{ book: BookSummary; finishedAt: number }> = [];
  for (const list of bySeries.values()) {
    if (list.some(listening)) continue;
    const ordered = [...list].sort((a, b) => (a.seriesPosition ?? Infinity) - (b.seriesPosition ?? Infinity));
    const lastDone = ordered.findLastIndex((b) => b.progress?.finished);
    if (lastDone === -1) continue;
    const next = ordered.slice(lastDone + 1).find((b) => !started(b));
    if (next) picks.push({ book: next, finishedAt: ordered[lastDone]!.progress!.updatedAt });
  }
  return picks.sort((a, b) => b.finishedAt - a.finishedAt).map((p) => p.book);
}

/** Newest books on the server first. */
export function recentlyAdded(books: BookSummary[]): BookSummary[] {
  return books.filter(present).sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Books you've never played, in an order that reshuffles once a day. Seeded by the date
 * so it stays put between visits on the same day. Books already in Next in series are
 * left out so the two shelves don't repeat each other.
 */
export function notStarted(books: BookSummary[], day: string): BookSummary[] {
  const rank = (id: string) => {
    let h = 2166136261;
    for (const c of day + id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  const next = new Set(nextInSeries(books).map((b) => b.id));
  return books.filter((b) => present(b) && !started(b) && !next.has(b.id)).sort((a, b) => rank(a.id) - rank(b.id));
}

export function shelfBooks(id: ShelfId, books: BookSummary[], day: string): BookSummary[] {
  if (id === "continue") return continueListening(books);
  if (id === "next") return nextInSeries(books);
  if (id === "added") return recentlyAdded(books);
  return notStarted(books, day);
}
