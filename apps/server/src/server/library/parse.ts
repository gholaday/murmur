/**
 * Pure rules that turn folder names and probed tags into book metadata.
 * No I/O here, so every rule is unit-tested in parse.test.ts.
 */

export const AUDIO_EXTENSIONS = new Set([".m4b", ".m4a", ".mp3", ".flac", ".ogg", ".opus", ".aac", ".wma"]);
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const MIME_TYPES: Record<string, string> = {
  ".m4b": "audio/mp4",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wma": "audio/x-ms-wma",
};

/** Folders created by NAS software, recycle bins and dotfiles are never part of the library. */
export function isIgnoredName(name: string): boolean {
  return name.startsWith(".") || name.startsWith("@") || name.startsWith("#") || name === "lost+found";
}

export function extname(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

export function mimeTypeFor(name: string): string {
  return MIME_TYPES[extname(name)] ?? "application/octet-stream";
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

// ---------- Folder names ----------

export interface ParsedTitleFolder {
  title: string;
  position: number | null;
  year: string | null;
}

// "2021 - Project Hail Mary" (Audiobookshelf's year prefix). Only 19xx/20xx followed by a separator.
const LEADING_YEAR = /^((?:19|20)\d{2})\s*(?:[-–—]|\.(?=\s))\s*(.+)$/;

const LEADING_LABELLED = /^(?:book|vol(?:ume)?\.?|part|#)\s*(\d{1,3}(?:\.\d+)?)\s*(?:[-–—:.)]\s*)?(.+)$/i;
// "03. Title", "3 - Title", "3) Title". A dot only counts when followed by a space, so "11.22.63" stays a title.
const LEADING_NUMBER = /^(\d{1,3}(?:\.\d)?)\s*(?:[-–—:)]|\.(?=\s))\s*(.+)$/;
const TRAILING_LABELLED = /^(.+?)[,\s]+\(?(?:book|vol(?:ume)?\.?|part)\s*(\d{1,3}(?:\.\d+)?)\)?$/i;

/** "Book 3 - 2010 - The Title" → { title: "The Title", position: 3, year: "2010" }. */
export function parseTitleFolder(folderName: string): ParsedTitleFolder {
  let name = stripNoise(folderName);
  let year: string | null = null;
  let position: number | null = null;

  const takeYear = () => {
    const y = LEADING_YEAR.exec(name);
    if (y?.[1] && y[2]) {
      year ??= y[1];
      name = y[2].trim();
    }
  };

  takeYear();
  for (const pattern of [LEADING_LABELLED, LEADING_NUMBER]) {
    const m = pattern.exec(name);
    if (m?.[1] && m[2]) {
      position = Number(m[1]);
      name = m[2].trim();
      break;
    }
  }
  if (position === null) {
    const t = TRAILING_LABELLED.exec(name);
    if (t?.[1] && t[2]) {
      position = Number(t[2]);
      name = t[1].trim();
    }
  }
  takeYear();
  return { title: name, position, year };
}

/** Removes "(Unabridged)", "(AmazonClassics Edition)", "[B0ABC12345]" ASIN tags and bracketed years. */
export function stripNoise(value: string): string {
  return value
    .replace(/[([]\s*(?:un)?abridged\s*[)\]]/gi, "")
    .replace(/[([][^)\]]*\bedition\s*[)\]]/gi, "")
    .replace(/[([]\s*B0[A-Z0-9]{8}\s*[)\]]/g, "")
    .replace(/[([]\s*(?:19|20)\d{2}\s*[)\]]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface ParsedBookPath {
  author: string | null;
  series: string | null;
  title: string;
  position: number | null;
  year: string | null;
}

/**
 * `Author/Title`, `Author/Series/Title`. Grouping always comes from folders so one
 * mis-tagged file can never split a series or an author.
 */
export function parseBookPath(relDir: string): ParsedBookPath {
  const parts = relDir.split("/").filter(Boolean);
  const titleFolder = parts.at(-1) ?? relDir;
  const { title, position, year } = parseTitleFolder(titleFolder);
  return {
    author: parts.length >= 2 ? (parts[0] ?? null) : null,
    series: parts.length >= 3 ? (parts.at(-2) ?? null) : null,
    title,
    position,
    year,
  };
}

// ---------- Tags ----------

export interface ProbedChapter {
  startSec: number;
  endSec: number;
  title: string | null;
}

export interface ProbeResult {
  durationSec: number;
  /** Lower-cased tag names, container tags merged over audio stream tags. */
  tags: Record<string, string>;
  chapters: ProbedChapter[];
  hasEmbeddedCover: boolean;
}

export interface ScannedAudioFile {
  name: string;
  relPath: string;
  size: number;
  mtimeMs: number;
  probe: ProbeResult;
}

function tag(tags: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = tags[key]?.trim();
    if (value) return value;
  }
  return null;
}

function leadingInt(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10); // "3/12" → 3
  return Number.isFinite(n) ? n : null;
}

const ASIN_PATTERN = /\b(B0[A-Z0-9]{8})\b/;

export function findAsin(relDir: string, tags: Record<string, string>): string | null {
  const fromTag = tag(tags, "asin", "audible_asin", "audibleasin");
  if (fromTag && ASIN_PATTERN.test(fromTag)) return fromTag;
  return ASIN_PATTERN.exec(relDir)?.[1] ?? null;
}

/**
 * Orders the files of a multi-file book. Disc and track tags are only trusted when
 * every file has them and no two files collide; otherwise natural filename order.
 */
export function orderAudioFiles<T extends { name: string; probe: ProbeResult }>(files: T[]): T[] {
  const keyed = files.map((f) => ({
    f,
    disc: leadingInt(tag(f.probe.tags, "disc", "discnumber")) ?? 1,
    track: leadingInt(tag(f.probe.tags, "track", "tracknumber")),
  }));
  const allTracked = keyed.every((k) => k.track !== null);
  const unique = new Set(keyed.map((k) => `${k.disc}:${k.track}`)).size === keyed.length;
  if (files.length > 1 && allTracked && unique) {
    return keyed
      .sort((a, b) => a.disc - b.disc || (a.track ?? 0) - (b.track ?? 0) || naturalCompare(a.f.name, b.f.name))
      .map((k) => k.f);
  }
  return [...files].sort((a, b) => naturalCompare(a.name, b.name));
}

// ---------- Book metadata ----------

export interface BookMetadata {
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  seriesPosition: number | null;
  description: string | null;
  year: string | null;
  asin: string | null;
  durationSec: number;
  files: Array<{ relPath: string; size: number; mtimeMs: number; durationSec: number; startSec: number; mimeType: string }>;
  chapters: Array<{ title: string; startSec: number; endSec: number }>;
}

export interface BuildInput {
  relDir: string;
  files: ScannedAudioFile[];
  descTxt?: string | null;
  readerTxt?: string | null;
}

function baseName(name: string): string {
  const ext = extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildBookMetadata({ relDir, files, descTxt, readerTxt }: BuildInput): BookMetadata {
  if (files.length === 0) throw new Error(`No audio files in ${relDir}`);
  const ordered = orderAudioFiles(files);
  const first = ordered[0]!;
  const tags = first.probe.tags;
  const fromPath = parseBookPath(relDir);
  const single = ordered.length === 1;

  // Book title: album tag (multi-file books keep the chapter in "title"), or the
  // title tag of a single-file book, else the folder name.
  const tagTitle = tag(tags, "album") ?? (single ? tag(tags, "title") : null);
  const title = (tagTitle && stripNoise(tagTitle)) || fromPath.title;

  const author = fromPath.author ?? tag(tags, "album_artist", "artist", "author");
  const narrator = clean(readerTxt) ?? tag(tags, "narrator", "narratedby", "composer");
  // Series only ever comes from folders: tags often hold publisher imprints ("The Seaside Library").
  const series = fromPath.series;
  const seriesPosition = fromPath.position;
  const description = clean(descTxt) ?? tag(tags, "description", "synopsis", "comment", "desc");
  const yearTag = tag(tags, "date", "year", "originaldate");
  const year = (yearTag ? (/\d{4}/.exec(yearTag)?.[0] ?? null) : null) ?? fromPath.year;

  let cursor = 0;
  const outFiles: BookMetadata["files"] = [];
  const chapters: BookMetadata["chapters"] = [];
  for (const f of ordered) {
    const start = cursor;
    const dur = f.probe.durationSec;
    outFiles.push({
      relPath: f.relPath,
      size: f.size,
      mtimeMs: f.mtimeMs,
      durationSec: round3(dur),
      startSec: round3(start),
      mimeType: mimeTypeFor(f.name),
    });
    if (f.probe.chapters.length > 0) {
      for (const c of f.probe.chapters) {
        chapters.push({
          title: c.title?.trim() || `Chapter ${chapters.length + 1}`,
          startSec: round3(start + c.startSec),
          endSec: round3(start + Math.min(c.endSec, dur)),
        });
      }
    } else {
      chapters.push({
        title: single ? title : (tag(f.probe.tags, "title") ?? baseName(f.name)),
        startSec: round3(start),
        endSec: round3(start + dur),
      });
    }
    cursor += dur;
  }

  return {
    title,
    author,
    narrator,
    series,
    seriesPosition: series ? seriesPosition : null,
    description,
    year,
    asin: findAsin(relDir, tags),
    durationSec: round3(cursor),
    files: outFiles,
    chapters,
  };
}

function clean(value: string | null | undefined): string | null {
  const v = value?.replace(/\r\n/g, "\n").trim();
  return v ? v : null;
}
