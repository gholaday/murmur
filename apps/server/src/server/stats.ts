import {
  COUNTS_AS_LISTENED_SEC,
  type ListeningReport,
  type StatsDto,
  type StatsPeriod,
  type StatsTop,
  localDay,
  periodRange,
  streakDays,
} from "@murmur/shared";
import { booksByIds } from "./books";
import type { AppContext } from "./context";

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
  item_type: "book" | "episode";
  item_id: string;
  listened: number;
  content: number;
}

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

  const split = { book: 0, episode: 0 };
  const byItem = new Map<string, number>();
  const episodes = new Set<string>();
  let totalSec = 0;
  let contentSec = 0;
  for (const r of rows) {
    totalSec += r.listened;
    contentSec += r.content;
    split[r.item_type] += r.listened;
    const key = `${r.item_type}:${r.item_id}`;
    byItem.set(key, (byItem.get(key) ?? 0) + r.listened);
  }
  for (const [key, sec] of byItem) if (key.startsWith("episode:") && sec >= COUNTS_AS_LISTENED_SEC) episodes.add(key);

  const bars = range.buckets.map((b) => ({
    key: b.key,
    label: b.label,
    sec: Math.round(rows.filter((r) => r.day >= b.from && r.day <= b.to).reduce((sum, r) => sum + r.listened, 0)),
  }));

  const previous =
    range.prevFrom && range.prevTo
      ? (db
          .prepare("SELECT COALESCE(SUM(listened_sec), 0) AS sec FROM listening_days WHERE user_id = ? AND day BETWEEN ? AND ?")
          .get(userId, range.prevFrom, range.prevTo) as { sec: number })
      : null;

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

  return {
    period,
    from: range.from,
    to: range.to,
    totalSec: Math.round(totalSec),
    previousSec: previous ? Math.round(previous.sec) : null,
    bars,
    split: { book: Math.round(split.book), episode: Math.round(split.episode) },
    streakDays: streakDays(listenedDays, today),
    finishedBooks: finished.n,
    episodesPlayed: episodes.size,
    savedSec: Math.max(0, Math.round(contentSec - totalSec)),
    top: await topItems(ctx, userId, byItem),
  };
}

/** The most played book and the most played show in the period. */
async function topItems(ctx: AppContext, userId: number, byItem: Map<string, number>): Promise<StatsTop[]> {
  const top: StatsTop[] = [];
  let book: [string, number] | null = null;
  const shows = new Map<string, number>();
  const episodeIds: string[] = [];
  for (const [key, sec] of byItem) {
    const [type, id] = key.split(":") as [string, string];
    if (type === "book") {
      if (!book || sec > book[1]) book = [id, sec];
    } else episodeIds.push(id);
  }
  if (book) {
    const [summary] = await booksByIds(ctx, [book[0]], userId);
    if (summary) top.push({ kind: "book", id: summary.id, title: summary.title, coverHash: summary.coverHash, sec: Math.round(book[1]) });
  }
  if (episodeIds.length) {
    const rows = ctx.sqlite
      .prepare(`SELECT id, podcast_id AS podcastId FROM episodes WHERE id IN (${episodeIds.map(() => "?").join(",")})`)
      .all(...episodeIds) as Array<{ id: string; podcastId: string }>;
    for (const r of rows) shows.set(r.podcastId, (shows.get(r.podcastId) ?? 0) + (byItem.get(`episode:${r.id}`) ?? 0));
    const best = [...shows].sort((a, b) => b[1] - a[1])[0];
    if (best) {
      const show = ctx.sqlite.prepare("SELECT id, title, cover_hash AS coverHash FROM podcasts WHERE id = ?").get(best[0]) as
        | { id: string; title: string; coverHash: string | null }
        | undefined;
      if (show) top.push({ kind: "podcast", ...show, sec: Math.round(best[1]) });
    }
  }
  return top;
}
