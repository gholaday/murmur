import { describe, expect, it } from "vitest";
import { ART_NAMES, editionOf, episodeInfo, isExtra, movieInfo, movieKey, parseNameYear, parseNfo, pickArt, sortTitle } from "./parse";
import { audioCodecString, probedVideo, videoCodecString } from "./codecs";

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

describe("codecs", () => {
  it("builds RFC 6381 strings", () => {
    expect(videoCodecString({ index: 0, codec_name: "h264", profile: "High", level: 41 })).toBe("avc1.640029");
    expect(videoCodecString({ index: 0, codec_name: "hevc", profile: "Main 10", level: 153, pix_fmt: "yuv420p10le" })).toBe(
      "hvc1.2.4.L153.B0",
    );
    expect(audioCodecString({ index: 1, codec_name: "aac", profile: "LC" })).toBe("mp4a.40.2");
    expect(audioCodecString({ index: 1, codec_name: "eac3" })).toBe("ec-3");
    expect(audioCodecString({ index: 1, codec_name: "dts" })).toBe("dts");
  });

  it("skips cover art and numbers tracks within their kind", () => {
    const v = probedVideo({
      format: { format_name: "matroska,webm", duration: "100.5" },
      streams: [
        { index: 0, codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
        { index: 1, codec_type: "video", codec_name: "h264", profile: "Main", level: 30, width: 1280, height: 720, color_transfer: "bt709" },
        { index: 2, codec_type: "audio", codec_name: "ac3", channels: 6, tags: { language: "eng" }, disposition: { default: 1 } },
        { index: 3, codec_type: "subtitle", codec_name: "subrip", tags: { language: "und" } },
      ],
    });
    expect(v).toMatchObject({ container: "matroska,webm", durationSec: 100.5, videoCodec: "avc1.4D401E", width: 1280, hdr: null });
    expect(v.audioTracks).toEqual([{ index: 0, codec: "ac-3", channels: 6, language: "eng", title: null, isDefault: true }]);
    expect(v.subtitleTracks[0]).toMatchObject({ index: 0, codec: "subrip", language: null });
  });
});
