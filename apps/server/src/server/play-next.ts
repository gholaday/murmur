import type { AppContext } from "./context";
import { HttpError } from "./http";

// Each person's Play next shelf: books lined up to start, in their order. A book leaves it
// once it's started, since it's in Continue listening from then on.

/** Puts a book at the end of the shelf; one already on it stays where it is. */
export function addToPlayNext(ctx: AppContext, userId: number, bookId: string) {
  if (!ctx.sqlite.prepare("SELECT 1 FROM books WHERE id = ?").get(bookId)) throw new HttpError(404, "Book not found.");
  ctx.sqlite
    .prepare(
      `INSERT INTO play_next (user_id, book_id, position, added_at)
       VALUES (@userId, @bookId, (SELECT COALESCE(MAX(position) + 1, 0) FROM play_next WHERE user_id = @userId), @now)
       ON CONFLICT (user_id, book_id) DO NOTHING`,
    )
    .run({ userId, bookId, now: Date.now() });
}

export function removeFromPlayNext(ctx: AppContext, userId: number, bookId: string) {
  ctx.sqlite.prepare("DELETE FROM play_next WHERE user_id = ? AND book_id = ?").run(userId, bookId);
}

/** Sets the shelf's order. Books not named keep their place after the named ones. */
export function orderPlayNext(ctx: AppContext, userId: number, bookIds: string[]) {
  const current = (ctx.sqlite.prepare("SELECT book_id FROM play_next WHERE user_id = ? ORDER BY position").all(userId) as { book_id: string }[]).map(
    (r) => r.book_id,
  );
  const on = new Set(current);
  const named = [...new Set(bookIds)].filter((id) => on.has(id));
  const order = [...named, ...current.filter((id) => !named.includes(id))];
  const set = ctx.sqlite.prepare("UPDATE play_next SET position = ? WHERE user_id = ? AND book_id = ?");
  ctx.sqlite.transaction(() => order.forEach((id, i) => set.run(i, userId, id)))();
}

/** Takes books that have been started off the shelf. */
export function dropStartedFromPlayNext(ctx: AppContext, userId: number, bookIds: string[]) {
  if (!bookIds.length) return;
  ctx.sqlite
    .prepare(
      `DELETE FROM play_next WHERE user_id = ? AND book_id IN (SELECT value FROM json_each(?))
       AND book_id IN (SELECT item_id FROM progress WHERE user_id = play_next.user_id AND item_type = 'book'
                       AND (finished = 1 OR position_sec > 5))`,
    )
    .run(userId, JSON.stringify(bookIds));
}
