import { expect, it } from "vitest";
import {
  adScanStatus,
  clampSpeed,
  type EpisodeCacheStatusDto,
  type EpisodeDto,
  matchesEpisode,
  parseSkip,
  progressItemSchema,
  sleepLabel,
} from "@murmur/shared";

it("keeps speeds within 0.5x to 2x, to two decimals", () => {
  expect(clampSpeed(1.257)).toBe(1.26);
  expect(clampSpeed(2.5)).toBe(2); // saved under the old 3x limit
  expect(clampSpeed(0.1)).toBe(0.5);
});

it("brings an out-of-range saved speed into range instead of rejecting the save", () => {
  const item = { itemType: "book", itemId: "b1", positionSec: 10, durationSec: 100, finished: false, updatedAt: 1 };
  expect(progressItemSchema.parse({ ...item, speed: 3 }).speed).toBe(2);
  expect(progressItemSchema.safeParse({ ...item, speed: 0 }).success).toBe(false);
});

it("falls back to the default skip settings when the saved ones don't make sense", () => {
  expect(parseSkip({ back: 15, forward: 45 })).toEqual({ back: 15, forward: 45 });
  expect(parseSkip({ back: 0, forward: 30 })).toEqual({ back: 10, forward: 30 });
  expect(parseSkip("nonsense")).toEqual({ back: 10, forward: 30 });
  expect(parseSkip(null)).toEqual({ back: 10, forward: 30 });
});

it("labels the sleep timer", () => {
  expect(sleepLabel({ mode: "off" }, 0)).toBe("Sleep");
  expect(sleepLabel({ mode: "chapter", endSec: 100 }, 0)).toBe("Chapter end");
  expect(sleepLabel({ mode: "timer", endsAt: 90_000 }, 0)).toBe("1:30");
  expect(sleepLabel({ mode: "timer", endsAt: 0 }, 5000)).toBe("0:00"); // never negative
});

it("searches episode titles and notes, ignoring case", () => {
  const ep = { title: "Missouri Analysis", description: "FSU prep and more" } as EpisodeDto;
  expect(matchesEpisode(ep, "souri")).toBe(true);
  expect(matchesEpisode(ep, "fsu")).toBe(true);
  expect(matchesEpisode({ ...ep, description: null }, "fsu")).toBe(false);
});

it("counts the ad add-on as missing once it's been quiet too long", () => {
  const ads: EpisodeCacheStatusDto["ads"] = {
    enabled: true,
    addon: { version: "1", state: "ok", message: null, geminiRequestsToday: 0, seenAt: 0 },
    queued: 2,
    done: 5,
    failed: 0,
  };
  expect(adScanStatus(ads, 60_000)).toMatchObject({ state: "ok", text: "Working", counts: "5 scanned, 2 waiting" });
  expect(adScanStatus(ads, 16 * 60_000).state).toBe("missing");
});
