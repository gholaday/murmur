import { describe, expect, it } from "vitest";
import { cleanAlbumTitle, scoreAlbum, type UnscoredAlbum } from "./match-score";

const local = { title: "Currents", artist: "Tame Impala", trackCount: 13 };
const candidate = (over: Partial<UnscoredAlbum>): UnscoredAlbum => ({
  provider: "itunes",
  providerId: "1",
  title: "Currents",
  artist: "Tame Impala",
  year: "2015",
  genre: null,
  trackCount: 13,
  coverUrl: null,
  thumbUrl: null,
  ...over,
});

describe("cleanAlbumTitle", () => {
  it("drops edition words and EP markers", () => {
    expect(cleanAlbumTitle("Abbey Road (Remastered 2019)")).toBe("abbey road");
    expect(cleanAlbumTitle("Currents [Deluxe Edition]")).toBe("currents");
    expect(cleanAlbumTitle("Lights - EP")).toBe("lights");
    expect(cleanAlbumTitle("The Wall")).toBe("wall");
    expect(cleanAlbumTitle("Led Zeppelin II [2156]")).toBe("led zeppelin ii");
  });

  it("keeps brackets that are part of the title", () => {
    expect(cleanAlbumTitle("(What's the Story) Morning Glory?")).toBe("whats the story morning glory");
  });
});

describe("scoreAlbum", () => {
  it("suggests the same album with the same songs", () => {
    expect(scoreAlbum(local, candidate({})).score).toBe(100);
  });

  it("matches a deluxe title but won't pick another edition for you", () => {
    const deluxe = scoreAlbum(local, candidate({ title: "Currents (Deluxe)", trackCount: 15 }));
    expect(deluxe.score).toBeLessThan(90);
    expect(deluxe.score).toBeGreaterThan(70);
  });

  it("caps a different artist", () => {
    expect(scoreAlbum(local, candidate({ artist: "The Weeknd" })).score).toBeLessThanOrEqual(60);
  });
});
