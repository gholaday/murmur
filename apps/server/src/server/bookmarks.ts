import { type BookmarkDto, type BookmarkItem, chapterAt, type ChapterDto } from "@murmur/shared";
import { scannedChapters } from "./books";
import type { AppContext } from "./context";
import { MAX_CLOCK_SKEW_MS } from "./progress";
import { type RawChapter, toChapterDtos } from "./podcasts/chapters";

/** Saves new and edited bookmarks. The newest `updatedAt` wins, so a late sync can't undo a newer edit. */
export function saveBookmarks(ctx: AppContext, userId: number, items: BookmarkItem[]): number {
  const limit = Date.now() + MAX_CLOCK_SKEW_MS;
  const upsert = ctx.sqlite.prepare(`
    INSERT INTO bookmarks (user_id, id, item_type, item_id, position_sec, note, created_at, updated_at)
    VALUES (@userId, @id, @itemType, @itemId, @positionSec, @note, @createdAt, @updatedAt)
    ON CONFLICT (user_id, id) DO UPDATE SET
      position_sec = excluded.position_sec,
      note = excluded.note,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at > bookmarks.updated_at`);
  let applied = 0;
  ctx.sqlite.transaction(() => {
    for (const item of items) {
      applied += upsert.run({
        userId,
        id: item.id,
        itemType: item.itemType,
        itemId: item.itemId,
        positionSec: item.positionSec,
        note: item.note || null,
        createdAt: Math.min(item.createdAt, limit),
        updatedAt: Math.min(item.updatedAt, limit),
      }).changes;
    }
  })();
  return applied;
}

export function deleteBookmark(ctx: AppContext, userId: number, id: string) {
  ctx.sqlite.prepare("DELETE FROM bookmarks WHERE user_id = ? AND id = ?").run(userId, id);
}

/** All your bookmarks, in order within each item. Ones whose book or podcast is gone are left out, not deleted. */
export function listBookmarks(ctx: AppContext, userId: number): BookmarkDto[] {
  const rows = ctx.sqlite
    .prepare(
      `SELECT m.id, m.item_type, m.item_id, m.position_sec, m.note, m.created_at, m.updated_at,
              e.podcast_id, e.title, e.chapters, e.duration_sec, o.chapters AS o_chapters
       FROM bookmarks m
       LEFT JOIN books b ON m.item_type = 'book' AND b.id = m.item_id
       LEFT JOIN book_overrides o ON o.book_id = b.id
       LEFT JOIN episodes e ON m.item_type = 'episode' AND e.id = m.item_id
       WHERE m.user_id = ? AND (b.id IS NOT NULL OR e.id IS NOT NULL)
       ORDER BY m.item_id, m.position_sec`,
    )
    .all(userId) as Array<{
    id: string;
    item_type: "book" | "episode";
    item_id: string;
    position_sec: number;
    note: string | null;
    created_at: number;
    updated_at: number;
    podcast_id: string | null;
    title: string | null;
    chapters: string | null;
    duration_sec: number | null;
    o_chapters: string | null;
  }>;
  // Rows of one item sit together, so each book's chapters are read once.
  let last: { id: string; chapters: ChapterDto[] } | null = null;
  return rows.map((r) => {
    if (last?.id !== r.item_id) {
      const chapters =
        r.item_type === "episode"
          ? episodeChapters(r.chapters, r.duration_sec)
          : r.o_chapters
            ? (JSON.parse(r.o_chapters) as ChapterDto[])
            : scannedChapters(ctx, r.item_id);
      last = { id: r.item_id, chapters };
    }
    const { chapters } = last;
    return {
      id: r.id,
      itemType: r.item_type,
      itemId: r.item_id,
      positionSec: r.position_sec,
      note: r.note,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      chapter: chapters.length > 1 ? (chapters[chapterAt(chapters, r.position_sec)]?.title ?? null) : null,
      podcastId: r.podcast_id,
      title: r.title,
    };
  });
}

function episodeChapters(json: string | null, durationSec: number | null): ChapterDto[] {
  if (!json) return [];
  try {
    return toChapterDtos(JSON.parse(json) as RawChapter[], durationSec);
  } catch {
    return [];
  }
}
