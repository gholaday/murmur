// The Books tab's shelf rules and layout, shared by the web and the app (packages/shared).
import {
  BOOK_SECTION_IDS,
  type BookSummary,
  bookSections,
  collectionOrder,
  nextInCollection,
  moreLike,
  moreLikeSource,
  nextInSeries,
  notStarted,
  shelfTitle,
  shortListens,
} from "@murmur/shared/client";
import { expect, it } from "vitest";

let n = 0;
function book(series: string | null, position: number | null, progress?: { finished?: boolean; at?: number; pos?: number }): BookSummary {
  n++;
  return {
    id: `b${n}`,
    title: `${series ?? "Standalone"} ${position ?? ""}`,
    author: null,
    narrator: null,
    series,
    seriesPosition: position,
    durationSec: 3600,
    coverHash: null,
    coverColor: null,
    addedAt: 0,
    missingSince: null,
    matched: false,
    markedMatched: false,
    playNext: null,
    genres: [],
    progress: progress
      ? { finished: !!progress.finished, positionSec: progress.pos ?? (progress.finished ? 3600 : 0), speed: 1, updatedAt: progress.at ?? 0 }
      : null,
  };
}

it("picks the first unstarted book after the last finished one in each series", () => {
  const a2 = book("A", 2);
  const b3 = book("B", 3);
  const books = [
    book("A", 1, { finished: true, at: 10 }),
    a2,
    book("A", 3),
    book("B", 1, { finished: true, at: 5 }),
    book("B", 2, { finished: true, at: 20 }),
    b3,
    // Never started: no pick.
    book("C", 1),
    // A book in progress is already in Continue listening.
    book("D", 1, { finished: true, at: 30 }),
    book("D", 2, { pos: 600, at: 31 }),
    book("D", 3),
    // Finished everything: nothing next.
    book("E", 1, { finished: true, at: 40 }),
  ];
  // Most recently finished series first.
  expect(nextInSeries(books).map((b) => b.id)).toEqual([b3.id, a2.id]);
});

it("skips books you've already started further along", () => {
  const a4 = book("A", 4);
  const books = [book("A", 1, { finished: true, at: 1 }), book("A", 2, { finished: true, at: 2 }), book("A", 3, { pos: 2 }), a4];
  // A barely touched book (5s or less) counts as not started.
  expect(nextInSeries(books)[0]?.title).toBe("A 3");
  expect(nextInSeries([...books.slice(0, 2), a4])[0]).toBe(a4);
});

it("shuffles not-started books the same way all day and differently the next day", () => {
  const books = Array.from({ length: 20 }, () => book(null, null));
  const today = notStarted(books, "2026-10-19").map((b) => b.id);
  expect(notStarted(books, "2026-10-19").map((b) => b.id)).toEqual(today);
  expect(notStarted(books, "2026-10-20").map((b) => b.id)).not.toEqual(today);
  expect(notStarted([...books, book(null, null, { finished: true })], "2026-10-19")).toHaveLength(20);
});

it("leaves Next in series books out of Not started", () => {
  const next = book("F", 2);
  const books = [book("F", 1, { finished: true }), next, book("F", 3)];
  expect(notStarted(books, "2026-10-19").map((b) => b.id)).not.toContain(next.id);
  expect(notStarted(books, "2026-10-19")).toHaveLength(1);
});

it("leaves Play next books out of Next in series and Not started", () => {
  const next = { ...book("G", 2), playNext: 0 };
  const books = [book("G", 1, { finished: true }), next, book("G", 3)];
  expect(nextInSeries(books)).toEqual([]);
  expect(notStarted(books, "2026-10-19").map((b) => b.id)).not.toContain(next.id);
});

it("fills in a missing layout with every section shown, in the default order", () => {
  expect(bookSections(undefined)).toEqual(BOOK_SECTION_IDS.map((id) => ({ id, hidden: false })));
});

it("keeps the saved order and drops unknown and repeated sections", () => {
  const saved = [
    { id: "all", hidden: true },
    { id: "gone", hidden: false },
    { id: "continue", hidden: false },
    { id: "playnext", hidden: false },
    { id: "added", hidden: false },
    { id: "next", hidden: true },
    { id: "unstarted", hidden: false },
    { id: "all", hidden: false },
  ] as Parameters<typeof bookSections>[0];
  expect(bookSections(saved).map((s) => s.id)).toEqual(["all", "continue", "playnext", "added", "next", "like", "short", "unstarted"]);
});

it("adds a section new since the layout was saved right after the one it follows", () => {
  const saved = [
    { id: "added", hidden: false },
    { id: "continue", hidden: true },
    { id: "next", hidden: false },
    { id: "unstarted", hidden: false },
    { id: "all", hidden: false },
  ] as Parameters<typeof bookSections>[0];
  expect(bookSections(saved)).toEqual([
    { id: "added", hidden: false },
    { id: "continue", hidden: true },
    { id: "playnext", hidden: false },
    { id: "next", hidden: false },
    { id: "like", hidden: false },
    { id: "short", hidden: false },
    { id: "unstarted", hidden: false },
    { id: "all", hidden: false },
  ]);
});

it("lists unstarted books under five hours, shortest first, without unknown lengths or queued books", () => {
  const long = { ...book(null, null), durationSec: 6 * 3600 };
  const short = { ...book(null, null), durationSec: 2 * 3600 };
  const shorter = { ...book(null, null), durationSec: 3600 };
  const unknown = { ...book(null, null), durationSec: 0 };
  const queued = { ...book(null, null), durationSec: 600, playNext: 0 };
  const started = { ...book(null, null, { pos: 60 }), durationSec: 600 };
  expect(shortListens([long, short, shorter, unknown, queued, started]).map((b) => b.id)).toEqual([shorter.id, short.id]);
});

it("ranks More like on the last finished book with genres, deeper matches first", () => {
  const sf = (id: string, genres: string[], extra: Partial<BookSummary> = {}) => ({ ...book(null, null), id, title: id, genres, ...extra });
  const done = sf("Perelandra", ["Science Fiction & Fantasy > Science Fiction > Adventure", "Literature & Fiction > Classics"], {
    author: "C.S. Lewis",
    progress: { finished: true, positionSec: 3600, speed: 1, updatedAt: 10 },
  });
  // Finished later but nothing to rank on: skipped as the source.
  const later = { ...book(null, null, { finished: true, at: 20 }), title: "Untagged" };
  const deep = sf("Hail Mary", ["Science Fiction & Fantasy > Science Fiction > Adventure"]);
  const shallow = sf("Dune", ["Science Fiction & Fantasy > Science Fiction > Space Opera"]);
  const classic = sf("Monte Cristo", ["Literature & Fiction > Classics"]);
  const rootOnly = sf("Romance", ["Literature & Fiction > Romance"]);
  const byAuthor = sf("Screwtape", [], { author: "C.S. Lewis, Someone Else" });
  const books = [done, later, deep, shallow, classic, rootOnly, byAuthor];
  expect(moreLikeSource(books)?.id).toBe("Perelandra");
  expect(shelfTitle("like", books)).toBe("More like Perelandra");
  // Hail Mary shares the whole three-level ladder. Monte Cristo beats Dune because Classics is rarer here
  // than Science Fiction; Screwtape only shares the author.
  expect(moreLike(books).map((b) => b.id)).toEqual(["Hail Mary", "Monte Cristo", "Dune", "Screwtape"]);
});

it("leaves More like empty when nothing has been finished", () => {
  expect(moreLike([book(null, null)])).toEqual([]);
  expect(shelfTitle("like", [])).toBe("More like");
});

it("picks the next unstarted film in each collection, in release order", () => {
  const film = (id: string, collectionId: number, released: string | null, p?: { finished?: boolean; pos?: number; at?: number }) => ({
    id,
    title: id,
    collectionId,
    released,
    progress: p ? { finished: !!p.finished, positionSec: p.pos ?? 0, updatedAt: p.at ?? 0 } : null,
  });
  const movies = [
    film("Empire", 1, "1980-05-21"),
    film("New Hope", 1, "1977-05-25", { finished: true, at: 5 }),
    film("Jedi", 1, "1983-05-25"),
    // Same year: the earlier date goes first; no date goes last.
    film("Toy Story 2", 2, "1999-11-24"),
    film("Toy Story", 2, "1995-11-22", { finished: true, at: 9 }),
    film("Toy Story 3", 2, null),
    // A film in progress keeps its collection off the shelf.
    film("Dune", 3, "2021-09-15", { finished: true, at: 20 }),
    film("Dune Two", 3, "2024-02-27", { pos: 600 }),
  ];
  expect(nextInCollection(movies).map((m) => m.id)).toEqual(["Toy Story 2", "Empire"]);
  expect(collectionOrder(movies.filter((m) => m.collectionId === 2)).map((m) => m.id)).toEqual(["Toy Story", "Toy Story 2", "Toy Story 3"]);
});
