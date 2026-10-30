// "More like this" ranking, shared by books and movies (packages/shared).
import { flatKeys, ladderKeys, rankSimilar, splitPeople } from "@murmur/shared/client";
import { expect, it } from "vitest";

it("turns ladders into prefixes two or more levels deep, weighted by depth", () => {
  expect([...ladderKeys(["A > B > C", "A > D", "E"])]).toEqual([
    ["A > B", 1],
    ["A > B > C", 2],
    ["A > D", 1],
  ]);
});

it("weighs rare shared genres over common ones", () => {
  const item = (id: string, genres: string[]) => ({ id, title: id, keys: flatKeys(genres) });
  const target = item("target", ["Drama", "War"]);
  const items = [target, item("drama", ["Drama"]), item("war", ["War"]), item("d2", ["Drama"]), item("d3", ["Drama"]), item("none", ["Comedy"])];
  expect(rankSimilar(target, items).map((i) => i.id)).toEqual(["war", "d2", "d3", "drama"]);
});

it("splits joined names for author matches", () => {
  expect(splitPeople("C.S. Lewis, Someone Else; A & B")).toEqual(["cslewis", "someoneelse", "a", "b"]);
  expect(splitPeople("C. S. Lewis")).toEqual(splitPeople("C.S. Lewis"));
  expect(splitPeople(null)).toEqual([]);
});
