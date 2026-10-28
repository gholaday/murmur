import { expect, it } from "vitest";
import {
  addItem,
  moveItem,
  nextIndex,
  previousIndex,
  removeAt,
  setShuffle,
  startMusic,
  startSingle,
  type UpNextList,
  type UpNextRef,
} from "@murmur/shared/client";

const song = (id: string, added = false): UpNextRef => ({ itemType: "track", itemId: id, added });
const ep = (id: string): UpNextRef => ({ itemType: "episode", itemId: id, added: true });
const source = { kind: "album" as const, refId: "al", title: "Album" };
const album = (index = 0, extra: UpNextRef[] = []): UpNextList => ({
  items: [...["a", "b", "c", "d", "e"].map((id) => song(id)), ...extra],
  index,
  source,
  originalIds: ["a", "b", "c", "d", "e"],
  shuffled: false,
});
const ids = (l: UpNextList) => l.items.map((e) => e.itemId);

it("starts an album in place of the songs, keeping episodes still to come", () => {
  const prev = album(1, [ep("x")]);
  const next = startMusic(prev, source, ["p", "q", "r"].map((id) => song(id)), 1, false);
  expect(ids(next)).toEqual(["p", "q", "r", "x"]);
  expect(next.index).toBe(1);
  const mixed = startMusic(prev, source, ["p", "q", "r"].map((id) => song(id)), 2, true);
  expect(mixed.items[0]?.itemId).toBe("r");
  expect(mixed.index).toBe(0);
  expect(startSingle(prev, ep("y"))).toMatchObject({ index: 0, source: null });
  expect(ids(startSingle(prev, ep("y")))).toEqual(["y", "x"]);
  expect(startSingle(prev, null).index).toBe(-1);
});

it("adds next after the playing item and earlier adds, and moves an item already waiting", () => {
  let l = addItem(album(1), song("q1"), "next");
  l = addItem(l, song("q2"), "next");
  expect(ids(l)).toEqual(["a", "b", "q1", "q2", "c", "d", "e"]);
  l = addItem(l, song("d"), "next");
  expect(ids(l)).toEqual(["a", "b", "q1", "q2", "d", "c", "e"]);
  // From the history: it comes down, and the playing song stays put.
  l = addItem(l, song("a"), "last");
  expect(ids(l)).toEqual(["b", "q1", "q2", "d", "c", "e", "a"]);
  expect(l.items[l.index]?.itemId).toBe("b");
});

it("takes out an item, moving on when it's the one playing", () => {
  expect(removeAt(album(2), 0).list.index).toBe(1);
  const { list, play } = removeAt(album(2), 2);
  expect(play).toBe(2);
  expect(list.items[2]?.itemId).toBe("d");
  expect(removeAt(album(4), 4).play).toBeNull();
});

it("keeps playing the moved item wherever it goes", () => {
  const l = moveItem(album(2), 2, 4);
  expect(ids(l)).toEqual(["a", "b", "d", "e", "c"]);
  expect(l.index).toBe(4);
  expect(moveItem(album(2), 4, 0).index).toBe(3);
});

it("shuffles only the album's songs to come, and turning it off picks up after the playing one", () => {
  const start = album(1, [ep("x")]);
  const withAdd = addItem(start, song("q"), "next");
  const on = setShuffle(withAdd, true);
  expect(ids(on).slice(0, 3)).toEqual(["a", "b", "q"]);
  expect(ids(on).at(-1)).toBe("x");
  expect([...ids(on).slice(3, 6)].sort()).toEqual(["c", "d", "e"]);
  const off = setShuffle({ ...on, items: [...on.items.slice(0, 3), song("e"), song("c"), song("d"), ep("x")], index: 3 }, false);
  // "e" played (it's the one playing), so after it nothing of the album is left but what came before isn't replayed.
  expect(ids(off)).toEqual(["a", "b", "q", "e", "x"]);
  expect(ids(setShuffle(on, false))).toEqual(["a", "b", "q", "c", "d", "e", "x"]);
});

it("repeats the song only when it ends by itself, and goes round on Repeat all", () => {
  expect(nextIndex(album(1), "one", true)).toBe("again");
  expect(nextIndex(album(1), "one", false)).toBe(2);
  expect(nextIndex(album(4), "off", true)).toBeNull();
  expect(nextIndex(album(4), "all", true)).toBe(0);
  expect(previousIndex(album(2), "off")).toBe(1);
  expect(previousIndex(album(0), "off")).toBeNull();
  expect(previousIndex(album(0), "all")).toBe(4);
});
