import { describe, expect, it } from "vitest";
import { ART_NAMES, editionOf, episodeInfo, isExtra, movieInfo, movieKey, parseNameYear, parseNfo, pickArt, sortTitle } from "./parse";
describe("parseNameYear", () => {
  it("reads Plex names", () => {
    expect(parseNameYear("The Long Field (2019)")).toEqual({ title: "The Long Field", year: "2019" });
    expect(parseNameYear("Alien (1979) {tmdb-348}")).toEqual({ title: "Alien", year: "1979" });
    expect(parseNameYear("Blade Runner 2049 (2017)")).toEqual({ title: "Blade Runner 2049", year: "2017" });
  });

  it("reads scene names", () => {
    expect(parseNameYear("The.Long.Field.2019.1080p.BluRay.x264")).toEqual({ title: "The Long Field", year: "2019" });
    expect(parseNameYear("Blade.Runner.2049.2017.2160p.UHD")).toEqual({ title: "Blade Runner 2049", year: "2017" });
  });

  it("keeps a title that is only a year", () => {
    expect(parseNameYear("1917")).toEqual({ title: "1917", year: null });
    expect(parseNameYear("2012 (2009)")).toEqual({ title: "2012", year: "2009" });
  });
});

describe("movieInfo", () => {
  it("prefers the folder, falls back to the file", () => {
    expect(movieInfo("Alien (1979)/alien.mkv")).toEqual({ title: "Alien", year: "1979" });
    expect(movieInfo("Alien (1979).mkv")).toEqual({ title: "Alien", year: "1979" });
    expect(movieInfo("Sci-fi/Alien (1979).mkv")).toEqual({ title: "Alien", year: "1979" });
  });
});

describe("versions", () => {
  it("groups files by their movie folder", () => {
    expect(movieKey("Alien (1979)/Alien (1979).mkv")).toBe("Alien (1979)");
    expect(movieKey("Alien (1979)/Alien (1979) {edition-Director's Cut}.mkv")).toBe("Alien (1979)");
    expect(movieKey("Alien (1979).mkv")).toBe("Alien (1979).mkv");
    expect(movieKey("Alien/Alien.1979.1080p.mkv")).toBe("Alien");
  });

  it("doesn't make a folder of loose movies into one movie", () => {
    expect(movieKey("Sci-fi/Alien (1979).mkv")).toBe("Sci-fi/Alien (1979).mkv");
    expect(movieKey("Sci-fi/Aliens (1986).mkv")).toBe("Sci-fi/Aliens (1986).mkv");
  });

  it("reads editions from file names", () => {
    expect(editionOf("Alien (1979) {edition-Director's Cut}.mkv")).toBe("Director's Cut");
    expect(editionOf("Star.Wars.Episode.V.Despecialized.Edition.Remastered.v2.0.1980.720p.mkv")).toBe("Despecialized Edition");
    expect(editionOf("Oppenheimer.2023.IMAX.1080p.BluRay.mkv")).toBe("IMAX");
    expect(editionOf("Aliens.1986.Extended.Cut.1080p.mkv")).toBe("Extended Cut");
    expect(editionOf("Alien (1979).mkv")).toBeNull();
  });
});

describe("isExtra", () => {
  it("skips trailers, samples and extras folders", () => {
    expect(isExtra("Alien (1979)/Alien (1979)-trailer.mp4")).toBe(true);
    expect(isExtra("Alien (1979)/Featurettes/Making of.mkv")).toBe(true);
    expect(isExtra("Alien (1979)/sample.mkv")).toBe(true);
    expect(isExtra("Alien (1979)/Alien (1979).mkv")).toBe(false);
  });
});

describe("episodeInfo", () => {
  it("reads SxxEyy and the title after it", () => {
    expect(episodeInfo("Night Ferry (2021)/Season 02/Night Ferry - S02E04 - The Crossing.mkv")).toEqual({
      showPath: "Night Ferry (2021)",
      season: 2,
      episode: 4,
      title: "The Crossing",
    });
    expect(episodeInfo("Show/Night.Ferry.S02E04.The.Crossing.1080p.WEB-DL.mkv")?.title).toBe("The Crossing");
  });

  it("files a double episode under its first number", () => {
    expect(episodeInfo("Show/S01E01-E02.mkv")).toMatchObject({ season: 1, episode: 1, title: "Episode 1" });
  });

  it("reads 2x04, and Season folders with a leading number", () => {
    expect(episodeInfo("Show/Show 2x04 Fog.mkv")).toMatchObject({ season: 2, episode: 4, title: "Fog" });
    expect(episodeInfo("Show/Season 3/07 - Breakwater.mkv")).toMatchObject({ season: 3, episode: 7, title: "Breakwater" });
    expect(episodeInfo("Show/Specials/02.mkv")).toMatchObject({ season: 0, episode: 2 });
  });

  it("gives up when nothing says which episode it is", () => {
    expect(episodeInfo("Show/Pilot.mkv")).toBeNull();
    expect(episodeInfo("Loose S01E01.mkv")).toBeNull();
  });
});

describe("sortTitle", () => {
  it("drops a leading article", () => {
    expect(sortTitle("The Long Field")).toBe("long field");
    expect(sortTitle("An Unlikely Hero")).toBe("unlikely hero");
  });
});

describe("pickArt", () => {
  it("prefers the file's own image, then the folder's", () => {
    const names = ["folder.jpg", "Alien (1979)-poster.JPG", "fanart.png"];
    expect(pickArt(names, ART_NAMES.poster("Alien (1979)"))).toBe("Alien (1979)-poster.JPG");
    expect(pickArt(names, ART_NAMES.poster(null))).toBe("folder.jpg");
    expect(pickArt(names, ART_NAMES.backdrop(null))).toBe("fanart.png");
  });
});

describe("parseNfo", () => {
  it("reads Kodi nfo files and ignores link-only ones", () => {
    const nfo = `<?xml version="1.0"?><movie><title>Alien</title><plot>In space.</plot><premiered>1979-05-25</premiered></movie>`;
    expect(parseNfo(nfo)).toEqual({ title: "Alien", year: "1979", plot: "In space." });
    expect(parseNfo("https://www.themoviedb.org/movie/348")).toBeNull();
  });
});
