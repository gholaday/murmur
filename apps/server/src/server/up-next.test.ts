import { expect, it } from "vitest";
import {
  addItem,
  EMPTY_UP_NEXT,
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

it("puts the whole album back in order around the playing song when shuffle goes off", () => {
  const mixed = startMusic(EMPTY_UP_NEXT, source, ["a", "b", "c", "d", "e"].map((id) => song(id)), 2, true);
  const off = setShuffle(mixed, false);
  expect(ids(off)).toEqual(["a", "b", "c", "d", "e"]);
  expect(off.index).toBe(2);
  expect(ids(setShuffle(off, true)).length).toBe(5);
});

it("shuffles with the playing song on top, keeping what you added next and episodes last", () => {
  const start = album(1, [ep("x")]);
  const withAdd = addItem(start, song("q"), "next");
  const on = setShuffle(withAdd, true);
  expect(on.index).toBe(0);
  expect(ids(on).slice(0, 2)).toEqual(["b", "q"]);
  expect(ids(on).at(-1)).toBe("x");
  expect([...ids(on).slice(2, 6)].sort()).toEqual(["a", "c", "d", "e"]);
  expect(ids(setShuffle(on, false))).toEqual(["a", "b", "q", "c", "d", "e", "x"]);
  // Turning it on again mixes the whole album again, not only what was left; the added "q" already played, so it goes.
  const again = setShuffle({ ...on, index: 4 }, true);
  expect(again.index).toBe(0);
  expect(ids(again)[0]).toBe(on.items[4]!.itemId);
  expect([...ids(again).slice(0, 5)].sort()).toEqual(["a", "b", "c", "d", "e"]);
  expect(ids(again).at(-1)).toBe("x");
});

it("turning shuffle off later in the list puts the album above the playing song in order", () => {
  const l: UpNextList = { ...album(3), items: ["b", "q", "a", "e", "c", "d"].map((id) => song(id, id === "q")).concat(ep("x")), shuffled: true };
  const off = setShuffle(l, false);
  // "e" is playing, so the rest of the album goes above it and only the episode is left to come.
  expect(ids(off)).toEqual(["a", "b", "c", "d", "q", "e", "x"]);
  expect(off.index).toBe(5);
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
