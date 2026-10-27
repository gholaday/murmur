import { describe, expect, it } from "vitest";
import { type ListeningStore, ListeningTracker, periodRange, streakDays } from "@murmur/shared";

describe("periodRange", () => {
  it("runs a week Monday to Sunday and compares the same days of last week", () => {
    const r = periodRange("week", "2026-10-28", null); // a Wednesday
    expect([r.from, r.to]).toEqual(["2026-10-26", "2026-11-01"]);
    expect([r.prevFrom, r.prevTo]).toEqual(["2026-10-19", "2026-10-21"]);
    expect(r.buckets.map((b) => b.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("keeps a month's comparison inside a shorter month before it", () => {
    const r = periodRange("month", "2026-03-31", null);
    expect([r.from, r.to]).toEqual(["2026-03-01", "2026-03-31"]);
    expect([r.prevFrom, r.prevTo]).toEqual(["2026-02-01", "2026-02-28"]);
    expect(r.buckets).toHaveLength(31);
  });

  it("crosses the year for January's comparison", () => {
    const r = periodRange("month", "2026-01-10", null);
    expect([r.prevFrom, r.prevTo]).toEqual(["2025-12-01", "2025-12-10"]);
  });

  it("buckets a year by month and all time by year", () => {
    expect(periodRange("year", "2026-10-26", null).buckets[11]).toMatchObject({ label: "Dec", from: "2026-12-01", to: "2026-12-31" });
    const all = periodRange("all", "2026-10-26", "2024-05-02");
    expect(all.buckets.map((b) => b.label)).toEqual(["2024", "2025", "2026"]);
    expect(all.prevFrom).toBeNull();
  });
});

describe("streakDays", () => {
  it("counts back from today, or from yesterday when today has none yet", () => {
    expect(streakDays(new Set(["2026-10-26", "2026-10-25", "2026-10-23"]), "2026-10-26")).toBe(2);
    expect(streakDays(new Set(["2026-10-25", "2026-10-24"]), "2026-10-26")).toBe(2);
    expect(streakDays(new Set(["2026-10-24"]), "2026-10-26")).toBe(0);
  });
});

describe("ListeningTracker", () => {
  const noon = new Date(2026, 9, 26, 12).getTime();
  const make = () => {
    let saved: ListeningStore | null = null;
    const t = new ListeningTracker(
      () => saved,
      (d) => (saved = structuredClone(d)),
    );
    return t;
  };

  it("counts the smaller of real time and how far playback moved", () => {
    const t = make();
    t.add("book", "b1", 2, 4, 2, noon); // 2x speed: 2s real
    t.add("book", "b1", 2, 60, 1, noon); // seek forward: only the 2s of real time
    t.add("book", "b1", 2, -30, 1, noon); // seek back: nothing
    t.add("book", "b1", 900, 900, 1, noon); // a gap too long to trust
    expect(t.pending()?.items).toEqual([{ day: "2026-10-26", itemType: "book", itemId: "b1", listenedSec: 4, contentSec: 6 }]);
  });

  it("sends running totals, and nothing once they're received", () => {
    const t = make();
    t.add("episode", "e1", 3, 3, 1, noon);
    const report = t.pending()!;
    t.sent(report, noon);
    expect(t.pending()).toBeNull();
    t.add("episode", "e1", 3, 3, 1, noon);
    expect(t.pending()?.items[0]?.listenedSec).toBe(6);
  });

  it("forgets old days once they're sent", () => {
    const t = make();
    t.add("book", "b1", 3, 3, 1, noon);
    t.sent(t.pending()!, noon);
    t.sent({ clientId: "x", items: [] }, noon + 5 * 86_400_000);
    t.add("book", "b1", 3, 3, 1, noon + 5 * 86_400_000);
    expect(t.pending()?.items.map((i) => i.day)).toEqual(["2026-10-31"]);
  });
});
