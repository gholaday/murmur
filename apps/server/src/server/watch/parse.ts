/**
 * Pure rules that turn movie and show paths (Plex naming) and .nfo files into titles, years,
 * seasons and episode numbers. No I/O here, so every rule is unit-tested in parse.test.ts.
 */
import { XMLParser } from "fast-xml-parser";
import { extname } from "../library/parse";

export const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".m4v", ".mov", ".webm", ".avi", ".ts"]);

export const isVideoFile = (name: string) => VIDEO_EXTENSIONS.has(extname(name));

const VIDEO_MIME_TYPES: Record<string, string> = {
  ".mkv": "video/x-matroska",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".ts": "video/mp2t",
};

export const videoMimeType = (name: string) => VIDEO_MIME_TYPES[extname(name)] ?? "application/octet-stream";

/** Folders of extras, skipped wherever they sit. */
const EXTRA_FOLDERS = new Set([
  "extras",
  "featurettes",
  "behind the scenes",
  "deleted scenes",
  "interviews",
  "scenes",
  "samples",
  "sample",
  "shorts",
  "trailers",
  "other",
]);
/** Plex's extra suffixes on a file name: "Movie (2019)-trailer.mp4". */
const EXTRA_SUFFIX = /-(?:trailer|sample|behindthescenes|deleted|featurette|interview|scene|short|other)$/i;

/** The file name without its extension. */
export function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Trailers, samples and other extras: not movies or episodes in their own right. */
export function isExtra(relPath: string): boolean {
  const parts = relPath.split("/");
  const file = stem(parts.pop()!);
  if (parts.some((p) => EXTRA_FOLDERS.has(p.toLowerCase()))) return true;
  return EXTRA_SUFFIX.test(file) || file.toLowerCase() === "sample";
}

/** Release tags that end a scene-style name: "Movie.2019.1080p.BluRay.x264". */
const QUALITY = /\b(?:2160p|1080p|1080i|720p|576p|480p|4k|uhd|bluray|blu-ray|bdrip|brrip|web-?dl|webrip|hdtv|dvdrip|remux|x264|x265|h\.?264|h\.?265|hevc|hdr|hdr10|10bit|proper|repack)\b.*$/i;
const YEAR = /\b(?:19|20)\d{2}\b/g;

export interface NameYear {
  title: string;
  year: string | null;
}

/**
 * "The Long Field (2019)", "The.Long.Field.2019.1080p.BluRay", "Alien (1979) {tmdb-348}".
 * A year in brackets wins; otherwise the last year-like number that isn't the whole start
 * of the name, so "Blade Runner 2049 (2017)" and "Blade.Runner.2049.2017" both work.
 */
export function parseNameYear(raw: string): NameYear {
  let name = raw.replace(/\{[^}]*\}/g, " ").replace(/\[[^\]]*\]/g, " ");
  // Dots or underscores for spaces only when there are no real spaces.
  if (!/\s/.test(name.trim())) name = name.replace(/[._]+/g, " ");
  name = name.replace(/\s+/g, " ").trim();

  const bracketed = [...name.matchAll(/\(((?:19|20)\d{2})\)/g)].at(-1);
  if (bracketed) {
    const title = name.slice(0, bracketed.index).trim();
    if (title) return { title: tidy(title), year: bracketed[1]! };
  }

  const cut = name.replace(QUALITY, "").trim() || name;
  const years = [...cut.matchAll(YEAR)].filter((m) => m.index! > 0);
  const last = years.at(-1);
  if (last) {
    const title = cut.slice(0, last.index).trim();
    if (title) return { title: tidy(title), year: last[0] };
  }
  return { title: tidy(cut), year: null };
}

/** Trailing separators left once a year or tag is cut off: "Movie -" or "Movie (". */
const tidy = (s: string) => s.replace(/[\s\-–(]+$/, "").trim();

/** For sorting: lower case, without a leading "The", "A" or "An". */
export function sortTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/, "")
    .trim();
}

/**
 * A movie's title and year. Usually from its folder ("Title (Year)/Title (Year).mkv"); from the
 * file name when the file is loose (see movieKey), or when only the file name has a year.
 */
export function movieInfo(relPath: string): NameYear {
  const parts = relPath.split("/");
  const fromFile = parseNameYear(stem(parts.at(-1)!));
  if (movieKey(relPath) === relPath) return fromFile;
  const fromFolder = parseNameYear(parts.at(-2)!);
  if (!fromFolder.year && fromFile.year) return fromFile;
  return fromFolder;
}

const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Which movie a file belongs to: its folder when that's a movie's folder (it has a year, or the
 * file is named after it), else the file itself, so a loose file or a "Sci-fi" folder of loose
 * files is a movie per file. Every video in a movie's folder is a version of that movie.
 */
export function movieKey(relPath: string): string {
  const parts = relPath.split("/");
  if (parts.length === 1) return relPath;
  const folder = parts.at(-2)!;
  const named = parseNameYear(folder);
  const fileTitle = loose(parseNameYear(stem(parts.at(-1)!)).title);
  const isMovieFolder = named.year !== null || (fileTitle !== "" && fileTitle.startsWith(loose(named.title)));
  return isMovieFolder ? parts.slice(0, -1).join("/") : relPath;
}

/** Edition names found in file names, longest first so "Extended Cut" wins over "Extended". */
const EDITIONS = [
  "Despecialized Edition",
  "Director's Cut",
  "Directors Cut",
  "Extended Edition",
  "Extended Cut",
  "Theatrical Cut",
  "Theatrical Edition",
  "Ultimate Cut",
  "Ultimate Edition",
  "Final Cut",
  "Special Edition",
  "Anniversary Edition",
  "Criterion",
  "Unrated",
  "Extended",
  "Theatrical",
  "Remastered",
  "IMAX",
];

/**
 * A version's edition, to tell versions of one movie apart: Plex's `{edition-Director's Cut}`,
 * else the first known edition name in the file name ("Despecialized Edition", "IMAX").
 */
export function editionOf(fileName: string): string | null {
  const plex = /\{edition-([^}]+)\}/i.exec(fileName);
  if (plex) return plex[1]!.trim();
  const spaced = ` ${stem(fileName).replace(/[._]+/g, " ")} `.toLowerCase();
  const hit = EDITIONS.find((e) => spaced.includes(` ${e.toLowerCase()} `));
  return hit === "Directors Cut" ? "Director's Cut" : (hit ?? null);
}

export interface EpisodeInfo {
  /** The show's folder, relative to the shows folder. */
  showPath: string;
  season: number;
  episode: number;
  title: string;
}

const SXXEYY = /\bS(\d{1,3})[\s._-]*E(\d{1,4})(?:[\s._-]*-?E?\d{1,4})*\b/i;
const NXNN = /\b(\d{1,2})x(\d{2,3})\b/i;
const SEASON_FOLDER = /^(?:season|series|staffel|saison|temporada)[\s._-]*(\d{1,3})$/i;
const SPECIALS_FOLDER = /^specials?$/i;
const LEADING_NUMBER = /^(?:e|ep|episode)?[\s._-]*(\d{1,4})\b/i;

/**
 * An episode's show, season and number. The number comes from "S02E04" in the file name, else
 * "2x04", else a "Season 02" or "Specials" folder plus a leading number. Null when none fit.
 */
export function episodeInfo(relPath: string): EpisodeInfo | null {
  const parts = relPath.split("/");
  if (parts.length < 2) return null;
  const showPath = parts[0]!;
  const file = stem(parts.at(-1)!);
  const folders = parts.slice(1, -1);

  let season: number | null = null;
  let episode: number | null = null;
  let rest = "";
  const m = SXXEYY.exec(file) ?? NXNN.exec(file);
  if (m) {
    season = Number(m[1]);
    episode = Number(m[2]);
    rest = file.slice(m.index + m[0].length);
  } else {
    for (const f of folders) {
      const s = SEASON_FOLDER.exec(f);
      if (s) season = Number(s[1]);
      else if (SPECIALS_FOLDER.test(f)) season = 0;
    }
    const n = season === null ? null : LEADING_NUMBER.exec(file);
    if (n) {
      episode = Number(n[1]);
      rest = file.slice(n.index + n[0].length);
    }
  }
  if (season === null || episode === null) return null;

  if (!/\s/.test(rest.trim())) rest = rest.replace(/[._]+/g, " ");
  const title = rest
    .replace(/\[[^\]]*\]/g, " ")
    .replace(QUALITY, "")
    .replace(/^[\s\-–.:_]+/, "")
    .replace(/[\s\-–]+$/, "")
    .trim();
  return { showPath, season, episode, title: title || `Episode ${episode}` };
}

/** Image names for each picture, best first. `fileStem` is the video's name without extension. */
export const ART_NAMES = {
  poster: (fileStem: string | null) => [...(fileStem ? [`${fileStem}-poster`] : []), "poster", "folder", "cover"],
  backdrop: (fileStem: string | null) => [...(fileStem ? [`${fileStem}-fanart`] : []), "fanart", "backdrop", "background"],
};

/** The first of `wanted` (names without extension, any case) among `names`. */
export function pickArt(names: string[], wanted: string[]): string | null {
  for (const w of wanted) {
    const hit = names.find((n) => stem(n).toLowerCase() === w.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

export interface NfoInfo {
  title: string | null;
  year: string | null;
  plot: string | null;
}

const nfoParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

/** Kodi-style .nfo (movie, tvshow or episodedetails). Null when it isn't XML, as some are just a link. */
export function parseNfo(text: string): NfoInfo | null {
  if (!text.trimStart().startsWith("<")) return null;
  let doc: Record<string, unknown>;
  try {
    doc = nfoParser.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const root = (doc.movie ?? doc.tvshow ?? doc.episodedetails) as Record<string, unknown> | undefined;
  if (!root || typeof root !== "object") return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
  const year = str(root.year) ?? str(root.premiered)?.match(/^(\d{4})/)?.[1] ?? str(root.aired)?.match(/^(\d{4})/)?.[1] ?? null;
  return { title: str(root.title), year, plot: str(root.plot) ?? str(root.outline) };
}
