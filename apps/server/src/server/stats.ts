import {
  COUNTS_AS_LISTENED_SEC,
  daysBetween,
  emptySplit,
  type ListeningReport,
  localDay,
  longestStreak,
  periodRange,
  STATS_KIND_OF,
  STATS_KINDS,
  STATS_MIN_SEC,
  type StatsDto,
  type StatsFinished,
  type StatsPeriod,
  type StatsSplit,
  STATS_TOP_COUNT,
  type StatsTop,
  type StatsType,
  streakDays,
} from "@murmur/shared";
import { booksByIds } from "./books";
import type { AppContext } from "./context";
import { tracksByIds } from "./music/queries";

/** Days more than this far past the server's date are a wrong clock, not a time zone. */
const MAX_DAYS_AHEAD = 2;
/** The most finished books a period names. */
const MAX_FINISHED = 50;

/** Stores a device's running totals; each row keeps the larger of what it had and what came in. */
export function saveListening(ctx: AppContext, userId: number, report: ListeningReport): number {
  const latest = localDay(Date.now() + MAX_DAYS_AHEAD * 86_400_000);
  const upsert = ctx.sqlite.prepare(`
    INSERT INTO listening_days (user_id, client_id, day, item_type, item_id, listened_sec, content_sec)
    VALUES (@userId, @clientId, @day, @itemType, @itemId, @listenedSec, @contentSec)
    ON CONFLICT (user_id, client_id, day, item_type, item_id) DO UPDATE SET
      listened_sec = MAX(listened_sec, excluded.listened_sec),
      content_sec = MAX(content_sec, excluded.content_sec)`);
  let saved = 0;
  ctx.sqlite.transaction(() => {
    for (const item of report.items) {
      if (item.day > latest) continue;
      upsert.run({ userId, clientId: report.clientId, ...item });
      saved++;
    }
  })();
  return saved;
}

interface DayRow {
  day: string;
  item_type: StatsType;
  item_id: string;
  listened: number;
  content: number;
}

const rounded = (s: StatsSplit): StatsSplit => ({
  book: Math.round(s.book),
  episode: Math.round(s.episode),
  music: Math.round(s.music),
  watch: Math.round(s.watch),
});

/** What you played most of each kind in one stretch of listening. */
async function topOf(ctx: AppContext, userId: number, byItem: Map<string, number>): Promise<StatsTop[]> {
  return [...(await topBooks(ctx, userId, byItem, 1)), ...topPodcasts(ctx, byItem, 1), ...musicStats(ctx, userId, byItem, 1).top.filter((t) => t.kind !== "song"), ...watchStats(ctx, byItem, 1).top];
}

/** Books finished between two instants, latest first, with how many days each took. */
async function finishedBooks(ctx: AppContext, userId: number, fromMs: number, toMs: number, tzMinutes: number): Promise<StatsFinished[]> {
  const rows = ctx.sqlite
    .prepare(
      `SELECT item_id AS id, updated_at AS at FROM progress
       WHERE user_id = ? AND item_type = 'book' AND finished = 1 AND updated_at >= ? AND updated_at < ?
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(userId, fromMs, toMs, MAX_FINISHED) as Array<{ id: string; at: number }>;
  if (!rows.length) return [];
  const books = await booksByIds(
    ctx,
    rows.map((r) => r.id),
    userId,
  );
  const started = ctx.sqlite.prepare("SELECT MIN(day) AS day FROM listening_days WHERE user_id = ? AND item_type = 'book' AND item_id = ?");
  return rows.flatMap((r) => {
    const b = books.find((x) => x.id === r.id);
    if (!b) return [];
    const first = (started.get(userId, r.id) as { day: string | null }).day;
    const last = new Date(r.at + tzMinutes * 60_000).toISOString().slice(0, 10);
    return [{ id: b.id, title: b.title, coverHash: b.coverHash, days: first && first <= last ? daysBetween(first, last) + 1 : null }];
  });
}

export async function getStats(ctx: AppContext, userId: number, period: StatsPeriod, today: string, tzMinutes: number, year?: number): Promise<StatsDto> {
  const db = ctx.sqlite;
  const first = db.prepare("SELECT MIN(day) AS day FROM listening_days WHERE user_id = ?").get(userId) as { day: string | null };
  // An earlier year is read as if it were its last day, so it's whole and compared with the one before.
  const lastDay = period === "year" && year ? `${year}-12-31` : today;
  const range = periodRange(period, lastDay < today ? lastDay : today, first.day);
  const rows = db
    .prepare(
      `SELECT day, item_type, item_id, SUM(listened_sec) AS listened, SUM(content_sec) AS content
       FROM listening_days WHERE user_id = ? AND day BETWEEN ? AND ?
       GROUP BY day, item_type, item_id`,
    )
    .all(userId, range.from, range.to) as DayRow[];

  const split = emptySplit();
  const content = emptySplit();
  const byItem = new Map<string, number>();
  for (const r of rows) {
    const kind = STATS_KIND_OF[r.item_type];
    split[kind] += r.listened;
    content[kind] += r.content;
    const key = `${r.item_type}:${r.item_id}`;
    byItem.set(key, (byItem.get(key) ?? 0) + r.listened);
  }
  const totalSec = STATS_KINDS.reduce((sum, k) => sum + split[k], 0);
  const contentSec = STATS_KINDS.reduce((sum, k) => sum + content[k], 0);

  const bars = range.buckets.map((b) => {
    const s = emptySplit();
    for (const r of rows) if (r.day >= b.from && r.day <= b.to) s[STATS_KIND_OF[r.item_type]] += r.listened;
    const out = rounded(s);
    return { key: b.key, label: b.label, sec: STATS_KINDS.reduce((sum, k) => sum + out[k], 0), split: out };
  });

  let previousSplit: StatsSplit | null = null;
  if (range.prevFrom && range.prevTo) {
    previousSplit = emptySplit();
    const prev = db
      .prepare("SELECT item_type, SUM(listened_sec) AS sec FROM listening_days WHERE user_id = ? AND day BETWEEN ? AND ? GROUP BY item_type")
      .all(userId, range.prevFrom, range.prevTo) as Array<{ item_type: StatsType; sec: number }>;
    for (const p of prev) previousSplit[STATS_KIND_OF[p.item_type]] += p.sec;
  }

  const listenedDays = new Set(
    (
      db
        .prepare(
          `SELECT day FROM listening_days WHERE user_id = ? AND day <= ?
           GROUP BY day HAVING SUM(listened_sec) >= ? ORDER BY day DESC LIMIT 3660`,
        )
        .all(userId, today, COUNTS_AS_LISTENED_SEC) as Array<{ day: string }>
    ).map((r) => r.day),
  );

  // Progress times are real instants, so the period's days become instants in the listener's zone.
  const startMs = (day: string) => Date.parse(`${day}T00:00:00Z`) - tzMinutes * 60_000;
  const finished = db
    .prepare(
      `SELECT COUNT(*) AS n FROM progress
       WHERE user_id = ? AND item_type = 'book' AND finished = 1 AND updated_at >= ? AND updated_at < ?`,
    )
    // All time starts at the first listening day, but books finished before stats began still count.
    .get(userId, period === "all" ? 0 : startMs(range.from), startMs(range.to) + 86_400_000) as { n: number };

  const ids = (type: StatsType, atLeast: number) =>
    [...byItem].filter(([key, sec]) => key.startsWith(`${type}:`) && sec >= atLeast).map(([key]) => key.slice(type.length + 1));
  const topCount = STATS_TOP_COUNT[period];
  const music = musicStats(ctx, userId, byItem, topCount);
  const watch = watchStats(ctx, byItem, topCount);

  // Each is only sent where the page uses it, so a week doesn't carry a year of days.
  const days = new Map<string, StatsSplit>();
  if (period === "year") {
    for (const r of rows) {
      const split = days.get(r.day) ?? emptySplit();
      split[STATS_KIND_OF[r.item_type]] += r.listened;
      days.set(r.day, split);
    }
  }

  const dayTops: NonNullable<StatsDto["dayTops"]> = [];
  if (period === "week") {
    for (const b of range.buckets.filter((x) => x.from <= today)) {
      const items = new Map(rows.filter((r) => r.day === b.from).map((r) => [`${r.item_type}:${r.item_id}`, r.listened]));
      dayTops.push({ day: b.from, top: await topOf(ctx, userId, items) });
    }
  }

  const years = new Map<number, StatsSplit>();
  if (period === "all") {
    const perYear = db
      .prepare("SELECT substr(day, 1, 4) AS year, item_type, SUM(listened_sec) AS sec FROM listening_days WHERE user_id = ? AND day <= ? GROUP BY year, item_type ORDER BY year")
      .all(userId, today) as Array<{ year: string; item_type: StatsType; sec: number }>;
    for (const r of perYear) {
      const split = years.get(Number(r.year)) ?? emptySplit();
      split[STATS_KIND_OF[r.item_type]] += r.sec;
      years.set(Number(r.year), split);
    }
  }

  return {
    period,
    from: range.from,
    to: range.to,
    totalSec: Math.round(totalSec),
    previousSec: previousSplit ? Math.round(STATS_KINDS.reduce((sum, k) => sum + previousSplit![k], 0)) : null,
    bars,
    split: rounded(split),
    previousSplit: previousSplit ? rounded(previousSplit) : null,
    streakDays: streakDays(listenedDays, today),
    finishedBooks: finished.n,
    episodesPlayed: ids("episode", COUNTS_AS_LISTENED_SEC).length,
    songsPlayed: music.songsPlayed,
    albumsPlayed: music.albumsPlayed,
    showEpisodesWatched: watch.showEpisodesWatched,
    moviesWatched: watch.moviesWatched,
    savedSec: Math.max(0, Math.round(contentSec - totalSec)),
    top: [...(await topBooks(ctx, userId, byItem, topCount)), ...topPodcasts(ctx, byItem, topCount), ...music.top, ...watch.top],
    firstDay: first.day,
    longestStreak: longestStreak(listenedDays),
    finished: await finishedBooks(ctx, userId, period === "all" ? 0 : startMs(range.from), startMs(range.to) + 86_400_000, tzMinutes),
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, split]) => ({ day, split: rounded(split) })),
    dayTops,
    years: [...years].map(([y, split]) => ({ year: y, split: rounded(split) })),
  };
}

/** The items of one type, longest first. */
function longest(byItem: Map<string, number>, type: StatsType): Array<[string, number]> {
  return [...byItem]
    .filter(([key]) => key.startsWith(`${type}:`))
    .map(([key, sec]) => [key.slice(type.length + 1), sec] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

async function topBooks(ctx: AppContext, userId: number, byItem: Map<string, number>, count: number): Promise<StatsTop[]> {
  const best = longest(byItem, "book")
    .filter(([, sec]) => sec >= STATS_MIN_SEC.book)
    .slice(0, count);
  if (!best.length) return [];
  const books = await booksByIds(
    ctx,
    best.map(([id]) => id),
    userId,
  );
  return best.flatMap(([id, sec]) => {
    const b = books.find((x) => x.id === id);
    return b ? [{ kind: "book" as const, id: b.id, title: b.title, coverHash: b.coverHash, sec: Math.round(sec) }] : [];
  });
}

/** Episodes add up to their show. */
function topPodcasts(ctx: AppContext, byItem: Map<string, number>, count: number): StatsTop[] {
  const episodes = longest(byItem, "episode");
  if (!episodes.length) return [];
  const rows = ctx.sqlite
    .prepare(`SELECT id, podcast_id AS podcastId FROM episodes WHERE id IN (${episodes.map(() => "?").join(",")})`)
    .all(...episodes.map(([id]) => id)) as Array<{ id: string; podcastId: string }>;
  const shows = new Map<string, number>();
  for (const r of rows) shows.set(r.podcastId, (shows.get(r.podcastId) ?? 0) + (byItem.get(`episode:${r.id}`) ?? 0));
  const show = ctx.sqlite.prepare("SELECT id, title, cover_hash AS coverHash FROM podcasts WHERE id = ?");
  return [...shows]
    .filter(([, sec]) => sec >= STATS_MIN_SEC.podcast)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .flatMap(([id, sec]) => {
      const s = show.get(id) as { id: string; title: string; coverHash: string | null } | undefined;
      return s ? [{ kind: "podcast" as const, ...s, sec: Math.round(sec) }] : [];
    });
}

/** The albums and songs you spent longest on, songs with how many times you've played them; and songs and albums played. */
function musicStats(ctx: AppContext, userId: number, byItem: Map<string, number>, count: number): { top: StatsTop[]; songsPlayed: number; albumsPlayed: number } {
  const trackIds = longest(byItem, "track").map(([id]) => id);
  const tracks = tracksByIds(ctx, userId, trackIds);
  if (!tracks.length) return { top: [], songsPlayed: 0, albumsPlayed: 0 };
  const secOf = (id: string) => byItem.get(`track:${id}`) ?? 0;
  const played = tracks.filter((t) => secOf(t.id) >= STATS_MIN_SEC.song);
  const albums = new Map<string, number>();
  for (const t of tracks) albums.set(t.albumId, (albums.get(t.albumId) ?? 0) + secOf(t.id));
  const playedAlbums = [...albums].filter(([, sec]) => sec >= STATS_MIN_SEC.album);
  const topAlbums = playedAlbums.sort((a, b) => b[1] - a[1]).slice(0, count);
  const topSongs = [...played].sort((a, b) => secOf(b.id) - secOf(a.id)).slice(0, count);
  const plays = ctx.sqlite.prepare("SELECT count FROM track_plays WHERE user_id = ? AND track_id = ?");
  return {
    songsPlayed: played.length,
    albumsPlayed: playedAlbums.length,
    top: [
      ...topAlbums.map(([id, sec]) => {
        const album = tracks.find((t) => t.albumId === id)!;
        return { kind: "album" as const, id, title: album.album, coverHash: album.coverHash, sec: Math.round(sec) };
      }),
      ...topSongs.map((song) => {
        const played = plays.get(userId, song.id) as { count: number } | undefined;
        return { kind: "song" as const, id: song.id, title: song.title, coverHash: song.coverHash, albumId: song.albumId, plays: played?.count ?? 0, sec: Math.round(secOf(song.id)) };
      }),
    ],
  };
}

/** The TV shows and movies you watched longest, and how many episodes and movies you watched. A video's id is the movie's, or the episode's video. */
function watchStats(ctx: AppContext, byItem: Map<string, number>, count: number): { top: StatsTop[]; showEpisodesWatched: number; moviesWatched: number } {
  const videos = longest(byItem, "video");
  if (!videos.length) return { top: [], showEpisodesWatched: 0, moviesWatched: 0 };
  const secOf = (id: string) => byItem.get(`video:${id}`) ?? 0;
  const marks = videos.map(() => "?").join(",");
  const videoIds = videos.map(([id]) => id);
  const movies = ctx.sqlite
    .prepare(`SELECT id, title, poster_hash AS coverHash FROM movies WHERE id IN (${marks})`)
    .all(...videoIds) as Array<{ id: string; title: string; coverHash: string | null }>;
  const episodes = ctx.sqlite
    .prepare(`SELECT v.id, s.id AS showId, s.title, s.poster_hash AS coverHash FROM videos v JOIN shows s ON s.id = v.show_id WHERE v.id IN (${marks})`)
    .all(...videoIds) as Array<{ id: string; showId: string; title: string; coverHash: string | null }>;
  const shows = new Map<string, { title: string; coverHash: string | null; sec: number }>();
  for (const e of episodes) {
    const s = shows.get(e.showId) ?? { title: e.title, coverHash: e.coverHash, sec: 0 };
    s.sec += secOf(e.id);
    shows.set(e.showId, s);
  }
  const showTops = [...shows].map(([id, s]) => ({ kind: "tvshow" as const, id, title: s.title, coverHash: s.coverHash, sec: Math.round(s.sec) }));
  const movieTops = movies.map((m) => ({ kind: "movie" as const, ...m, sec: Math.round(secOf(m.id)) }));
  return {
    // Longest first, as for the other kinds.
    top: [...showTops, ...movieTops]
      .filter((t) => t.sec >= STATS_MIN_SEC[t.kind])
      .sort((a, b) => b.sec - a.sec)
      .slice(0, count),
    showEpisodesWatched: episodes.filter((e) => secOf(e.id) >= STATS_MIN_SEC.tvshow).length,
    moviesWatched: movies.filter((m) => secOf(m.id) >= STATS_MIN_SEC.movie).length,
  };
}
