import type { AlbumCandidate } from "@murmur/shared";
import { normalizeText, similarity } from "../metadata/score";

// Scoring for album Match, like books: the same album and result always get the same score,
// and each point has a reason. Albums are usually well tagged, so title, artist and song count
// do most of the work; the song count is what tells a deluxe edition from the plain one.

export interface LocalAlbum {
  title: string;
  artist: string;
  trackCount: number;
}

export type UnscoredAlbum = Omit<AlbumCandidate, "score" | "reasons">;

const WEIGHTS = { title: 40, artist: 35, tracks: 25 };

// Words that mark an edition rather than a different album.
const EDITION =
  /\s*[([][^)\]]*\b(deluxe|remaster(ed)?|edition|expanded|anniversary|bonus|version|explicit|clean|mono|stereo|reissue)\b[^)\]]*[)\]]/gi;

/** Rip and catalog numbers in square brackets: "Led Zeppelin [2156]". */
const CATALOG = /\s*\[[\d\s-]*\]/g;

/** An album title as typed into a search: no edition words or catalog numbers. */
export function searchTitle(s: string): string {
  return s.replace(EDITION, "").replace(CATALOG, "").replace(/\s+-\s+(single|ep)\s*$/i, "").trim() || s;
}

/** Album title for comparing: no "(Deluxe Edition)", "[Remastered 2011]", " - EP" or leading "The". */
export function cleanAlbumTitle(s: string): string {
  return normalizeText(searchTitle(s)).replace(/^the /, "");
}

/** Artist names compared loosely: "The Beatles" = "Beatles", "Simon & Garfunkel" = "Simon and Garfunkel". */
export function cleanArtist(s: string): string {
  return normalizeText(s).replace(/^the /, "");
}

/** Same count is full marks; one or two apart is likely bonus tracks; more is a different album. */
function trackScore(local: number, candidate: number): number {
  const off = Math.abs(local - candidate);
  return off === 0 ? 1 : off <= 2 ? 0.5 : 0;
}

export function scoreAlbum(local: LocalAlbum, c: UnscoredAlbum): AlbumCandidate {
  const reasons: string[] = [];
  let earned = 0;
  let possible = 0;
  const add = (weight: number, value: number) => {
    earned += weight * value;
    possible += weight;
  };

  const titleSim = similarity(cleanAlbumTitle(local.title), cleanAlbumTitle(c.title));
  add(WEIGHTS.title, titleSim);
  reasons.push(titleSim >= 0.95 ? "Title matches" : `Title ${Math.round(titleSim * 100)}% similar`);

  const artistSim = similarity(cleanArtist(local.artist), cleanArtist(c.artist));
  add(WEIGHTS.artist, artistSim);
  reasons.push(artistSim >= 0.9 ? "Artist matches" : `Artist differs (${c.artist})`);

  let tracks: number | null = null;
  if (c.trackCount) {
    tracks = trackScore(local.trackCount, c.trackCount);
    add(WEIGHTS.tracks, tracks);
    reasons.push(
      tracks === 1
        ? `Same number of songs (${c.trackCount})`
        : `${c.trackCount} songs, you have ${local.trackCount}${tracks > 0 ? ", likely another edition" : ""}`,
    );
  }

  let score = possible ? Math.round((earned / possible) * 100) : 0;
  // A wrong title or artist can't be outweighed by everything else agreeing.
  if (titleSim < 0.5 || artistSim < 0.5) score = Math.min(score, 60);
  // A different song count is another edition at best, so never pick it for you.
  if (tracks === null || tracks < 1) score = Math.min(score, 85);
  return { ...c, score, reasons };
}
