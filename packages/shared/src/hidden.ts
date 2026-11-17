// Hiding: each person can take books, albums, artists, movies and shows out of their lists,
// shelves, search and Android Auto. Downloads and stats keep them. Hiding an artist hides
// their albums too.

import type { LibrarySection } from "./settings";

export type HiddenKind = "book" | "album" | "artist" | "movie" | "show";

/** Hide or unhide one thing (an artist by their artist id). */
export interface HiddenChange {
  kind: HiddenKind;
  id: string;
}

/** One row on You > Hidden. */
export interface HiddenItem {
  kind: HiddenKind;
  id: string;
  title: string;
  /** "Eric Carle", "Album, Kidz Bop Kids", "Artist, 6 albums", "Show, 4 seasons". */
  sub: string;
  /** Cover, photo or poster URL, or null for the placeholder. */
  image: string | null;
  /** Placeholder colour (#rrggbb), when known. */
  color: string | null;
  hiddenAt: number;
}

/** You > Hidden, by Library section, newest first in each. */
export type HiddenDto = Record<LibrarySection, HiddenItem[]>;

/** Which Library section a kind belongs to. */
export const HIDDEN_SECTION: Record<HiddenKind, LibrarySection> = {
  book: "books",
  album: "music",
  artist: "music",
  movie: "watch",
  show: "watch",
};
