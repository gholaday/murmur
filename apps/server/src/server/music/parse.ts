/**
 * Pure rules that turn a music file's tags and path into song, album and artist names.
 * No I/O here, so every rule is unit-tested in parse.test.ts.
 */

export interface TrackInfo {
  title: string;
  /** The song's own artist. */
  artist: string;
  /** Who the album is filed under. */
  albumArtist: string;
  album: string;
  trackNo: number | null;
  discNo: number | null;
  year: string | null;
  genre: string | null;
}

export const UNKNOWN_ARTIST = "Unknown artist";
export const UNKNOWN_ALBUM = "Unknown album";
export const VARIOUS_ARTISTS = "Various Artists";

/** "CD 1", "Disc 2" folders belong to the album above them. */
const DISC_FOLDER = /^(?:cd|disc|disk)\s*(\d+)$/i;
/** "01 - Song", "01. Song", "1-03 Song" (disc 1, track 3), "03 Song". */
const NUMBERED_NAME = /^(?:(\d{1,2})[-.](?=\d))?(\d{1,3})(?:\s*[-.)_]\s*|\s+)(.+)$/;

/** Lower-case, single spaces: how names are matched to tell albums and artists apart. */
export function nameKey(s: string): string {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Sorts "The Beatles" under B. */
export function sortName(name: string): string {
  return nameKey(name).replace(/^the\s+/, "");
}

const firstNumber = (s: string | undefined): number | null => {
  const m = s?.match(/\d+/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const clean = (s: string | undefined): string | null => {
  const v = s?.trim();
  return v ? v : null;
};

/** The file name without its extension. */
function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Song details from tags, falling back to the path (Artist/Album/01 - Song.mp3) for anything
 * untagged. `relPath` is relative to the music folder, with forward slashes.
 */
export function trackInfo(relPath: string, tags: Record<string, string>): TrackInfo {
  const parts = relPath.split("/");
  const file = parts.pop()!;
  let discFromFolder: number | null = null;
  const last = parts.at(-1);
  const disc = last ? DISC_FOLDER.exec(last) : null;
  if (disc) {
    discFromFolder = Number(disc[1]);
    parts.pop();
  }
  const folderAlbum = parts.at(-1) ?? null;
  const folderArtist = parts.length >= 2 ? parts.at(-2)! : null;

  const numbered = NUMBERED_NAME.exec(stem(file));
  const nameTitle = numbered ? numbered[3]!.trim() : stem(file).trim();

  const taggedArtist = clean(tags.artist);
  const taggedAlbumArtist = clean(tags.album_artist) ?? (tags.compilation === "1" ? VARIOUS_ARTISTS : null);
  const year = (tags.originaldate ?? tags.date)?.match(/\b(\d{4})\b/)?.[1] ?? null;

  return {
    title: clean(tags.title) ?? nameTitle,
    artist: taggedArtist ?? clean(tags.album_artist) ?? folderArtist ?? UNKNOWN_ARTIST,
    albumArtist: taggedAlbumArtist ?? taggedArtist ?? folderArtist ?? UNKNOWN_ARTIST,
    album: clean(tags.album) ?? folderAlbum ?? UNKNOWN_ALBUM,
    trackNo: firstNumber(tags.track) ?? (numbered ? Number(numbered[2]) : null),
    discNo: firstNumber(tags.disc) ?? discFromFolder ?? (numbered?.[1] ? Number(numbered[1]) : null),
    year,
    genre: clean(tags.genre),
  };
}
