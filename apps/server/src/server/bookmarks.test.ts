import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { bookmarkNear, bookmarkSchema, bookmarkSpot, type BookmarkItem, holdEnded, type JumpHold, offersGoBack, thirdTile } from "@murmur/shared";
import { saveBookmarks } from "./bookmarks";
import type { AppContext } from "./context";

function context() {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE users (id integer primary key)");
  sqlite.exec("INSERT INTO users (id) VALUES (1), (2)");
  const migration = fs.readdirSync(path.resolve(__dirname, "../../drizzle")).find((f) => f.startsWith("0024"))!;
  sqlite.exec(fs.readFileSync(path.resolve(__dirname, "../../drizzle", migration), "utf8").replaceAll("--> statement-breakpoint", ""));
  return { sqlite } as unknown as AppContext;
}

const mark = (over: Partial<BookmarkItem> = {}): BookmarkItem => ({
  id: "abc12345",
  itemType: "book",
  itemId: "b1",
  positionSec: 100,
  note: null,
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});
const rows = (ctx: AppContext) => ctx.sqlite.prepare("SELECT user_id, position_sec, note FROM bookmarks ORDER BY user_id").all();

it("keeps the newest edit of a bookmark, and a retry changes nothing", () => {
  const ctx = context();
  expect(saveBookmarks(ctx, 1, [mark()])).toBe(1);
  expect(saveBookmarks(ctx, 1, [mark()])).toBe(0);
  saveBookmarks(ctx, 1, [mark({ note: "new", updatedAt: 3000 })]);
  saveBookmarks(ctx, 1, [mark({ note: "old", updatedAt: 2000 })]);
  expect(rows(ctx)).toEqual([{ user_id: 1, position_sec: 100, note: "new" }]);
});

it("never lets one person's id land on another's bookmark", () => {
  const ctx = context();
  saveBookmarks(ctx, 1, [mark({ note: "mine" })]);
  saveBookmarks(ctx, 2, [mark({ note: "theirs", updatedAt: 2000 })]);
  expect(rows(ctx)).toEqual([
    { user_id: 1, position_sec: 100, note: "mine" },
    { user_id: 2, position_sec: 100, note: "theirs" },
  ]);
});

it("doesn't let a clock far in the future win every later edit", () => {
  const ctx = context();
  saveBookmarks(ctx, 1, [mark({ updatedAt: Date.now() + 86_400_000 })]);
  const { updated_at } = ctx.sqlite.prepare("SELECT updated_at FROM bookmarks").get() as { updated_at: number };
  expect(updated_at).toBeLessThanOrEqual(Date.now() + 60_000);
});

it("turns down an odd id and a long note", () => {
  expect(bookmarkSchema.safeParse(mark()).success).toBe(true);
  expect(bookmarkSchema.safeParse(mark({ id: "x" })).success).toBe(false);
  expect(bookmarkSchema.safeParse(mark({ id: "../../etc/passwd" })).success).toBe(false);
  expect(bookmarkSchema.safeParse(mark({ note: "x".repeat(501) })).success).toBe(false);
});

it("lands a bookmark a little before the tap, scaled by speed, and at the spot when paused", () => {
  expect(bookmarkSpot(100, true, 1)).toBe(90);
  expect(bookmarkSpot(100, true, 2)).toBe(80);
  expect(bookmarkSpot(100, false, 2)).toBe(100);
  expect(bookmarkSpot(4, true, 1)).toBe(0);
});

it("finds the closest bookmark within reach", () => {
  const list = [{ positionSec: 100 }, { positionSec: 120 }];
  expect(bookmarkNear(list, 113)).toBe(list[1]);
  expect(bookmarkNear(list, 84)).toBeNull();
  expect(bookmarkNear(list, 90)).toBe(list[0]);
});

it("picks the player's third tile", () => {
  expect(thirdTile("track", false)).toBeNull();
  expect(thirdTile("book", true)).toBe("chapters");
  expect(thirdTile("episode", true)).toBe("chapters");
  expect(thirdTile("book", false)).toBe("bookmarks");
  expect(thirdTile("episode", false)).toBe("bookmarks");
});

it("offers Go back on a real jump and holds until it's over", () => {
  expect(offersGoBack(100, 120)).toBe(false);
  expect(offersGoBack(100, 500)).toBe(true);
  // Nothing to go back to from the very start.
  expect(offersGoBack(2, 500)).toBe(false);
  const back: JumpHold = { type: "book", id: "b", returnTo: 500, from: 100, heard: 2 };
  expect(holdEnded(back, 200)).toBe(false);
  expect(holdEnded({ ...back, heard: 300 }, 200)).toBe(true);
  // Played up to the real place, but not on a stale position right after the jump.
  expect(holdEnded(back, 500)).toBe(true);
  expect(holdEnded({ ...back, heard: 0 }, 500)).toBe(false);
  // A jump forwards is always past the real place, so only listening ends it.
  expect(holdEnded({ ...back, returnTo: 100, from: 500 }, 600)).toBe(false);
});
