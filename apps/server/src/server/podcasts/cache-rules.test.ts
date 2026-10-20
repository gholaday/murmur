import { expect, it } from "vitest";
import { audioExtension, cleanAdSpans, evictionOrder } from "./cache-rules";

it("evicts finished episodes first, then the least recently used, and never kept ones", () => {
  const files = [
    { episodeId: "old", size: 1, lastUsedAt: 100 },
    { episodeId: "newer", size: 1, lastUsedAt: 500 },
    { episodeId: "finished", size: 1, lastUsedAt: 900 },
    { episodeId: "up-next", size: 1, lastUsedAt: 1 },
  ];
  const order = evictionOrder(files, new Set(["up-next"]), new Set(["finished"]));
  expect(order.map((f) => f.episodeId)).toEqual(["finished", "old", "newer"]);
});

it("drops impossible ad spans and cuts ones that run past the end", () => {
  const ad = (startSec: number, endSec: number) => ({ startSec, endSec, kind: "inserted" as const });
  expect(cleanAdSpans([ad(30, 20), ad(10, 400), ad(4300, 4320)], 4240)).toEqual([]);
  expect(cleanAdSpans([ad(4200, 4300)], 4240)).toEqual([ad(4200, 4240)]);
  // no known length: nothing is cut
  expect(cleanAdSpans([ad(4200, 4300)], null)).toEqual([ad(4200, 4300)]);
});

it("joins copies of an ad found twice but keeps back-to-back ads apart", () => {
  const ad = (startSec: number, endSec: number) => ({ startSec, endSec, kind: "inserted" as const });
  expect(cleanAdSpans([ad(60, 90), ad(0, 31), ad(31, 60), ad(61, 92)], null)).toEqual([ad(0, 31), ad(31, 60), ad(60, 92)]);
});

it("names cached files by type, then by URL", () => {
  expect(audioExtension("audio/mpeg", "https://x/ep")).toBe("mp3");
  expect(audioExtension("audio/x-m4a", "https://x/ep")).toBe("m4a");
  expect(audioExtension(null, "https://x/ep.mp4?id=1")).toBe("m4a");
  expect(audioExtension(null, "https://x/ep")).toBe("mp3");
});
