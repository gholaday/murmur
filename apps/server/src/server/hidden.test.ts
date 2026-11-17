import type { AlbumSummary, ArtistSummary, TrackDto, WatchCard } from "@murmur/shared";
import { expect, it } from "vitest";
import { type Hidden, visibleAlbums, visibleArtists, visibleTracks, visibleWatch } from "./hidden";

type Ids = Partial<Record<Exclude<keyof Hidden, "albumsByArtist">, string[]>>;
const hidden = (h: Ids, albumsByArtist: Record<string, number> = {}): Hidden => ({
  books: new Set(h.books),
  albums: new Set(h.albums),
  artists: new Set(h.artists),
  movies: new Set(h.movies),
  shows: new Set(h.shows),
  albumsByArtist: new Map(Object.entries(albumsByArtist)),
});

it("counts only an artist's albums you didn't hide, and drops one with none left", () => {
  const artist = (id: string, albumCount: number) => ({ id, albumCount }) as ArtistSummary;
  const h = hidden({ albums: ["x", "y", "z"] }, { ar1: 1, ar2: 2 });
  const kept = visibleArtists([artist("ar1", 3), artist("ar2", 2), artist("ar3", 1)], h);
  expect(kept.map((a) => [a.id, a.albumCount])).toEqual([
    ["ar1", 2],
    ["ar3", 1],
  ]);
});

const album = (id: string, artistId: string) => ({ id, artistId }) as AlbumSummary;
const track = (id: string, albumId: string, artistId: string) => ({ id, albumId, artistId }) as TrackDto;

it("leaves out hidden albums and every album by a hidden artist", () => {
  const h = hidden({ albums: ["a1"], artists: ["ar2"] });
  expect(visibleAlbums([album("a1", "ar1"), album("a2", "ar2"), album("a3", "ar1")], h).map((a) => a.id)).toEqual(["a3"]);
});

it("leaves out songs on hidden albums and songs by a hidden artist, even on others' albums", () => {
  // hiddenFor puts a hidden artist's albums in `albums` too, so a compilation song by them goes by its own artist.
  const h = hidden({ albums: ["a1"], artists: ["ar2"] });
  const kept = visibleTracks([track("t1", "a1", "ar1"), track("t2", "a3", "ar2"), track("t3", "a3", "ar1")], h);
  expect(kept.map((t) => t.id)).toEqual(["t3"]);
});

it("takes an episode out with its hidden show, and a movie on its own", () => {
  const h = hidden({ movies: ["m1"], shows: ["s1"] });
  const cards = [
    { id: "m1", kind: "movie", showId: null },
    { id: "m2", kind: "movie", showId: null },
    { id: "e1", kind: "episode", showId: "s1" },
    { id: "e2", kind: "episode", showId: "s2" },
  ] as WatchCard[];
  expect(visibleWatch(cards, h).map((c) => c.id)).toEqual(["m2", "e2"]);
});
