import {
  COUNTS_AS_LISTENED_SEC,
  COUNTS_AS_SONG_SEC,
  emptySplit,
  type ListeningReport,
  localDay,
  periodRange,
  STATS_KIND_OF,
  STATS_KINDS,
  type StatsDto,
  type StatsPeriod,
  type StatsSplit,
  type StatsTop,
  type StatsType,
  streakDays,
} from "@murmur/shared";
import { booksByIds } from "./books";
import type { AppContext } from "./context";
import { tracksByIds } from "./music/queries";

/** Days more than this far past the server's date are a wrong clock, not a time zone. */
const MAX_DAYS_AHEAD = 2;

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

export async function getStats(ctx: AppContext, userId: number, period: StatsPeriod, today: string, tzMinutes: number): Promise<StatsDto> {
  const db = ctx.sqlite;
  const first = db.prepare("SELECT MIN(day) AS day FROM listening_days WHERE user_id = ?").get(userId) as { day: string | null };
  const range = periodRange(period, today, first.day);
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
  const music = musicStats(ctx, userId, byItem);
  const watch = watchStats(ctx, byItem);

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
    top: [...(await topBooks(ctx, userId, byItem)), ...topPodcasts(ctx, byItem), ...music.top, ...watch.top],
  };
}

/** The items of one type, longest first. */
function longest(byItem: Map<string, number>, type: StatsType): Array<[string, number]> {
  return [...byItem]
    .filter(([key]) => key.startsWith(`${type}:`))
    .map(([key, sec]) => [key.slice(type.length + 1), sec] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

const TOP_PER_KIND = 2;

async function topBooks(ctx: AppContext, userId: number, byItem: Map<string, number>): Promise<StatsTop[]> {
  const best = longest(byItem, "book").slice(0, TOP_PER_KIND);
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
function topPodcasts(ctx: AppContext, byItem: Map<string, number>): StatsTop[] {
  const episodes = longest(byItem, "episode");
  if (!episodes.length) return [];
  const rows = ctx.sqlite
    .prepare(`SELECT id, podcast_id AS podcastId FROM episodes WHERE id IN (${episodes.map(() => "?").join(",")})`)
    .all(...episodes.map(([id]) => id)) as Array<{ id: string; podcastId: string }>;
  const shows = new Map<string, number>();
  for (const r of rows) shows.set(r.podcastId, (shows.get(r.podcastId) ?? 0) + (byItem.get(`episode:${r.id}`) ?? 0));
  const show = ctx.sqlite.prepare("SELECT id, title, cover_hash AS coverHash FROM podcasts WHERE id = ?");
  return [...shows]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_PER_KIND)
    .flatMap(([id, sec]) => {
      const s = show.get(id) as { id: string; title: string; coverHash: string | null } | undefined;
      return s ? [{ kind: "podcast" as const, ...s, sec: Math.round(sec) }] : [];
    });
}

/** The album you spent longest on and the top song, with how many times you've played it; and songs and albums played. */
function musicStats(ctx: AppContext, userId: number, byItem: Map<string, number>): { top: StatsTop[]; songsPlayed: number; albumsPlayed: number } {
  const trackIds = longest(byItem, "track").map(([id]) => id);
  const tracks = tracksByIds(ctx, userId, trackIds);
  if (!tracks.length) return { top: [], songsPlayed: 0, albumsPlayed: 0 };
  const secOf = (id: string) => byItem.get(`track:${id}`) ?? 0;
  const played = tracks.filter((t) => secOf(t.id) >= COUNTS_AS_SONG_SEC);
  const albums = new Map<string, number>();
  for (const t of tracks) albums.set(t.albumId, (albums.get(t.albumId) ?? 0) + secOf(t.id));
  const [albumId, albumSec] = [...albums].sort((a, b) => b[1] - a[1])[0]!;
  const album = tracks.find((t) => t.albumId === albumId)!;
  const song = [...tracks].sort((a, b) => secOf(b.id) - secOf(a.id))[0]!;
  const plays = ctx.sqlite.prepare("SELECT count FROM track_plays WHERE user_id = ? AND track_id = ?").get(userId, song.id) as
    | { count: number }
    | undefined;
  return {
    songsPlayed: played.length,
    albumsPlayed: new Set(played.map((t) => t.albumId)).size,
    top: [
      { kind: "album", id: albumId, title: album.album, coverHash: album.coverHash, sec: Math.round(albumSec) },
      { kind: "song", id: song.id, title: song.title, coverHash: song.coverHash, albumId: song.albumId, plays: plays?.count ?? 0, sec: Math.round(secOf(song.id)) },
    ],
  };
}

/** The TV show and movie you watched longest, and how many episodes and movies you watched. A video's id is the movie's, or the episode's video. */
function watchStats(ctx: AppContext, byItem: Map<string, number>): { top: StatsTop[]; showEpisodesWatched: number; moviesWatched: number } {
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
  const top: StatsTop[] = [];
  const show = [...shows].sort((a, b) => b[1].sec - a[1].sec)[0];
  const movie = [...movies].sort((a, b) => secOf(b.id) - secOf(a.id))[0];
  const showTop = show ? { kind: "tvshow" as const, id: show[0], title: show[1].title, coverHash: show[1].coverHash, sec: Math.round(show[1].sec) } : null;
  const movieTop = movie ? { kind: "movie" as const, ...movie, sec: Math.round(secOf(movie.id)) } : null;
  // Longest first, as for the other kinds.
  for (const t of [showTop, movieTop].filter((x) => x !== null).sort((a, b) => b.sec - a.sec)) top.push(t);
  return {
    top,
    showEpisodesWatched: episodes.filter((e) => secOf(e.id) >= COUNTS_AS_LISTENED_SEC).length,
    moviesWatched: movies.filter((m) => secOf(m.id) >= COUNTS_AS_LISTENED_SEC).length,
  };
}
