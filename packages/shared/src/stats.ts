import { apiPaths } from "./api-paths";
import { duration, plural } from "./format";
import type { StatsType } from "./index";

// Listening stats: how long you listened, by day. Days are the listener's own calendar days
// (YYYY-MM-DD), worked out on the device, so "today" and "this week" are yours wherever the
// server is.

export type StatsPeriod = "week" | "month" | "year" | "all";
export const STATS_PERIODS: StatsPeriod[] = ["week", "month", "year", "all"];

/** Listening under this on a day doesn't count toward a streak, or an episode played or watched. */
export const COUNTS_AS_LISTENED_SEC = 60;
/** A song counts as played after this much of it. */
export const COUNTS_AS_SONG_SEC = 30;
/** How many things a period's top list shows. */
export const STATS_TOP_COUNT: Record<StatsPeriod, number> = { week: 10, month: 15, year: 25, all: 25 };

/** The four kinds the stats split time into: books, podcasts ("episode"), music and Watch. */
export type StatsKind = "book" | "episode" | "music" | "watch";
export const STATS_KINDS: StatsKind[] = ["book", "episode", "music", "watch"];
export type StatsSplit = Record<StatsKind, number>;
export const emptySplit = (): StatsSplit => ({ book: 0, episode: 0, music: 0, watch: 0 });
/** Which kind a listening row's item type adds to. */
export const STATS_KIND_OF: Record<StatsType, StatsKind> = { book: "book", episode: "episode", track: "music", video: "watch" };

// ---------- Days ----------

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The device's calendar day at `ms`. */
export function localDay(ms = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const toUtc = (day: string) => {
  const [y, m, d] = parts(day);
  return Date.UTC(y, m - 1, d);
};

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * 86_400_000);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** The earlier of two days. */
const minDay = (a: string, b: string) => (a < b ? a : b);

function monthEnd(year: number, month: number): string {
  return fromUtc(Date.UTC(year, month, 0));
}

// ---------- Periods ----------

export interface StatsBucket {
  key: string;
  label: string;
  from: string;
  to: string;
}

export interface PeriodRange {
  from: string;
  to: string;
  /** The same stretch of the period before, up to the same point, or null for all time. */
  prevFrom: string | null;
  prevTo: string | null;
  buckets: StatsBucket[];
}

/**
 * The calendar week (Monday first), month or year that `today` is in, with one bar per day
 * (per month for a year, per year for all time). The comparison covers the same number of
 * days at the start of the period before, so Wednesday is compared with last Monday to Wednesday.
 */
export function periodRange(period: StatsPeriod, today: string, firstDay: string | null): PeriodRange {
  const [y, m] = parts(today);
  if (period === "week") {
    const weekday = (new Date(toUtc(today)).getUTCDay() + 6) % 7;
    const from = addDays(today, -weekday);
    const prevFrom = addDays(from, -7);
    return {
      from,
      to: addDays(from, 6),
      prevFrom,
      prevTo: addDays(prevFrom, weekday),
      buckets: WEEKDAYS.map((label, i) => ({ key: addDays(from, i), label, from: addDays(from, i), to: addDays(from, i) })),
    };
  }
  if (period === "month") {
    const from = `${y}-${pad(m)}-01`;
    const to = monthEnd(y, m);
    const prevFrom = m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
    const [py, pm] = parts(prevFrom);
    const days = daysBetween(from, to) + 1;
    return {
      from,
      to,
      prevFrom,
      prevTo: minDay(addDays(prevFrom, daysBetween(from, today)), monthEnd(py, pm)),
      buckets: Array.from({ length: days }, (_, i) => {
        const day = addDays(from, i);
        return { key: day, label: String(i + 1), from: day, to: day };
      }),
    };
  }
  if (period === "year") {
    const from = `${y}-01-01`;
    const prevFrom = `${y - 1}-01-01`;
    return {
      from,
      to: `${y}-12-31`,
      prevFrom,
      prevTo: minDay(addDays(prevFrom, daysBetween(from, today)), `${y - 1}-12-31`),
      buckets: MONTHS.map((label, i) => ({
        key: `${y}-${pad(i + 1)}`,
        label,
        from: `${y}-${pad(i + 1)}-01`,
        to: monthEnd(y, i + 1),
      })),
    };
  }
  const from = firstDay && firstDay < today ? firstDay : today;
  const [fy] = parts(from);
  return {
    from,
    to: today,
    prevFrom: null,
    prevTo: null,
    buckets: Array.from({ length: y - fy + 1 }, (_, i) => ({
      key: String(fy + i),
      label: String(fy + i),
      from: `${fy + i}-01-01`,
      to: `${fy + i}-12-31`,
    })),
  };
}

/** Days in a row with some listening, counting back from today (or yesterday, if today has none yet). */
export function streakDays(listenedDays: ReadonlySet<string>, today: string): number {
  let day = listenedDays.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (listenedDays.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/** The most days in a row with some listening. */
export function longestStreak(listenedDays: ReadonlySet<string>): number {
  let best = 0;
  for (const day of listenedDays) {
    if (listenedDays.has(addDays(day, -1))) continue;
    let n = 1;
    while (listenedDays.has(addDays(day, n))) n++;
    best = Math.max(best, n);
  }
  return best;
}

// ---------- What the server sends ----------

export interface StatsTop {
  kind: "book" | "podcast" | "album" | "song" | "movie" | "tvshow";
  /** The book, show, album, song, movie or TV show. */
  id: string;
  title: string;
  /** For a movie or TV show, its poster's hash. */
  coverHash: string | null;
  sec: number;
  /** For a song: its album, whose cover it shows and which it opens. */
  albumId?: string;
  /** For a song: how many times you've played it, ever. */
  plays?: number;
}

/** A book finished in the period. */
export interface StatsFinished {
  id: string;
  title: string;
  coverHash: string | null;
  /** First listen to last, counting both, or null if it was started before stats began. */
  days: number | null;
}

/** Which kind of time a top item belongs to. */
export const statsTopKind = (t: StatsTop): StatsKind =>
  t.kind === "book" ? "book" : t.kind === "podcast" ? "episode" : t.kind === "album" || t.kind === "song" ? "music" : "watch";

export interface StatsDto {
  period: StatsPeriod;
  from: string;
  to: string;
  totalSec: number;
  /** The same stretch of the period before; null for all time. */
  previousSec: number | null;
  /** Each bar's time, and how it splits by kind, so a chart can stack them or show one kind. */
  bars: Array<{ key: string; label: string; sec: number; split: StatsSplit }>;
  split: StatsSplit;
  /** The period before, by kind; null for all time. */
  previousSplit: StatsSplit | null;
  streakDays: number;
  finishedBooks: number;
  /** Podcast episodes played for at least a minute. */
  episodesPlayed: number;
  /** Songs played for at least 30 seconds, and the albums they're on. */
  songsPlayed: number;
  albumsPlayed: number;
  /** TV episodes and movies watched for at least a minute. */
  showEpisodesWatched: number;
  moviesWatched: number;
  /** Time saved by listening faster than 1x. No longer shown; kept for older apps. */
  savedSec: number;
  /** What you spent longest on: up to the period's `STATS_TOP_COUNT` books, podcasts, albums, songs and videos, each kind longest first. */
  top: StatsTop[];
  /** Your first listening day ever. */
  firstDay?: string | null;
  longestStreak?: number;
  /** Books finished in the period, latest first. */
  finished?: StatsFinished[];
  /** A year only: each day with any listening, for the ring. */
  days?: Array<{ day: string; split: StatsSplit }>;
  /** A week only: what you played most on each day so far, per kind. */
  dayTops?: Array<{ day: string; top: StatsTop[] }>;
  /** All time only: each year's time, earliest first. */
  years?: Array<{ year: number; split: StatsSplit }>;
}

// ---------- What the stats say, the same on the web and in the app ----------

export const STATS_PERIOD_CHOICES: Array<{ id: StatsPeriod; label: string; last: string; this: string }> = [
  { id: "week", label: "Week", last: "last week", this: "This week" },
  { id: "month", label: "Month", last: "last month", this: "This month" },
  { id: "year", label: "Year", last: "last year", this: "This year" },
  { id: "all", label: "All time", last: "", this: "All time" },
];

export const STATS_KIND_LABEL: Record<StatsKind, string> = { book: "Books", episode: "Podcasts", music: "Music", watch: "Watch" };

export const STATS_TOP_LABEL: Record<StatsTop["kind"], string> = { book: "Book", podcast: "Podcast", album: "Album", song: "Song", movie: "Movie", tvshow: "Show" };

/** The time of these kinds; a kind the server leaves out counts as nothing, not NaN. */
export const statsSum = (split: Partial<StatsSplit> | null | undefined, kinds: StatsKind[]): number => kinds.reduce((s, k) => s + (split?.[k] ?? 0), 0);

/** The total compared with the same stretch of the period before. */
export function statsChange(now: number, before: number | null, last: string): string | null {
  if (before === null || now + before === 0) return null;
  const diff = now - before;
  if (Math.abs(diff) < 60) return `About the same as ${last}`;
  return `${duration(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${last}`;
}

/** The kinds the stats show: a hidden tab leaves its kind out, the total included. */
export function statsKindsShown(tabs: { podcasts: boolean; music?: boolean; watch?: boolean }): StatsKind[] {
  return ["book", ...(tabs.podcasts ? (["episode"] as const) : []), ...(tabs.music ? (["music"] as const) : []), ...(tabs.watch ? (["watch"] as const) : [])];
}

/** The small heading over the total: "This week", or "Music this week" with one kind picked. */
export const statsTotalLabel = (picked: StatsKind | null, period: StatsPeriod): string => {
  const p = STATS_PERIOD_CHOICES.find((x) => x.id === period)!;
  return picked ? `${STATS_KIND_LABEL[picked]} ${p.this.toLowerCase()}` : p.this;
};

/**
 * All kinds: the top of each kind, labelled as such, then the rest longest first, leaving songs out
 * as the top song's album card names it. One kind: its own longest first, songs included.
 */
export function statsTopItems(s: StatsDto, picked: StatsKind | null, kinds: StatsKind[], year?: number): { title: string; items: Array<{ top: StatsTop; label: string; sub: string }> } {
  const mine = s.top.filter((t) => kinds.includes(statsTopKind(t)));
  const song = mine.find((t) => t.kind === "song");
  const ranked = mine.filter((t) => (picked ? statsTopKind(t) === picked : t.kind !== "song")).sort((a, b) => b.sec - a.sec);
  const leads = picked ? [] : kinds.flatMap((k) => ranked.find((t) => statsTopKind(t) === k) ?? []);
  const items = [...leads, ...ranked.filter((t) => !leads.includes(t))].slice(0, STATS_TOP_COUNT[s.period]);
  const sub = (t: StatsTop) => {
    if (t.kind === "song") return t.plays ? plural(t.plays, "play") : duration(t.sec);
    if (t.kind === "album" && !picked && song?.albumId === t.id) return song.plays ? `${song.title}, ${plural(song.plays, "play")}` : song.title;
    return duration(t.sec);
  };
  const p = STATS_PERIOD_CHOICES.find((x) => x.id === s.period)!;
  const what = picked === "watch" ? "Most watched" : picked ? "Most played" : "Top";
  const when = year ? `of ${year}` : s.period === "all" ? "of all time" : p.this.toLowerCase();
  const label = (t: StatsTop) => (leads.includes(t) ? `Top ${STATS_TOP_LABEL[t.kind].toLowerCase()}` : STATS_TOP_LABEL[t.kind]);
  return { title: `${what} ${when}`, items: items.map((top) => ({ top, label: label(top), sub: sub(top) })) };
}

/** What a top item opens: a song opens its album. */
export function statsTopTarget(t: StatsTop): { kind: Exclude<StatsTop["kind"], "song">; id: string } {
  return t.kind === "song" ? { kind: "album", id: t.albumId ?? t.id } : { kind: t.kind, id: t.id };
}

/** A top item's cover: a song shows its album's, a movie or show its poster. */
export function statsTopCover(t: StatsTop): string | null {
  if (!t.coverHash) return null;
  const { kind, id } = statsTopTarget(t);
  if (kind === "book") return apiPaths.coverUrl(id, t.coverHash, 600);
  if (kind === "podcast") return apiPaths.podcastCoverUrl(id, t.coverHash, 600);
  if (kind === "movie") return apiPaths.movieArtUrl(id, "poster", t.coverHash, "small");
  if (kind === "tvshow") return apiPaths.showArtUrl(id, "poster", t.coverHash, "small");
  return apiPaths.albumCoverUrl(id, t.coverHash, 600);
}

// ---------- Recording on the device ----------

export interface ListeningItem {
  day: string;
  itemType: StatsType;
  itemId: string;
  /** Real time spent listening. */
  listenedSec: number;
  /** How much of the recording that covered: listened time times speed. */
  contentSec: number;
}

export interface ListeningReport {
  clientId: string;
  items: ListeningItem[];
}

export interface ListeningStore {
  clientId: string;
  totals: Record<string, ListeningItem & { sent: number }>;
}

/**
 * A longer gap between ticks isn't counted. Android spaces out updates with the screen off,
 * so this is generous; the position check in `add` is what stops a stalled player counting.
 */
const MAX_TICK_SEC = 600;
/** Days kept on the device after they're sent, in case listening crosses midnight late. */
const KEEP_DAYS = 3;

/**
 * Adds up listening on this device per day and item. The server keeps each device's running
 * totals and takes the larger, so sending the same totals twice never counts anything twice.
 */
export class ListeningTracker {
  private data: ListeningStore;

  constructor(
    load: () => ListeningStore | null,
    private readonly store: (data: ListeningStore) => void,
  ) {
    this.data = load() ?? {
      clientId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`,
      totals: {},
    };
  }

  /**
   * Call on each tick while playing, with the real seconds since the last tick and how far the
   * position moved. The smaller of the two counts, so a seek forward doesn't add the skipped part
   * and a paused or frozen player adds nothing.
   */
  add(itemType: StatsType, itemId: string, wallSec: number, movedSec: number, speed: number, now = Date.now()) {
    const seconds = Math.min(wallSec, movedSec / speed);
    if (!(seconds > 0) || seconds > MAX_TICK_SEC) return;
    const day = localDay(now);
    const key = `${day}|${itemType}|${itemId}`;
    const t = (this.data.totals[key] ??= { day, itemType, itemId, listenedSec: 0, contentSec: 0, sent: 0 });
    t.listenedSec += seconds;
    t.contentSec += seconds * speed;
  }

  /** Writes the totals to storage; call when progress is saved. */
  persist() {
    this.store(this.data);
  }

  /** Forgets everything, on sign-out, so one account's minutes aren't sent as another's. */
  clear() {
    this.data = { clientId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`, totals: {} };
    this.persist();
  }

  /** The totals that changed since they were last sent, or null if none did. */
  pending(): ListeningReport | null {
    const items = Object.values(this.data.totals)
      .filter((t) => t.listenedSec - t.sent >= 1)
      .map(({ sent: _sent, ...t }) => ({ ...t, listenedSec: Math.round(t.listenedSec), contentSec: Math.round(t.contentSec) }));
    return items.length ? { clientId: this.data.clientId, items } : null;
  }

  /** Marks a report as received, and forgets days old enough not to change again. */
  sent(report: ListeningReport, now = Date.now()) {
    for (const i of report.items) {
      const t = this.data.totals[`${i.day}|${i.itemType}|${i.itemId}`];
      if (t) t.sent = Math.max(t.sent, i.listenedSec);
    }
    const oldest = addDays(localDay(now), -KEEP_DAYS);
    for (const [key, t] of Object.entries(this.data.totals)) {
      if (t.day < oldest && t.listenedSec - t.sent < 1) delete this.data.totals[key];
    }
    this.persist();
  }
}
