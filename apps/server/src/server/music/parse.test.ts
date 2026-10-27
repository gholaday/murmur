import { describe, expect, it } from "vitest";
import { nameKey, sortName, trackInfo, UNKNOWN_ALBUM, UNKNOWN_ARTIST, VARIOUS_ARTISTS } from "./parse";

describe("trackInfo", () => {
  it("takes everything from tags when they're there", () => {
    const t = trackInfo("x/y/song.flac", {
      title: "Let It Happen",
      artist: "Tame Impala",
      album: "Currents",
      track: "1/13",
      disc: "1",
      date: "2015-07-17",
      genre: "Psychedelic",
    });
    expect(t).toEqual({
      title: "Let It Happen",
      artist: "Tame Impala",
      albumArtist: "Tame Impala",
      album: "Currents",
      trackNo: 1,
      discNo: 1,
      year: "2015",
      genre: "Psychedelic",
    });
  });

  it("files a featured song under the album artist", () => {
    const t = trackInfo("a.mp3", { title: "Song", artist: "Daft Punk feat. Pharrell", album_artist: "Daft Punk", album: "RAM" });
    expect([t.artist, t.albumArtist]).toEqual(["Daft Punk feat. Pharrell", "Daft Punk"]);
  });

  it("files a compilation with no album artist under Various Artists", () => {
    const t = trackInfo("a.mp3", { title: "Song", artist: "Someone", album: "Hits", compilation: "1" });
    expect([t.artist, t.albumArtist]).toEqual(["Someone", VARIOUS_ARTISTS]);
  });

  it("reads untagged files from Artist/Album/01 - Song", () => {
    const t = trackInfo("Radiohead/In Rainbows/03 - Nude.mp3", {});
    expect(t).toMatchObject({ title: "Nude", artist: "Radiohead", albumArtist: "Radiohead", album: "In Rainbows", trackNo: 3, discNo: null });
  });

  it("treats a disc folder as part of the album above it", () => {
    const t = trackInfo("Pink Floyd/The Wall/CD 2/01. Hey You.flac", {});
    expect(t).toMatchObject({ title: "Hey You", artist: "Pink Floyd", album: "The Wall", trackNo: 1, discNo: 2 });
  });

  it("reads disc and track from a 1-03 file name", () => {
    expect(trackInfo("A/B/2-07 Song.mp3", {})).toMatchObject({ discNo: 2, trackNo: 7, title: "Song" });
  });

  it("leaves a name that only starts with a year alone", () => {
    expect(trackInfo("A/B/1999.mp3", {})).toMatchObject({ title: "1999", trackNo: null });
  });

  it("falls back to unknown for a loose file", () => {
    expect(trackInfo("song.mp3", {})).toMatchObject({ title: "song", artist: UNKNOWN_ARTIST, album: UNKNOWN_ALBUM });
  });
});

describe("names", () => {
  it("matches names however they're spaced or cased", () => {
    expect(nameKey("  The  Beatles ")).toBe(nameKey("the beatles"));
  });

  it("sorts without a leading The", () => {
    expect(sortName("The Beatles")).toBe("beatles");
    expect(sortName("Theory of a Deadman")).toBe("theory of a deadman");
  });
});
