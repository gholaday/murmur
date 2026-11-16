// The show page's Unplayed tab, shared by the web and the app (packages/shared).
import { describe, expect, it } from "vitest";
import { unplayedEpisodes } from "@murmur/shared";

const ep = (id: string, progress: { finished: boolean; positionSec: number } | null) => ({ id, progress });

describe("unplayedEpisodes", () => {
  it("keeps new and half-heard episodes, drops finished ones, in the order given", () => {
    const list = [
      ep("a", null),
      ep("b", { finished: true, positionSec: 0 }),
      ep("c", { finished: false, positionSec: 300 }),
      ep("d", { finished: true, positionSec: 1200 }),
    ];
    expect(unplayedEpisodes(list).map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("is empty when everything is played", () => {
    expect(unplayedEpisodes([ep("a", { finished: true, positionSec: 0 })])).toEqual([]);
  });
});
