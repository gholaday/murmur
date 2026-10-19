import type { QueueEntry, QueueRef } from "@murmur/shared";
import { booksByIds } from "./books";
import type { AppContext } from "./context";
import { episodesByIds } from "./podcasts/queries";

/**
 * The queue with each item's details. Items whose book or episode no longer exists
 * (or whose show was unsubscribed) are skipped rather than shown broken.
 */
export async function getQueue(ctx: AppContext, userId: number): Promise<QueueEntry[]> {
  const refs = ctx.sqlite
    .prepare("SELECT item_type AS itemType, item_id AS itemId FROM queue_items WHERE user_id = ? ORDER BY position")
    .all(userId) as QueueRef[];
  const books = new Map(
    (await booksByIds(ctx, refs.filter((r) => r.itemType === "book").map((r) => r.itemId), userId)).map((b) => [b.id, b]),
  );
  const episodes = new Map(
    (await episodesByIds(ctx.sqlite, refs.filter((r) => r.itemType === "episode").map((r) => r.itemId), userId)).map(
      (e) => [e.id, e],
    ),
  );
  const out: QueueEntry[] = [];
  for (const r of refs) {
    if (r.itemType === "book") {
      const book = books.get(r.itemId);
      if (book) out.push({ itemType: "book", itemId: r.itemId, book });
    } else {
      const episode = episodes.get(r.itemId);
      if (episode) out.push({ itemType: "episode", itemId: r.itemId, episode });
    }
  }
  return out;
}

export function replaceQueue(ctx: AppContext, userId: number, items: QueueRef[]) {
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const key = `${i.itemType}:${i.itemId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const now = Date.now();
  const del = ctx.sqlite.prepare("DELETE FROM queue_items WHERE user_id = ?");
  const ins = ctx.sqlite.prepare(
    "INSERT INTO queue_items (user_id, item_type, item_id, position, added_at) VALUES (?, ?, ?, ?, ?)",
  );
  ctx.sqlite.transaction(() => {
    del.run(userId);
    unique.forEach((i, pos) => ins.run(userId, i.itemType, i.itemId, pos, now));
  })();
}

/** Adds to the front or back of the queue; an item already queued moves instead of doubling up. */
export function addToQueue(ctx: AppContext, userId: number, ref: QueueRef, at: "next" | "last") {
  const current = ctx.sqlite
    .prepare("SELECT item_type AS itemType, item_id AS itemId FROM queue_items WHERE user_id = ? ORDER BY position")
    .all(userId) as QueueRef[];
  const rest = current.filter((r) => !(r.itemType === ref.itemType && r.itemId === ref.itemId));
  replaceQueue(ctx, userId, at === "next" ? [ref, ...rest] : [...rest, ref]);
}

export function removeFromQueue(ctx: AppContext, userId: number, ref: QueueRef) {
  ctx.sqlite
    .prepare("DELETE FROM queue_items WHERE user_id = ? AND item_type = ? AND item_id = ?")
    .run(userId, ref.itemType, ref.itemId);
}
