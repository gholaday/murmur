import {
  addItem,
  EMPTY_UP_NEXT,
  type QueueRef,
  type UpNextDto,
  type UpNextEntry,
  type UpNextInput,
  type UpNextList,
  type UpNextRef,
  type UpNextSource,
} from "@murmur/shared";
import type { AppContext } from "./context";
import { tracksByIds } from "./music/queries";
import { episodesByIds, shortNotes } from "./podcasts/queries";

interface Row {
  items: string;
  idx: number;
  source_kind: UpNextSource["kind"] | null;
  source_ref: string | null;
  source_title: string | null;
  original_ids: string;
  shuffled: number;
}

/** The list as stored, with bare refs. A person who hasn't got one yet gets their old album and queue carried over. */
function readList(ctx: AppContext, userId: number): UpNextList {
  const row = ctx.sqlite
    .prepare("SELECT items, idx, source_kind, source_ref, source_title, original_ids, shuffled FROM up_next WHERE user_id = ?")
    .get(userId) as Row | undefined;
  if (!row) return fromOldTables(ctx, userId);
  return {
    items: JSON.parse(row.items) as UpNextRef[],
    index: row.idx,
    source: row.source_kind && row.source_title ? { kind: row.source_kind, refId: row.source_ref, title: row.source_title } : null,
    originalIds: JSON.parse(row.original_ids) as string[],
    shuffled: row.shuffled === 1,
  };
}

/** Before 0.5 the album (play_context) and the queue (queue_items) were kept apart. */
function fromOldTables(ctx: AppContext, userId: number): UpNextList {
  const queue = ctx.sqlite
    .prepare("SELECT item_type AS itemType, item_id AS itemId FROM queue_items WHERE user_id = ? ORDER BY position")
    .all(userId) as QueueRef[];
  const old = ctx.sqlite
    .prepare("SELECT kind, ref_id, title, track_ids, original_ids, idx, shuffled FROM play_context WHERE user_id = ?")
    .get(userId) as
    | { kind: UpNextSource["kind"]; ref_id: string | null; title: string; track_ids: string; original_ids: string | null; idx: number; shuffled: number }
    | undefined;
  const added = queue.map((r) => ({ ...r, added: true }));
  if (!old) return { ...EMPTY_UP_NEXT, items: added };
  const songs = (JSON.parse(old.track_ids) as string[]).map((id): UpNextRef => ({ itemType: "track", itemId: id, added: false }));
  const index = Math.min(old.idx, songs.length - 1);
  // Queued songs played next, and queued episodes waited for the album to end.
  const items = [
    ...songs.slice(0, index + 1),
    ...added.filter((r) => r.itemType === "track"),
    ...songs.slice(index + 1),
    ...added.filter((r) => r.itemType === "episode"),
  ];
  return {
    items,
    index,
    source: { kind: old.kind, refId: old.ref_id, title: old.title },
    originalIds: old.original_ids ? (JSON.parse(old.original_ids) as string[]) : songs.map((s) => s.itemId),
    shuffled: old.shuffled === 1,
  };
}

/** Up Next with each item's details. Items gone from the server (or from a show you left) drop out. */
export async function getUpNext(ctx: AppContext, userId: number): Promise<UpNextDto> {
  const list = readList(ctx, userId);
  const episodeIds = list.items.filter((r) => r.itemType === "episode").map((r) => r.itemId);
  // Rows never show the notes, and the whole list is sent back after every change.
  const episodes = new Map(shortNotes(await episodesByIds(ctx.sqlite, episodeIds, userId)).map((e) => [e.id, e]));
  const tracks = new Map(
    tracksByIds(ctx, userId, list.items.filter((r) => r.itemType === "track").map((r) => r.itemId)).map((t) => [t.id, t]),
  );
  const items: UpNextEntry[] = [];
  let index = list.index < 0 ? -1 : 0;
  list.items.forEach((r, i) => {
    const entry: UpNextEntry | null =
      r.itemType === "track"
        ? tracks.has(r.itemId)
          ? { itemType: "track", itemId: r.itemId, added: r.added, track: tracks.get(r.itemId)! }
          : null
        : episodes.has(r.itemId)
          ? { itemType: "episode", itemId: r.itemId, added: r.added, episode: episodes.get(r.itemId)! }
          : null;
    if (!entry) return;
    // The index follows the item it pointed at, or the next one left when that one is gone.
    if (i < list.index) index++;
    items.push(entry);
  });
  return { ...list, items, index: list.index < 0 ? -1 : Math.min(index, items.length - 1) };
}

export function saveUpNext(ctx: AppContext, userId: number, l: UpNextInput): void {
  ctx.sqlite
    .prepare(
      `INSERT INTO up_next (user_id, items, idx, source_kind, source_ref, source_title, original_ids, shuffled, updated_at)
       VALUES (@user, @items, @index, @kind, @ref, @title, @originalIds, @shuffled, @now)
       ON CONFLICT (user_id) DO UPDATE SET items = excluded.items, idx = excluded.idx, source_kind = excluded.source_kind,
         source_ref = excluded.source_ref, source_title = excluded.source_title, original_ids = excluded.original_ids,
         shuffled = excluded.shuffled, updated_at = excluded.updated_at`,
    )
    .run({
      user: userId,
      items: JSON.stringify(l.items.map(({ itemType, itemId, added }) => ({ itemType, itemId, added }))),
      index: Math.max(-1, Math.min(l.index, l.items.length - 1)),
      kind: l.source?.kind ?? null,
      ref: l.source?.refId ?? null,
      title: l.source?.title ?? null,
      originalIds: JSON.stringify(l.originalIds),
      shuffled: l.shuffled ? 1 : 0,
      now: Date.now(),
    });
}

/** Moves on to another item in the list. */
export function setUpNextIndex(ctx: AppContext, userId: number, index: number): void {
  saveUpNext(ctx, userId, { ...readList(ctx, userId), index });
}

/** Adds from anywhere (an episode row, a song's menu), so it lands the same on every device. */
export function addToUpNext(ctx: AppContext, userId: number, ref: QueueRef, at: "next" | "last"): void {
  saveUpNext(ctx, userId, addItem(readList(ctx, userId), { ...ref, added: true }, at));
}

/** An archived episode leaves what's still to come. */
export function dropWaitingEpisode(ctx: AppContext, userId: number, episodeId: string): void {
  const l = readList(ctx, userId);
  const items = l.items.filter((r, i) => i <= l.index || !(r.itemType === "episode" && r.itemId === episodeId));
  if (items.length !== l.items.length) saveUpNext(ctx, userId, { ...l, items });
}
