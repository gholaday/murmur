import { describe, expect, it } from "vitest";
import {
  emptySplit,
  longestStreak,
  ringPaths,
  rollingAverage,
  type StatsDto,
  statsDayRows,
  statsHeadline,
  statsLines,
  statsMainKind,
  statsRing,
  statsRingNote,
  type StatsSplit,
  statsSpark,
  statsSparkAxis,
  STATS_TOP_COUNT,
  type StatsTop,
  statsTopItems,
  statsYears,
} from "@murmur/shared";

const ALL = ["book", "episode", "music", "watch"] as const;
const kinds = [...ALL];
const split = (s: Partial<StatsSplit>): StatsSplit => ({ ...emptySplit(), ...s });
const stats = (over: Partial<StatsDto>): StatsDto => ({
  period: "month",
  from: "2026-10-01",
  to: "2026-10-31",
  totalSec: 0,
  previousSec: 0,
  bars: [],
  split: emptySplit(),
  previousSplit: emptySplit(),
  streakDays: 0,
  finishedBooks: 0,
  episodesPlayed: 0,
  songsPlayed: 0,
  albumsPlayed: 0,
  showEpisodesWatched: 0,
  moviesWatched: 0,
  savedSec: 0,
  top: [],
  ...over,
});
const podcast: StatsTop = { kind: "podcast", id: "p", title: "Swamp247", coverHash: null, sec: 5 * 3600 };

describe("statsRing", () => {
  it("has a day for every date, leap years included", () => {
    expect(statsRing(2026, [], kinds)).toHaveLength(365);
    expect(statsRing(2028, [], kinds)).toHaveLength(366);
  });

  it("puts a day at its date, and leaves gaps as stubs", () => {
    const ring = statsRing(2026, [{ day: "2026-03-02", split: split({ book: 600 }) }], kinds);
    expect(ring[60]).toEqual({ day: "2026-03-02", value: 1, kind: "book" });
    expect(ring[61]).toEqual({ day: "2026-03-03", value: 0, kind: null });
  });

  it("colours a day by its week's main kind", () => {
    const ring = statsRing(2026, [{ day: "2026-01-01", split: split({ music: 100 }) }, { day: "2026-01-02", split: split({ book: 500 }) }], kinds);
    expect(ring[0]!.kind).toBe("book");
  });

  it("leaves a hidden kind out of the week's pick and the spokes", () => {
    const days = [{ day: "2026-01-01", split: split({ music: 100 }) }, { day: "2026-01-02", split: split({ book: 500 }) }];
    const ring = statsRing(2026, days, ["music"]);
    expect(ring[0]!.kind).toBe("music");
    expect(ring[1]).toMatchObject({ value: 0, kind: null });
  });

  it("settles a tie by the usual order", () => {
    expect(statsMainKind(split({ book: 60, music: 60 }), kinds)).toBe("book");
  });

  it("draws a path for each kind and stubs for the rest", () => {
    const { stubs, spokes } = ringPaths(statsRing(2026, [{ day: "2026-01-01", split: split({ book: 60 }) }], kinds), 358);
    expect(spokes.book).toBeTruthy();
    expect(spokes.music).toBeUndefined();
    expect(stubs.match(/M/g)).toHaveLength(364);
  });
});

describe("the line", () => {
  it("averages with what's near, at the ends too", () => {
    expect(rollingAverage([3, 0, 3], 1)).toEqual([1.5, 2, 1.5]);
  });

  it("stops at today, and smooths a month but not a week", () => {
    const bars = ["2026-10-01", "2026-10-02", "2026-10-03"].map((key, i) => ({ key, label: key, sec: 0, split: split({ book: [90, 0, 90][i]! }) }));
    expect(statsSpark(stats({ bars }), kinds, "2026-10-02")).toEqual({ values: [45, 45], slots: 3 });
    expect(statsSpark(stats({ period: "week", bars }), kinds, "2026-10-02").values).toEqual([90, 0]);
  });
});

describe("the line's axis", () => {
  const week = stats({ period: "week", from: "2026-10-26", bars: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => ({ key: `2026-10-${26 + i}`, label, sec: 0, split: emptySplit() })) });
  const month = stats({ bars: Array.from({ length: 31 }, (_, i) => ({ key: String(i), label: String(i + 1), sec: 0, split: emptySplit() })) });

  it("puts Today under the dot between the ends", () => {
    expect(statsSparkAxis(week, "2026-10-28").map((l) => [l.text, l.at])).toEqual([["Mon", 0], ["Today", 2 / 6], ["Sun", 1]]);
    expect(statsSparkAxis(month, "2026-10-08").map((l) => l.text)).toEqual(["Oct 1", "Today", "Oct 15", "Oct 31"]);
  });

  it("lets Today take the place of a label it would crowd", () => {
    expect(statsSparkAxis(week, "2026-10-26").map((l) => l.text)).toEqual(["Today", "Sun"]);
    expect(statsSparkAxis(week, "2026-11-01").map((l) => l.text)).toEqual(["Mon", "Today"]);
    expect(statsSparkAxis(month, "2026-10-03").map((l) => l.text)).toEqual(["Today", "Oct 15", "Oct 31"]);
    expect(statsSparkAxis(month, "2026-10-15").map((l) => l.text)).toEqual(["Oct 1", "Today", "Oct 31"]);
    expect(statsSparkAxis(month, "2026-10-31").map((l) => l.text)).toEqual(["Oct 1", "Oct 15", "Today"]);
  });
});

describe("the top list", () => {
  const album: StatsTop = { kind: "album", id: "a", title: "Back in Black", coverHash: null, sec: 300 };
  const other: StatsTop = { kind: "album", id: "b", title: "Rumours", coverHash: null, sec: 100 };
  const track: StatsTop = { kind: "song", id: "s", title: "Hells Bells", coverHash: null, sec: 200, albumId: "a", plays: 4 };
  const book: StatsTop = { kind: "book", id: "c", title: "Prince Caspian", coverHash: null, sec: 200 };
  const movie: StatsTop = { kind: "movie", id: "m", title: "Alien", coverHash: null, sec: 400 };

  it("leads with the top of each kind, then fills by time, without songs", () => {
    const { items } = statsTopItems(stats({ top: [book, album, other, track, movie, { ...movie, id: "n", title: "Aliens", sec: 250 }] }), null, kinds);
    expect(items.map((i) => i.top.title)).toEqual(["Prince Caspian", "Back in Black", "Alien", "Aliens", "Rumours"]);
    expect(items.map((i) => i.label)).toEqual(["Top book", "Top album", "Top movie", "Movie", "Album"]);
    expect(statsTopItems(stats({ top: [album, other] }), "music", kinds).items.map((i) => i.label)).toEqual(["Album", "Album"]);
  });

  it("keeps a kind's top however little of it you played", () => {
    const albums = Array.from({ length: STATS_TOP_COUNT.month + 3 }, (_, i) => ({ ...album, id: String(i) }));
    const { items } = statsTopItems(stats({ top: [...albums, { ...book, sec: 60 }] }), null, kinds);
    expect(items).toHaveLength(STATS_TOP_COUNT.month);
    expect(items[0]!.top.kind).toBe("book");
  });

  it("names the top song only on its own album", () => {
    const { items } = statsTopItems(stats({ top: [album, other, track] }), null, kinds);
    expect(items.map((i) => i.sub)).toEqual(["Hells Bells, 4 plays", "2m"]);
  });

  it("keeps one kind's songs, leaves out hidden kinds and stops at the limit", () => {
    expect(statsTopItems(stats({ top: [album, other, track, book] }), "music", kinds).items.map((i) => i.top.kind)).toEqual(["album", "song", "album"]);
    expect(statsTopItems(stats({ top: [movie, book] }), null, ["book"]).items.map((i) => i.top.title)).toEqual(["Prince Caspian"]);
    const many = Array.from({ length: STATS_TOP_COUNT.year + 3 }, (_, i) => ({ ...book, id: String(i) }));
    expect(statsTopItems(stats({ top: many }), null, kinds).items).toHaveLength(STATS_TOP_COUNT.month);
    expect(statsTopItems(stats({ period: "year", top: many }), null, kinds).items).toHaveLength(STATS_TOP_COUNT.year);
  });
});

describe("what the page says", () => {
  it("names the main kind only when there's a choice", () => {
    const s = stats({ split: split({ book: 38 * 3600, music: 3600 }) });
    expect(statsHeadline(s, kinds)).toMatchObject({ text: "39 hours this month", mostly: "books", kind: "book" });
    expect(statsHeadline(s, ["book"])).toMatchObject({ text: "38 hours this month", mostly: null });
  });

  it("says when nothing was played", () => {
    expect(statsHeadline(stats({}), kinds)).toMatchObject({ text: "Nothing played this month", mostly: null });
    expect(statsHeadline(stats({ period: "all", from: "2026-03-04", to: "2026-10-31" }), kinds).text).toBe("Nothing played since March");
    expect(statsHeadline(stats({ period: "all", from: "2025-03-04", to: "2026-01-05" }), kinds).text).toBe("Nothing played since March 2025");
  });

  it("has nothing to say about nothing", () => {
    expect(statsLines(stats({}), kinds)).toEqual([]);
  });

  it("names one finished book, or the fastest of several", () => {
    const one = stats({ finished: [{ id: "a", title: "Prince Caspian", coverHash: null, days: 1 }] });
    expect(statsLines(one, kinds)[0]!.text).toBe("You finished Prince Caspian in a day.");
    const old = stats({ finished: [{ id: "a", title: "Prince Caspian", coverHash: null, days: null }] });
    expect(statsLines(old, kinds)[0]!.text).toBe("You finished Prince Caspian.");
    const many = stats({
      finished: [
        { id: "a", title: "Prince Caspian", coverHash: null, days: 9 },
        { id: "b", title: "The Silver Chair", coverHash: null, days: 4 },
        { id: "c", title: "The Last Battle", coverHash: null, days: null },
      ],
    });
    expect(statsLines(many, kinds)[0]).toMatchObject({ text: "You finished 3 books, the fastest was The Silver Chair in 4 days.", top: { id: "b" } });
  });

  it("leaves a hidden kind out of the sentences", () => {
    const s = stats({ top: [podcast], finished: [{ id: "a", title: "Prince Caspian", coverHash: null, days: 4 }] });
    expect(statsLines(s, ["book"]).map((l) => l.top?.kind)).toEqual(["book"]);
    expect(statsLines(s, ["episode"])[0]!.text).toBe("Swamp247 took 5 hours, your most played podcast.");
  });

  it("only mentions a streak worth saying", () => {
    expect(statsLines(stats({ streakDays: 2, longestStreak: 9 }), kinds)).toEqual([]);
    expect(statsLines(stats({ streakDays: 3, longestStreak: 9 }), kinds)[0]!.text).toBe("You've listened 3 days in a row.");
    expect(statsLines(stats({ streakDays: 9, longestStreak: 9 }), kinds)[0]!.text).toBe("You've listened 9 days in a row, your longest yet.");
  });

  it("says how far in you are, then compares", () => {
    const s = stats({ period: "year", split: split({ book: 7200 }), previousSplit: split({ book: 3600 }) });
    expect(statsRingNote({ ...s, firstDay: "2026-10-09" }, kinds, "2026-10-22")).toBe("2 weeks in");
    expect(statsRingNote({ ...s, firstDay: "2024-01-01" }, kinds, "2026-10-22")).toBe("1h more than last year");
    expect(statsRingNote({ ...s, firstDay: "2024-01-01" }, kinds, "2026-10-22", 2025)).toBe("1h more than 2024");
    expect(statsRingNote({ ...s, firstDay: "2024-01-01", previousSplit: emptySplit() }, kinds, "2026-10-22", 2024)).toBeNull();
  });

  it("gives each day of a week its top item among the kinds shown, newest first", () => {
    const song: StatsTop = { kind: "album", id: "a", title: "Back In Black", coverHash: null, sec: 60 };
    const bars = [{ key: "2026-10-19", label: "Mon", sec: 0, split: split({ episode: 18000, music: 60 }) }, { key: "2026-10-20", label: "Tue", sec: 0, split: split({ music: 60 }) }];
    const s = stats({ period: "week", from: "2026-10-19", bars, dayTops: [{ day: "2026-10-19", top: [podcast, song] }, { day: "2026-10-20", top: [song] }] });
    expect(statsDayRows(s, kinds, "2026-10-20").map((r) => [r.label, r.time, r.top.title])).toEqual([["Today", "1m", "Back In Black"], ["Mon", "5h 1m", "Swamp247"]]);
    expect(statsDayRows(s, ["episode"], "2026-10-20").map((r) => r.label)).toEqual(["Mon"]);
  });

  it("lists years with time among the kinds shown", () => {
    const s = stats({ years: [{ year: 2025, split: split({ music: 60 }) }, { year: 2026, split: split({ book: 60 }) }] });
    expect(statsYears(s, ["book"])).toEqual([{ year: 2026, sec: 60 }]);
  });

  it("finds the longest run of days", () => {
    expect(longestStreak(new Set(["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"]))).toBe(3);
    expect(longestStreak(new Set())).toBe(0);
  });
});
