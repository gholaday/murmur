import { duration, plural } from "./format";
import {
  addDays,
  daysBetween,
  STATS_KIND_LABEL,
  STATS_KINDS,
  STATS_PERIOD_CHOICES,
  statsChange,
  type StatsDto,
  type StatsKind,
  type StatsSplit,
  statsSum,
  statsTopKind,
  type StatsTop,
} from "./stats";

// What the Stats page shows, the same on the web and in the app. `kinds` are always the kinds
// shown, so a hidden tab's time is left out of every sentence, line and spoke.

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Under this, All time and a year's ring say how far in you are. */
const EARLY_DAYS = 28;
/** Fewer than this in a row isn't worth a sentence. */
const STREAK_WORTH_SAYING = 3;
/** Less time than this on something isn't worth a sentence. */
const LINE_WORTH_SAYING_SEC = 600;
/** Fewer plays than this isn't on repeat. */
const REPEAT_PLAYS = 3;
/** A month's line averages each day with this many either side, so zero days don't spike. */
const MONTH_SMOOTHING = 2;
/** Today this close to a label on the line, as a share of it, takes that label's place. */
const AXIS_ROOM = 0.16;
/** The 15th, by its place in the month's days. */
const MONTH_AXIS_MIDDLE = 14;

const hoursText = (sec: number) => (sec < 3600 ? plural(Math.max(1, Math.round(sec / 60)), "minute") : plural(Math.round(sec / 3600), "hour"));

/** The kind with the most time; on a tie, the first in the usual order. */
export function statsMainKind(split: Partial<StatsSplit> | null | undefined, kinds: StatsKind[]): StatsKind | null {
  let best: StatsKind | null = null;
  let most = 0;
  for (const k of STATS_KINDS) {
    const sec = kinds.includes(k) ? (split?.[k] ?? 0) : 0;
    if (sec > most) {
      best = k;
      most = sec;
    }
  }
  return best;
}

const monthOf = (day: string) => MONTH_NAMES[Number(day.slice(5, 7)) - 1]!;

/** "38 hours this month", and the kind it was mostly, which each screen colours. */
export function statsHeadline(s: StatsDto, kinds: StatsKind[]): { text: string; mostly: string | null; kind: StatsKind | null } {
  const total = statsSum(s.split, kinds);
  const p = STATS_PERIOD_CHOICES.find((x) => x.id === s.period)!;
  // All time ends today, so a start in another year needs saying.
  const since = `since ${monthOf(s.from)}${s.from.slice(0, 4) === s.to.slice(0, 4) ? "" : ` ${s.from.slice(0, 4)}`}`;
  const when = s.period === "all" ? since : p.this.toLowerCase();
  if (!total) return { text: `Nothing played ${when}`, mostly: null, kind: null };
  const kind = kinds.length > 1 ? statsMainKind(s.split, kinds) : null;
  return { text: `${hoursText(total)} ${when}`, mostly: kind ? STATS_KIND_LABEL[kind].toLowerCase() : null, kind };
}

/** The line under a headline. */
export function statsCompared(s: StatsDto, kinds: StatsKind[]): string | null {
  const p = STATS_PERIOD_CHOICES.find((x) => x.id === s.period)!;
  return statsChange(statsSum(s.split, kinds), s.previousSplit ? statsSum(s.previousSplit, kinds) : null, p.last);
}

/** How far in you are, for your first weeks: "2 weeks in". */
function earlyDays(firstDay: string | null | undefined, today: string): string | null {
  if (!firstDay) return null;
  const days = daysBetween(firstDay, today) + 1;
  if (days >= EARLY_DAYS) return null;
  return `${days < 14 ? plural(days, "day") : plural(Math.floor(days / 7), "week")} in`;
}

/** The line in a ring's middle. `year` is set for a year that's over. */
export function statsRingNote(s: StatsDto, kinds: StatsKind[], today: string, year?: number): string | null {
  const early = year ? null : earlyDays(s.firstDay, today);
  if (early) return early;
  const before = s.previousSplit ? statsSum(s.previousSplit, kinds) : 0;
  return before ? statsChange(statsSum(s.split, kinds), before, year ? String(year - 1) : "last year") : null;
}

/** The years to pick from on All time, with their time. */
export function statsYears(s: StatsDto, kinds: StatsKind[]): Array<{ year: number; sec: number }> {
  return (s.years ?? []).map((y) => ({ year: y.year, sec: statsSum(y.split, kinds) })).filter((y) => y.sec > 0);
}

export interface StatsLine {
  text: string;
  /** What it names, for its cover and where it opens; none for a streak. */
  top: StatsTop | null;
}

const inDays = (days: number) => (days === 1 ? "in a day" : `in ${days} days`);

/** The sentences for a month, or for all time in your first year. Each is left out when it has nothing to say. */
export function statsLines(s: StatsDto, kinds: StatsKind[]): StatsLine[] {
  const lines: StatsLine[] = [];
  const all = s.period === "all";
  const shown = s.top.filter((t) => kinds.includes(statsTopKind(t)));
  const first = (kind: StatsTop["kind"]) => shown.find((t) => t.kind === kind);

  const finished = kinds.includes("book") ? (s.finished ?? []) : [];
  const timed = finished.filter((b) => b.days !== null).sort((a, b) => a.days! - b.days!);
  const asTop = (b: (typeof finished)[number]): StatsTop => ({ kind: "book", id: b.id, title: b.title, coverHash: b.coverHash, sec: 0 });
  if (finished.length === 1) {
    const b = finished[0]!;
    lines.push({ text: b.days ? `You finished ${b.title} ${inDays(b.days)}.` : `You finished ${b.title}.`, top: asTop(b) });
  } else if (finished.length > 1) {
    const fastest = timed[0];
    const count = `You finished ${finished.length} books`;
    lines.push({ text: fastest ? `${count}, the fastest was ${fastest.title} ${inDays(fastest.days!)}.` : `${count}.`, top: asTop(fastest ?? finished[0]!) });
  }

  const podcast = first("podcast");
  if (podcast && podcast.sec >= LINE_WORTH_SAYING_SEC) lines.push({ text: `${podcast.title} took ${hoursText(podcast.sec)}, your most played podcast.`, top: podcast });

  const song = first("song");
  if (song?.plays && song.plays >= REPEAT_PLAYS) {
    lines.push({ text: all ? `${song.title} is your most played song, ${plural(song.plays, "play")}.` : `${song.title} is on repeat, ${plural(song.plays, "play")}.`, top: song });
  }

  const watched = [first("tvshow"), first("movie")].filter((t) => t !== undefined).sort((a, b) => b.sec - a.sec)[0];
  if (watched && watched.sec >= LINE_WORTH_SAYING_SEC) lines.push({ text: `${watched.title} took ${hoursText(watched.sec)}, your most watched.`, top: watched });

  const best = s.longestStreak ?? 0;
  if (all && best >= STREAK_WORTH_SAYING) lines.push({ text: `Your longest streak is ${plural(best, "day")}.`, top: null });
  else if (!all && s.streakDays >= STREAK_WORTH_SAYING) {
    lines.push({ text: `You've listened ${s.streakDays} days in a row${s.streakDays >= best ? ", your longest yet" : ""}.`, top: null });
  }
  return lines;
}

/** Beside the all-time total: "Since March 2023". */
export const statsSinceLabel = (firstDay: string) => `Since ${monthOf(firstDay)} ${firstDay.slice(0, 4)}`;

/** The line under first-year All time's headline. */
export function statsSinceLine(s: StatsDto, today: string): string | null {
  if (!s.firstDay) return null;
  const early = earlyDays(s.firstDay, today);
  if (early) return early;
  const months = Math.floor(daysBetween(s.firstDay, today) / 30);
  return `You've been here ${plural(Math.max(1, months), "month")}.`;
}

export interface StatsDayRow {
  day: string;
  label: string;
  time: string;
  top: StatsTop;
}

/** Week's rows: each day so far with any listening, newest first, and what you played most on it. */
export function statsDayRows(s: StatsDto, kinds: StatsKind[], today: string): StatsDayRow[] {
  const rows: StatsDayRow[] = [];
  for (const { day, top } of [...(s.dayTops ?? [])].reverse()) {
    const best = top.filter((t) => kinds.includes(statsTopKind(t))).sort((a, b) => b.sec - a.sec)[0];
    const total = statsSum(s.bars.find((b) => b.key === day)?.split, kinds);
    if (!best || !total) continue;
    rows.push({ day, label: day === today ? "Today" : WEEKDAYS[daysBetween(s.from, day)]!, time: duration(total), top: best });
  }
  return rows;
}

// ---------- The line ----------

/** Each value averaged with `reach` values either side, as many as there are near the ends. */
export function rollingAverage(values: number[], reach: number): number[] {
  return values.map((_, i) => {
    const near = values.slice(Math.max(0, i - reach), i + reach + 1);
    return near.reduce((sum, v) => sum + v, 0) / near.length;
  });
}

/**
 * The days so far and how many the period has. A month is averaged, so its zero days don't spike;
 * a week's seven are few enough to read as they are.
 */
export function statsSpark(s: StatsDto, kinds: StatsKind[], today: string): { values: number[]; slots: number } {
  const values = s.bars.filter((b) => b.key <= today).map((b) => statsSum(b.split, kinds));
  return { values: s.period === "month" ? rollingAverage(values, MONTH_SMOOTHING) : values, slots: s.bars.length };
}

export interface StatsAxisLabel {
  text: string;
  /** Where it sits along the line, from 0 to 1. */
  at: number;
  today?: boolean;
}

/** Under a week's or month's line: its first and last day, a month's 15th, and Today under the dot, in place of any label it would crowd. */
export function statsSparkAxis(s: StatsDto, today: string): StatsAxisLabel[] {
  const last = s.bars.length - 1;
  const name = (i: number) => (s.period === "week" ? s.bars[i]!.label : `${MONTH_NAMES[Number(s.from.slice(5, 7)) - 1]!.slice(0, 3)} ${s.bars[i]!.label}`);
  const place = (i: number) => i / Math.max(1, last);
  const now = Math.min(1, daysBetween(s.from, today) / Math.max(1, last));
  const days = s.period === "month" ? [0, MONTH_AXIS_MIDDLE, last] : [0, last];
  return [...days.filter((i) => Math.abs(place(i) - now) >= AXIS_ROOM).map((i): StatsAxisLabel => ({ text: name(i), at: place(i) })), { text: "Today", at: now, today: true }].sort((a, b) => a.at - b.at);
}

/** A soft line through the values, as SVG paths, leaving room for the days to come. */
export function sparkPaths(values: number[], slots: number, width: number, height: number): { line: string; area: string; x: number; y: number } {
  const pad = 4;
  const low = Math.min(...values) * 0.6;
  const range = Math.max(...values) - low || 1;
  const pts = values.map((v, i) => [pad + (i / Math.max(1, slots - 1)) * (width - pad * 2), height - pad - ((v - low) / range) * (height - pad * 2)] as const);
  const [start, end] = [pts[0] ?? [pad, height - pad], pts[pts.length - 1] ?? [pad, height - pad]] as const;
  let line = `M${round(start[0])},${round(start[1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const mid = round((x0 + x1) / 2);
    line += ` C${mid},${round(y0)} ${mid},${round(y1)} ${round(x1)},${round(y1)}`;
  }
  return { line, area: `${line} L${round(end[0])},${height} L${round(start[0])},${height} Z`, x: round(end[0]), y: round(end[1]) };
}

const round = (n: number) => Math.round(n * 10) / 10;

// ---------- The ring ----------

export interface StatsRingDay {
  day: string;
  /** How long the spoke is, from 0 to 1. Zero is a stub, and so is every day to come. */
  value: number;
  /** The main kind of its week, so one close day doesn't flip colour. */
  kind: StatsKind | null;
}

/**
 * Every day of a year by date. Weeks count from 1 January. Spokes grow with the square root of the
 * time, so one long day doesn't flatten the rest.
 */
export function statsRing(year: number, days: StatsDto["days"], kinds: StatsKind[]): StatsRingDay[] {
  const first = `${year}-01-01`;
  const count = daysBetween(first, `${year}-12-31`) + 1;
  const byDay = new Map((days ?? []).map((d) => [d.day, d.split]));
  const weeks: Array<Partial<StatsSplit>> = [];
  const dates = Array.from({ length: count }, (_, i) => addDays(first, i));
  dates.forEach((day, i) => {
    const week = (weeks[Math.floor(i / 7)] ??= {});
    const split = byDay.get(day);
    for (const k of kinds) week[k] = (week[k] ?? 0) + (split?.[k] ?? 0);
  });
  const max = Math.max(1, ...dates.map((d) => statsSum(byDay.get(d), kinds)));
  return dates.map((day, i) => {
    const sec = statsSum(byDay.get(day), kinds);
    return { day, value: Math.sqrt(sec / max), kind: sec ? statsMainKind(weeks[Math.floor(i / 7)], kinds) : null };
  });
}

/** The ring's spokes as SVG paths: the stubs, and one path per kind. January is at the top. */
export function ringPaths(ring: StatsRingDay[], size: number): { stubs: string; spokes: Partial<Record<StatsKind, string>> } {
  const middle = size / 2;
  const inner = size * 0.27;
  const reach = size * 0.18;
  const stub = size * 0.008;
  const at = (i: number, r: number) => {
    const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
    return `${round(middle + Math.cos(a) * r)},${round(middle + Math.sin(a) * r)}`;
  };
  let stubs = "";
  const spokes: Partial<Record<StatsKind, string>> = {};
  ring.forEach((d, i) => {
    const line = `M${at(i, inner)}L${at(i, inner + (d.kind ? Math.max(stub, d.value * reach) : stub))}`;
    if (d.kind) spokes[d.kind] = (spokes[d.kind] ?? "") + line;
    else stubs += line;
  });
  return { stubs, spokes };
}

/** The ring's marker for today, as a line, or null in a year that's over. */
export function ringToday(ring: StatsRingDay[], today: string, size: number): { x1: number; y1: number; x2: number; y2: number } | null {
  const i = ring.findIndex((d) => d.day === today);
  if (i < 0) return null;
  const middle = size / 2;
  const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
  const point = (r: number) => [round(middle + Math.cos(a) * r), round(middle + Math.sin(a) * r)] as const;
  const [x1, y1] = point(size * 0.25);
  const [x2, y2] = point(size * 0.46);
  return { x1, y1, x2, y2 };
}
