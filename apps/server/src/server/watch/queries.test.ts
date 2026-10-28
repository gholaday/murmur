import { describe, expect, it } from "vitest";
import type { VideoEpisode, VideoProgress } from "@murmur/shared";
import { showUpNext } from "./queries";

const ep = (id: string, progress: VideoProgress | null = null) => ({ id, progress }) as VideoEpisode;
const done = (updatedAt: number): VideoProgress => ({ positionSec: 0, finished: true, updatedAt });
const partway = (updatedAt: number): VideoProgress => ({ positionSec: 300, finished: false, updatedAt });

describe("showUpNext", () => {
  it("resumes the episode you're partway through", () => {
    expect(showUpNext([ep("a", done(1)), ep("b", partway(2)), ep("c")])).toBe("b");
  });

  it("goes to the episode after the last one you finished, not the first gap", () => {
    expect(showUpNext([ep("a"), ep("b", done(5)), ep("c"), ep("d")])).toBe("c");
  });

  it("goes back to an earlier gap once the end is watched, and null when all are", () => {
    expect(showUpNext([ep("a"), ep("b", done(5))])).toBe("a");
    expect(showUpNext([ep("a", done(1)), ep("b", done(2))])).toBeNull();
  });
});
