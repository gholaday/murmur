import type { BookSummary } from "@murmur/shared/client";
import { expect, it } from "vitest";
import { nextInSeries, notStarted } from "./shelves";

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
