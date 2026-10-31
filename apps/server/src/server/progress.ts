import type { ProgressDto, ProgressItem } from "@murmur/shared";
import type { AppContext } from "./context";
import { dropStartedFromPlayNext } from "./play-next";

/** Clients may not claim timestamps far in the future, or a wrong clock would win every conflict forever. */
export const MAX_CLOCK_SKEW_MS = 60_000;

/**
 * Saves a batch of progress updates. For each item the newest `updatedAt` wins,
 * so a phone syncing offline listening later never overwrites a newer position.
 */
export function saveProgress(ctx: AppContext, userId: number, items: ProgressItem[]): number {
  const limit = Date.now() + MAX_CLOCK_SKEW_MS;
  const upsert = ctx.sqlite.prepare(`
    INSERT INTO progress (user_id, item_type, item_id, position_sec, duration_sec, finished, speed, updated_at)
    VALUES (@userId, @itemType, @itemId, @positionSec, @durationSec, @finished, COALESCE(@speed, 1), @updatedAt)
    ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET
      position_sec = excluded.position_sec,
      duration_sec = excluded.duration_sec,
      finished = excluded.finished,
      speed = COALESCE(@speed, progress.speed),
      updated_at = excluded.updated_at
    WHERE excluded.updated_at > progress.updated_at`);
  let applied = 0;
  ctx.sqlite.transaction(() => {
    for (const item of items) {
      const result = upsert.run({
        userId,
        itemType: item.itemType,
        itemId: item.itemId,
        positionSec: item.positionSec,
        durationSec: item.durationSec,
        finished: item.finished ? 1 : 0,
        speed: item.speed ?? null,
        updatedAt: Math.min(item.updatedAt, limit),
      });
      applied += result.changes;
    }
    dropStartedFromPlayNext(
      ctx,
      userId,
      items.filter((i) => i.itemType === "book").map((i) => i.itemId),
    );
  })();
  return applied;
}

export function listProgress(ctx: AppContext, userId: number, since = 0): ProgressDto[] {
  const rows = ctx.sqlite
    .prepare(
      `SELECT item_type, item_id, position_sec, duration_sec, finished, speed, updated_at
       FROM progress WHERE user_id = ? AND updated_at > ? AND item_type != 'video' ORDER BY updated_at DESC`,
    )
    .all(userId, since) as Array<{
    item_type: "book" | "episode";
    item_id: string;
    position_sec: number;
    duration_sec: number;
    finished: number;
    speed: number;
    updated_at: number;
  }>;
  return rows.map((r) => ({
    itemType: r.item_type,
    itemId: r.item_id,
    positionSec: r.position_sec,
    durationSec: r.duration_sec,
    finished: r.finished === 1,
    speed: r.speed,
    updatedAt: r.updated_at,
  }));
}
