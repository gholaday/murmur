import { expect, it } from "vitest";
import { adBreak } from "./ad-prefs";

const ad = (startSec: number, endSec: number) => ({ startSec, endSec, kind: "inserted" as const });

it("skips a whole break of back-to-back ads, but not the next break", () => {
  const spans = [ad(100, 130), ad(131, 160), ad(162.5, 190), ad(400, 430)];
  expect(adBreak(spans, 0)).toEqual({ endSec: 190, indexes: [0, 1, 2] });
  expect(adBreak(spans, 3)).toEqual({ endSec: 430, indexes: [3] });
});

it("starts the break at the ad being played", () => {
  const spans = [ad(100, 130), ad(131, 160)];
  expect(adBreak(spans, 1)).toEqual({ endSec: 160, indexes: [1] });
});

it("keeps the furthest end when ads overlap", () => {
  expect(adBreak([ad(100, 200), ad(150, 180)], 0)).toEqual({ endSec: 200, indexes: [0, 1] });
});
