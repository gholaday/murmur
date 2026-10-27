import type { PlayType } from "./index";

// Listening stats: how long you listened, by day. Days are the listener's own calendar days
// (YYYY-MM-DD), worked out on the device, so "today" and "this week" are yours wherever the
// server is.

export type StatsPeriod = "week" | "month" | "year" | "all";
export const STATS_PERIODS: StatsPeriod[] = ["week", "month", "year", "all"];

/** Listening under this on a day doesn't count toward a streak or an episode played. */
export const COUNTS_AS_LISTENED_SEC = 60;

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

// ---------- What the server sends ----------

export interface StatsTop {
  kind: "book" | "podcast" | "album" | "song";
  /** The book, show, album or song. */
  id: string;
  title: string;
  coverHash: string | null;
  sec: number;
  /** For a song: its album, whose cover it shows and which it opens. */
  albumId?: string;
  /** For a song: how many times you've played it, ever. */
  plays?: number;
}

/** The line under a Most played row: "Most played book", or "Most played song, 12 plays". */
export function statsTopLabel(t: StatsTop): string {
  const noun = { book: "book", podcast: "show", album: "album", song: "song" }[t.kind];
  return t.plays ? `Most played ${noun}, ${t.plays === 1 ? "1 play" : `${t.plays} plays`}` : `Most played ${noun}`;
}

export interface StatsDto {
  period: StatsPeriod;
  from: string;
  to: string;
  totalSec: number;
  /** The same stretch of the period before; null for all time. */
  previousSec: number | null;
  bars: Array<{ key: string; label: string; sec: number }>;
  split: Record<"book" | "episode" | "music", number>;
  streakDays: number;
  finishedBooks: number;
  episodesPlayed: number;
  /** Time saved by listening faster than 1x. */
  savedSec: number;
  top: StatsTop[];
}

// ---------- Recording on the device ----------

export interface ListeningItem {
  day: string;
  itemType: PlayType;
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
  add(itemType: PlayType, itemId: string, wallSec: number, movedSec: number, speed: number, now = Date.now()) {
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
