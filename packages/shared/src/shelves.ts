import type { BookSummary } from "./index";
import { duration } from "./format";
import { nextInSeriesSub } from "./library";
import { ladderKeys, rankSimilar, splitPeople, type SimilarItem } from "./similar";

// The rows at the top of the Books tab, shared by the web and the app. Each heading opens
// its full list.

export type ShelfId = "continue" | "playnext" | "next" | "like" | "short" | "added" | "unstarted";

export const SHELF_IDS: ShelfId[] = ["continue", "playnext", "next", "like", "short", "added", "unstarted"];

/** Fixed titles, as Customize lists them; `shelfTitle` names the book on More like. */
export const SHELF_TITLES: Record<ShelfId, string> = {
  continue: "Continue listening",
  playnext: "Play next",
  next: "Next in series",
  like: "More like",
  short: "Short listens",
  added: "Recently added",
  unstarted: "Not started",
};

/** Short listens are under this long. */
export const SHORT_LISTEN_SEC = 5 * 3600;

/** How many books a shelf shows before its full list. */
export const SHELF_SIZE = 12;

const present = (b: BookSummary) => b.missingSince === null;
/** Past the first few seconds: anything less is opening it, not starting it. Books, episodes and videos alike. */
export const pastStart = (positionSec: number) => positionSec > 5;
/** Finished, or played past the first few seconds; a started book can't go on Play next. */
export const bookStarted = (b: BookSummary) => !!b.progress && (b.progress.finished || pastStart(b.progress.positionSec));
const started = bookStarted;
/** Part way through: started and not finished. */
export const bookListening = (b: BookSummary) => !!b.progress && !b.progress.finished && pastStart(b.progress.positionSec);
const listening = bookListening;

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
  const picks: { book: BookSummary; finishedAt: number }[] = [];
  for (const list of bySeries.values()) {
    if (list.some(listening)) continue;
    const ordered = [...list].sort((a, b) => (a.seriesPosition ?? Infinity) - (b.seriesPosition ?? Infinity));
    const lastDone = ordered.findLastIndex((b) => b.progress?.finished);
    if (lastDone === -1) continue;
    const next = ordered.slice(lastDone + 1).find((b) => !started(b));
    // A book you already put on Play next shows there instead.
    if (next && next.playNext === null) picks.push({ book: next, finishedAt: ordered[lastDone]!.progress!.updatedAt });
  }
  return picks.sort((a, b) => b.finishedAt - a.finishedAt).map((p) => p.book);
}

/**
 * The books you lined up with Add to Play next, in your order. The server takes a book off
 * once it's started; started ones are left out here too, until that change arrives.
 */
export function playNextBooks(books: BookSummary[]): BookSummary[] {
  return books.filter((b) => b.playNext !== null && present(b) && !started(b)).sort((a, b) => a.playNext! - b.playNext!);
}

/** Newest books on the server first. */
export function recentlyAdded(books: BookSummary[]): BookSummary[] {
  return books.filter(present).sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Books you've never played, in an order that reshuffles once a day. Seeded by the date
 * so it stays put between visits on the same day. Books already in Play next or Next in
 * series are left out so the shelves don't repeat each other.
 */
export function notStarted(books: BookSummary[], day: string): BookSummary[] {
  const rank = (id: string) => {
    let h = 2166136261;
    for (const c of day + id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  const next = new Set(nextInSeries(books).map((b) => b.id));
  return books.filter((b) => present(b) && !started(b) && b.playNext === null && !next.has(b.id)).sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * Unstarted books under five hours, shortest first. Books of unknown length, and ones already
 * on Play next or Next in series, are left out.
 */
export function shortListens(books: BookSummary[]): BookSummary[] {
  const next = new Set(nextInSeries(books).map((b) => b.id));
  return books
    .filter((b) => present(b) && !started(b) && b.playNext === null && !next.has(b.id) && b.durationSec > 0 && b.durationSec < SHORT_LISTEN_SEC)
    .sort((a, b) => a.durationSec - b.durationSec);
}

const similarItem = (b: BookSummary): SimilarItem & { book: BookSummary } => ({
  id: b.id,
  title: b.title,
  // A book list cached by an older app build has no genres yet.
  keys: ladderKeys(b.genres ?? []),
  authors: splitPeople(b.author),
  narrators: splitPeople(b.narrator),
  book: b,
});

/** The book More like is about: the one you finished last that has genres, or at least an author. */
export function moreLikeSource(books: BookSummary[]): BookSummary | null {
  const finished = books.filter((b) => present(b) && b.progress?.finished).sort((a, b) => b.progress!.updatedAt - a.progress!.updatedAt);
  return finished.find((b) => (b.genres ?? []).length > 0) ?? finished.find((b) => b.author) ?? null;
}

/** Unstarted books like the one you finished last, best match first. Play next books are left out. */
export function moreLike(books: BookSummary[]): BookSummary[] {
  const source = moreLikeSource(books);
  if (!source) return [];
  // Rarity is judged against the whole library, not just what's left to play.
  const ranked = rankSimilar(similarItem(source), books.filter(present).map(similarItem));
  return ranked.map((r) => r.book).filter((b) => !started(b) && b.playNext === null);
}

/** The line under a card on a shelf, when it isn't the author: which book of the series, or how long. */
export function shelfSub(id: ShelfId, b: BookSummary): string | null | undefined {
  if (id === "next") return nextInSeriesSub(b);
  if (id === "short") return duration(b.durationSec);
  return undefined;
}

/** A shelf's heading: More like names its book. */
export function shelfTitle(id: ShelfId, books: BookSummary[]): string {
  if (id !== "like") return SHELF_TITLES[id];
  const source = moreLikeSource(books);
  return source ? `More like ${source.title}` : SHELF_TITLES.like;
}

export function shelfBooks(id: ShelfId, books: BookSummary[], day: string): BookSummary[] {
  if (id === "continue") return continueListening(books);
  if (id === "playnext") return playNextBooks(books);
  if (id === "next") return nextInSeries(books);
  if (id === "like") return moreLike(books);
  if (id === "short") return shortListens(books);
  if (id === "added") return recentlyAdded(books);
  return notStarted(books, day);
}

// ---------- Books tab layout ----------

/** Everything on the Books tab that can be moved or hidden: the shelves, then All books. */
export type BookSectionId = ShelfId | "all";

export const BOOK_SECTION_IDS = [...SHELF_IDS, "all"] as const satisfies readonly BookSectionId[];

export const BOOK_SECTION_TITLES: Record<BookSectionId, string> = { ...SHELF_TITLES, all: "All books" };

export interface BookSection {
  id: BookSectionId;
  hidden: boolean;
}

/**
 * A saved Books tab layout made whole: sections that no longer exist are dropped and any
 * the layout doesn't mention yet (added in a later version) go in, shown, right after the
 * section they follow by default.
 */
export function bookSections(saved: readonly BookSection[] | null | undefined): BookSection[] {
  const known = new Set<string>(BOOK_SECTION_IDS);
  const out = (saved ?? []).filter((s, i, all) => known.has(s.id) && all.findIndex((o) => o.id === s.id) === i);
  BOOK_SECTION_IDS.forEach((id, i) => {
    if (out.some((s) => s.id === id)) return;
    const after = i === 0 ? -1 : out.findIndex((s) => s.id === BOOK_SECTION_IDS[i - 1]);
    out.splice(after + 1, 0, { id, hidden: false });
  });
  return out;
}
