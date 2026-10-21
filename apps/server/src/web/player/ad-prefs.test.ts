import { expect, it } from "vitest";
import { adBreak, adToSkip, playedThrough } from "./ad-prefs";

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

it("tells normal playback from a seek, even with spaced-out ticks", () => {
  expect(playedThrough(100, 100.5, 0.5, 1)).toBe(true);
  expect(playedThrough(100, 130, 30, 1)).toBe(true); // background tab: one tick in 30 s
  expect(playedThrough(100, 106, 2, 2)).toBe(true); // 2x speed
  expect(playedThrough(100, 400, 0.5, 1)).toBe(false); // seek forward
  expect(playedThrough(100, 90, 0.5, 1)).toBe(false); // seek back
});

it("skips an ad playback runs into, but not one you land inside", () => {
  const spans = [ad(100, 130), ad(131, 160), ad(400, 430)];
  const none = new Set<number>();
  expect(adToSkip(spans, 99.5, 100.2, none)).toEqual({ endSec: 160, indexes: [0, 1], undoTo: 100 });
  expect(adToSkip(spans, 110, 110.5, none)).toBeNull(); // already inside: you seeked here
  expect(adToSkip(spans, 160, 160.5, none)).toBeNull(); // past the break
  expect(adToSkip(spans, 99.5, 100.2, new Set([0, 1]))).toBeNull(); // Undo let it play
});

it("skips an ad at 0:00 when playing from the start", () => {
  expect(adToSkip([ad(0, 39)], 0, 0.5, new Set())).toEqual({ endSec: 39, indexes: [0], undoTo: 0 });
  expect(adToSkip([ad(0.4, 39)], 0.5, 1, new Set())).toEqual({ endSec: 39, indexes: [0], undoTo: 0.4 });
});

it("undoes a skip forward into a break back to where the skip landed", () => {
  // +30 from 1728 lands at 1758, inside an ad starting at 1740: Undo returns to 1758.
  expect(adToSkip([ad(1740, 1877)], 1728, 1758, new Set(), 1758)).toEqual({ endSec: 1877, indexes: [0], undoTo: 1758 });
});
