import fs from "node:fs/promises";
import type { ChapterDto } from "@murmur/shared";
import type { Sqlite } from "../db";
import { errorMessage, type Logger } from "../log";
import { readCapped, safeFetch } from "../safe-fetch";

/**
 * An episode's chapters, from the first of three places that has them: the feed itself (Podlove
 * `<psc:chapters>`), the feed's Podcasting 2.0 chapters file (`<podcast:chapters>`), or ID3 CHAP
 * frames at the start of the audio. Ends are filled in when served, once the length is known.
 */
export interface RawChapter {
  startSec: number;
  title: string;
  endSec?: number;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_CHAPTERS_FILE_BYTES = 1024 * 1024;
/** Enough for an ID3 tag's header and its chapter frames in most files. */
const ID3_FIRST_READ = 256 * 1024;
/** A tag with large embedded artwork can run to a few MB; past this, chapters aren't worth the download. */
const MAX_ID3_BYTES = 8 * 1024 * 1024;
const MAX_CHAPTERS = 500;

// ---------- Parsing ----------

/** "01:02:03.500", "62:03", "3723" or "3723.5" as seconds; 0 is a valid start. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = value.trim().split(":").map(Number);
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

const cleanTitle = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 300) : "");

/** Podlove Simple Chapters, already parsed from the feed's XML: `<psc:chapter start="…" title="…"/>`. */
export function parsePscChapters(nodes: unknown): RawChapter[] {
  const list = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
  const out: RawChapter[] = [];
  for (const n of list) {
    if (!n || typeof n !== "object") continue;
    const node = n as Record<string, unknown>;
    const startSec = parseClock(typeof node["@_start"] === "string" ? node["@_start"] : null);
    if (startSec === null) continue;
    out.push({ startSec, title: cleanTitle(node["@_title"]) });
  }
  return out;
}

/** A Podcasting 2.0 JSON chapters file. Entries with `toc: false` only change the artwork, so they're left out. */
export function parseJsonChapters(data: unknown): RawChapter[] {
  const list = (data as { chapters?: unknown } | null)?.chapters;
  if (!Array.isArray(list)) return [];
  const out: RawChapter[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const entry = c as Record<string, unknown>;
    if (entry.toc === false) continue;
    const startSec = typeof entry.startTime === "number" ? entry.startTime : Number(entry.startTime);
    if (!Number.isFinite(startSec) || startSec < 0) continue;
    const endSec = typeof entry.endTime === "number" && entry.endTime > startSec ? entry.endTime : undefined;
    out.push({ startSec, title: cleanTitle(entry.title), ...(endSec ? { endSec } : {}) });
  }
  return out;
}

const synchsafe = (b: Buffer, at: number) => ((b[at]! & 0x7f) << 21) | ((b[at + 1]! & 0x7f) << 14) | ((b[at + 2]! & 0x7f) << 7) | (b[at + 3]! & 0x7f);

/** The whole ID3v2 tag's length in bytes, header included, or 0 when the data doesn't start with one. */
export function id3TagLength(buf: Buffer): number {
  if (buf.length < 10 || buf.toString("latin1", 0, 3) !== "ID3") return 0;
  const footer = buf[5]! & 0x10 ? 10 : 0;
  return 10 + synchsafe(buf, 6) + footer;
}

/** An ID3 text frame's value: an encoding byte, then the text, maybe null-terminated. */
function id3Text(body: Buffer): string {
  if (body.length < 1) return "";
  const enc = body[0];
  let data = body.subarray(1);
  let text: string;
  if (enc === 1 || enc === 2) {
    // UTF-16: with a byte-order mark (1) or big-endian without one (2).
    let bigEndian = enc === 2;
    if (enc === 1 && data.length >= 2) {
      if (data[0] === 0xfe && data[1] === 0xff) bigEndian = true;
      if ((data[0] === 0xfe && data[1] === 0xff) || (data[0] === 0xff && data[1] === 0xfe)) data = data.subarray(2);
    }
    const even = Buffer.from(data.subarray(0, data.length - (data.length % 2)));
    if (bigEndian) even.swap16();
    text = even.toString("utf16le");
  } else {
    text = data.toString(enc === 3 ? "utf8" : "latin1");
  }
  return text.replace(/\0[\s\S]*$/, "");
}

interface Frame {
  id: string;
  body: Buffer;
}

/** The frames in `buf` from `at` on. v2.4 sizes are synchsafe, v2.3 sizes plain. */
function readFrames(buf: Buffer, at: number, end: number, version: number): Frame[] {
  const frames: Frame[] = [];
  while (at + 10 <= end) {
    const id = buf.toString("latin1", at, at + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding, or the end of what was read
    const size = version === 4 ? synchsafe(buf, at + 4) : buf.readUInt32BE(at + 4);
    const start = at + 10;
    if (size <= 0 || start + size > end) break;
    frames.push({ id, body: buf.subarray(start, start + size) });
    at = start + size;
  }
  return frames;
}

/**
 * ID3v2.3 and v2.4 CHAP frames: an element id, start and end times in ms, then sub-frames, of
 * which TIT2 is the title. A tag unsynchronised as a whole (rare, and v2.3-only) is skipped.
 */
export function parseId3Chapters(buf: Buffer): RawChapter[] {
  const length = id3TagLength(buf);
  if (!length) return [];
  const version = buf[3]!;
  const flags = buf[5]!;
  if ((version !== 3 && version !== 4) || flags & 0x80) return [];
  const end = Math.min(buf.length, length);
  let at = 10;
  if (flags & 0x40) at += version === 4 ? synchsafe(buf, 10) : 4 + buf.readUInt32BE(10);
  const out: RawChapter[] = [];
  for (const frame of readFrames(buf, at, end, version)) {
    if (frame.id !== "CHAP") continue;
    const zero = frame.body.indexOf(0);
    if (zero < 0 || zero + 17 > frame.body.length) continue;
    const startMs = frame.body.readUInt32BE(zero + 1);
    const endMs = frame.body.readUInt32BE(zero + 5);
    const sub = readFrames(frame.body, zero + 17, frame.body.length, version);
    const title = sub.find((f) => f.id === "TIT2");
    out.push({
      startSec: startMs / 1000,
      title: cleanTitle(title ? id3Text(title.body) : ""),
      ...(endMs > startMs && endMs !== 0xffffffff ? { endSec: endMs / 1000 } : {}),
    });
  }
  return out;
}

/**
 * Chapters as the players use them: in order, without duplicate starts, each ending where the next
 * begins (or at its own end, or the episode's). Fewer than two chapters is none.
 */
export function toChapterDtos(raw: RawChapter[], durationSec: number | null): ChapterDto[] {
  const sorted = raw
    .filter((c) => Number.isFinite(c.startSec) && c.startSec >= 0 && (!durationSec || c.startSec < durationSec))
    .sort((a, b) => a.startSec - b.startSec)
    .filter((c, i, all) => i === 0 || c.startSec - all[i - 1]!.startSec >= 1)
    .slice(0, MAX_CHAPTERS);
  if (sorted.length < 2) return [];
  return sorted.map((c, i) => {
    const next = sorted[i + 1]?.startSec;
    const end = next ?? (durationSec && durationSec > c.startSec ? durationSec : (c.endSec ?? c.startSec + 1));
    return { index: i, title: c.title || `Chapter ${i + 1}`, startSec: c.startSec, endSec: end };
  });
}

// ---------- Looking them up ----------

interface Deps {
  sqlite: Sqlite;
  log: Logger;
  version: string;
  /** The finished cached copy of an episode's audio, when there is one, so the tags are read from disk. */
  cachedFile: (episodeId: string) => string | null;
}

interface EpisodeRow {
  id: string;
  audio_url: string;
  mime_type: string | null;
  duration_sec: number | null;
  chapters_url: string | null;
  chapters: string | null;
}

export function createChapterFinder(deps: Deps) {
  const { sqlite, log } = deps;
  const inFlight = new Map<string, Promise<RawChapter[] | null>>();
  const headers = { "User-Agent": `Murmur/${deps.version} (self-hosted podcast player)` };

  const row = (id: string) =>
    sqlite.prepare("SELECT id, audio_url, mime_type, duration_sec, chapters_url, chapters FROM episodes WHERE id = ?").get(id) as
      | EpisodeRow
      | undefined;

  async function fromChaptersFile(url: string): Promise<RawChapter[]> {
    const res = await safeFetch(url, { headers: { ...headers, Accept: "application/json+chapters, application/json;q=0.9" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`chapters file answered ${res.status}`);
    }
    return parseJsonChapters(JSON.parse((await readCapped(res, MAX_CHAPTERS_FILE_BYTES, "The chapters file")).toString("utf8")));
  }

  /** The first `bytes` of the audio, from the cached copy or a range request to the publisher. */
  async function audioStart(ep: EpisodeRow, bytes: number): Promise<Buffer> {
    const file = deps.cachedFile(ep.id);
    if (file) {
      const handle = await fs.open(file, "r");
      try {
        const buf = Buffer.alloc(bytes);
        const { bytesRead } = await handle.read(buf, 0, bytes, 0);
        return buf.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    }
    const res = await safeFetch(ep.audio_url, { headers: { ...headers, Range: `bytes=0-${bytes - 1}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`audio answered ${res.status}`);
    }
    // A server that ignores Range sends the whole file: read only what's needed, then stop.
    if (!res.body) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
      total += chunk.length;
      if (total >= bytes) break;
    }
    await res.body.cancel().catch(() => undefined);
    return Buffer.concat(chunks).subarray(0, bytes);
  }

  async function fromId3(ep: EpisodeRow): Promise<RawChapter[]> {
    // ID3 is an MP3 thing; M4A chapters live elsewhere in the file and aren't read.
    if (ep.mime_type && ep.mime_type !== "audio/mpeg" && ep.mime_type !== "audio/mp3") return [];
    let buf = await audioStart(ep, ID3_FIRST_READ);
    const length = id3TagLength(buf);
    if (!length) return [];
    if (length > buf.length && length <= MAX_ID3_BYTES) buf = await audioStart(ep, length);
    return parseId3Chapters(buf);
  }

  /** Looks the chapters up and saves what it found, or null when a source couldn't be reached (asked again later). */
  async function lookUp(ep: EpisodeRow): Promise<RawChapter[] | null> {
    let unreachable = false;
    const attempt = async (source: string, read: () => Promise<RawChapter[]>) => {
      try {
        return await read();
      } catch (err) {
        unreachable = true;
        log.warn("episode chapters not read", { episodeId: ep.id, source, error: errorMessage(err) });
        return [];
      }
    };
    let found: RawChapter[] = [];
    if (ep.chapters_url) found = await attempt("chapters file", () => fromChaptersFile(ep.chapters_url!));
    if (toChapterDtos(found, ep.duration_sec).length === 0) found = await attempt("id3", () => fromId3(ep));
    // Nothing found because a source was down isn't "no chapters": leave it to be asked again.
    if (toChapterDtos(found, ep.duration_sec).length === 0 && unreachable) return null;
    sqlite.prepare("UPDATE episodes SET chapters = ? WHERE id = ?").run(JSON.stringify(found), ep.id);
    return found;
  }

  /** An episode's chapters, looked up the first time they're wanted. Never throws: no chapters is a fine answer. */
  async function get(episodeId: string): Promise<ChapterDto[]> {
    const ep = row(episodeId);
    if (!ep) return [];
    let raw: RawChapter[] | null = ep.chapters ? (JSON.parse(ep.chapters) as RawChapter[]) : null;
    if (!raw) {
      let pending = inFlight.get(episodeId);
      if (!pending) {
        pending = lookUp(ep).finally(() => inFlight.delete(episodeId));
        inFlight.set(episodeId, pending);
      }
      raw = (await pending) ?? [];
    }
    return toChapterDtos(raw, ep.duration_sec);
  }

  /** Looks up the newest episodes' chapters ahead of time, a few at once, so they're there when played. */
  async function prefetch(podcastId: string, count = 3) {
    const ids = sqlite
      .prepare("SELECT id FROM episodes WHERE podcast_id = ? AND chapters IS NULL ORDER BY published_at DESC LIMIT ?")
      .all(podcastId, count) as { id: string }[];
    for (const { id } of ids) await get(id);
  }

  return { get, prefetch };
}

export type ChapterFinder = ReturnType<typeof createChapterFinder>;
