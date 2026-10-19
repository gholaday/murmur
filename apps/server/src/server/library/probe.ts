import fs, { type FileHandle } from "node:fs/promises";
import { type IAudioMetadata, type IChapter, type IOptions, parseFromTokenizer } from "music-metadata";
import { AbstractTokenizer, EndOfStreamError, type IRandomAccessFileInfo, type IReadChunkOptions } from "strtok3";
import type { ProbedChapter, ProbeResult } from "./parse";

/**
 * music-metadata's own file reader treats any short read as the end of the file. Network
 * mounts (SMB, NFS, Docker Desktop's) often return less than asked on big reads, which made
 * large .m4b files fail with "End-Of-Stream". This one keeps reading until the chunk is full.
 */
class FullReadTokenizer extends AbstractTokenizer {
  private constructor(
    private readonly fh: FileHandle,
    public fileInfo: IRandomAccessFileInfo,
  ) {
    super();
  }

  static async open(file: string): Promise<FullReadTokenizer> {
    const fh = await fs.open(file, "r");
    try {
      const { size } = await fh.stat();
      return new FullReadTokenizer(fh, { path: file, size });
    } catch (error) {
      await fh.close();
      throw error;
    }
  }

  private async fill(buffer: Uint8Array, options?: IReadChunkOptions): Promise<number> {
    const { length, position } = this.normalizeOptions(buffer, options);
    let got = 0;
    while (got < length) {
      const { bytesRead } = await this.fh.read(buffer, got, length - got, position + got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    if (got < length && !options?.mayBeLess) throw new EndOfStreamError();
    return got;
  }

  async readBuffer(buffer: Uint8Array, options?: IReadChunkOptions): Promise<number> {
    this.position = this.normalizeOptions(buffer, options).position;
    const got = await this.fill(buffer, options);
    this.position += got;
    return got;
  }

  peekBuffer(buffer: Uint8Array, options?: IReadChunkOptions): Promise<number> {
    return this.fill(buffer, options);
  }

  async close() {
    await this.fh.close();
    return super.close();
  }

  setPosition(position: number) {
    this.position = position;
  }

  supportsRandomAccess() {
    return true;
  }
}

async function parseFile(file: string, options: IOptions): Promise<IAudioMetadata> {
  const tokenizer = await FullReadTokenizer.open(file);
  try {
    return await parseFromTokenizer(tokenizer, options);
  } finally {
    await tokenizer.close();
  }
}

/**
 * Tag readers name things differently per format (ID3 "TXXX:ASIN", MP4 "----:com.apple.iTunes:ASIN",
 * Vorbis "ASIN"). Strip those prefixes and lower-case, so the scanner can ask for "asin" or
 * "narrator" without caring which container the book came in.
 */
function nativeKey(id: string): string {
  return id.replace(/^----:[^:]*:/, "").replace(/^(TXXX|WXXX|COMM)[:\s]*/i, "").replace(/^©/, "").toLowerCase();
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return null;
}

/** Lower-cased tag names, the same names ffprobe used: native tags with the common ones on top. */
function flattenTags(meta: IAudioMetadata): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const list of Object.values(meta.native)) {
    for (const t of list) {
      const text = textOf(t.value)?.trim();
      const key = nativeKey(t.id);
      if (text && key && !(key in tags)) tags[key] = text;
    }
  }
  const c = meta.common;
  const set = (key: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && String(value).trim()) tags[key] = String(value).trim();
  };
  set("title", c.title);
  set("album", c.album);
  set("artist", c.artist);
  set("album_artist", c.albumartist);
  set("composer", c.composer?.join(", "));
  set("date", c.date ?? c.year);
  set("originaldate", c.originaldate);
  set("track", c.track.no);
  set("disc", c.disk.no);
  set("comment", textOf(c.comment?.[0]));
  set("description", c.longDescription ?? c.description?.join("\n"));
  return tags;
}

function chapterSeconds(c: IChapter, at: "start" | "end", sampleRate: number | undefined): number | null {
  const value = at === "start" ? c.start : c.end;
  if (value === undefined) return null;
  if (c.timeScale) return value / c.timeScale;
  if (at === "start" && c.sampleOffset !== undefined && sampleRate) return c.sampleOffset / sampleRate;
  return value / 1000;
}

function chaptersOf(meta: IAudioMetadata, durationSec: number): ProbedChapter[] {
  const list = meta.format.chapters ?? [];
  const starts = list.map((c) => chapterSeconds(c, "start", meta.format.sampleRate) ?? 0);
  return list
    .map((c, i) => ({
      startSec: starts[i]!,
      // Not every format stores chapter ends; a chapter then runs to the next one.
      endSec: chapterSeconds(c, "end", meta.format.sampleRate) ?? starts[i + 1] ?? durationSec,
      title: c.title?.trim() || null,
    }))
    .filter((c) => Number.isFinite(c.startSec) && c.endSec > c.startSec);
}

const BASE: IOptions = { includeChapters: true, skipPostHeaders: true };

/**
 * A constant-bitrate MP3's length from its audio bytes, the way ffprobe works it out.
 * music-metadata counts a few seconds short on such files (1705s for one that decodes to
 * 1708s), and across a 13-file book that adds up. VBR files carry an exact frame count,
 * so this is only used for CBR.
 */
async function cbrMp3Seconds(file: string, bitrate: number): Promise<number | null> {
  const fh = await fs.open(file, "r");
  try {
    const { size } = await fh.stat();
    const head = Buffer.alloc(10);
    await fh.read(head, 0, 10, 0);
    let skip = 0;
    if (head.toString("latin1", 0, 3) === "ID3") {
      // Syncsafe size, plus the footer when the flag says there is one.
      skip = 10 + (((head[6]! & 127) << 21) | ((head[7]! & 127) << 14) | ((head[8]! & 127) << 7) | (head[9]! & 127));
      if (head[5]! & 0x10) skip += 10;
    }
    const tail = Buffer.alloc(128);
    if (size > 128) await fh.read(tail, 0, 128, size - 128);
    const v1 = tail.toString("latin1", 0, 3) === "TAG" ? 128 : 0;
    const bytes = size - skip - v1;
    return bytes > 0 ? (bytes * 8) / bitrate : null;
  } finally {
    await fh.close();
  }
}

/**
 * Reads duration, tags and chapters in-process, with no ffmpeg. Only the headers are read
 * unless a file's length isn't stored (some MP3s), which then takes one full pass.
 */
export async function probeFile(file: string): Promise<ProbeResult> {
  // Covers are read here only to learn whether one exists (skipping them drops that too);
  // the bytes are dropped with the result and fetched again just for the one file used.
  const first = await parseFile(file, BASE);
  const meta = first.format.duration ? first : await parseFile(file, { ...BASE, skipCovers: true, duration: true });
  const { container, codecProfile, bitrate } = meta.format;
  const cbr = container === "MPEG" && codecProfile === "CBR" && bitrate ? await cbrMp3Seconds(file, bitrate) : null;
  const durationSec = cbr ?? meta.format.duration ?? 0;
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("couldn't tell how long this file is");
  return {
    durationSec,
    tags: flattenTags(meta),
    chapters: chaptersOf(meta, durationSec),
    hasEmbeddedCover: !!first.common.picture?.length,
  };
}

/** The audio file's own cover image, as stored (usually JPEG or PNG). */
export async function extractEmbeddedCover(file: string): Promise<Buffer | null> {
  try {
    const meta = await parseFile(file, { skipPostHeaders: true });
    const picture = meta.common.picture?.find((p) => /front|cover/i.test(p.type ?? "")) ?? meta.common.picture?.[0];
    return picture ? Buffer.from(picture.data) : null;
  } catch {
    return null;
  }
}

/** Runs async tasks with at most `limit` in flight, so a large import can't swamp the NAS. */
export function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit) return;
    const start = queue.shift();
    if (start) start();
  };
  return function limited<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
