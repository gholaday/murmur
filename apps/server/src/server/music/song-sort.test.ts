// Sorting a playlist's songs by a column (packages/shared sortSongs).
import { sortSongs, type TrackDto } from "@murmur/shared/client";
import { expect, it } from "vitest";

const song = (id: string, title: string, album: string, trackNo: number, durationSec: number, artist = "Northern Static"): TrackDto => ({
  id,
  title,
  albumId: album,
  album,
  artistId: artist,
  artist,
  discNo: null,
  trackNo,
  durationSec,
  mimeType: "audio/mpeg",
  coverHash: null,
  inMusic: true,
});

const list = [
  song("a", "isobar", "Glass Weather", 3, 61),
  song("b", "Drift", "Paper Boats", 2, 68, "Marlow June"),
  song("c", "Track 10", "Glass Weather", 1, 54),
  song("d", "Track 9", "Night Bus", 4, 61),
];
const ids = (l: TrackDto[]) => l.map((t) => t.id).join("");

it("sorts by title, ignoring case and with numbers in order", () => {
  expect(ids(sortSongs(list, "title"))).toBe("badc");
  expect(ids(sortSongs(list, "title", true))).toBe("cdab");
});

it("keeps an album's songs in track order, and breaks length ties by title", () => {
  expect(ids(sortSongs(list, "album"))).toBe("cadb");
  expect(ids(sortSongs(list, "length"))).toBe("cadb");
  expect(ids(list)).toBe("abcd");
});
