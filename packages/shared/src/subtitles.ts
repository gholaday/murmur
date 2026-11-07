// Subtitles: reading .srt and .vtt, naming tracks and picking one, the same on the web, the app
// and the server. Every subtitle reaches a player as WebVTT from `apiPaths.videoSubtitle`, and the
// web and the app draw the line themselves, so a stream's clock never comes into it. Only the
// Chromecast draws its own, which is what `offset` on that route is for.

import { isLanguage, subtitleLanguage } from "./languages";
import { trackName, type VideoSubtitleTrack } from "./watch";

/** ffprobe's names for tracks that can become WebVTT. Others (ASS, PGS, VobSub) aren't shown yet. */
export const TEXT_SUBTITLE_CODECS = ["subrip", "webvtt", "mov_text"];

/** Files beside a video that count as its subtitles. */
export const SUBTITLE_EXTENSIONS = [".srt", ".vtt"];

/** What `storageKeys.videoSubtitle` holds to say subtitles were turned off. */
const SUBTITLES_OFF = "off";

export const SUBTITLE_ERROR = "Couldn't load subtitles";
/** How long a player waits before saying the subtitles are still being made. */
export const SUBTITLE_SLOW_MS = 2000;
/** How long a player keeps asking; a whole big file has to be read the first time. */
const SUBTITLE_WAIT_MS = 10 * 60_000;

export interface SubtitleCue {
  /** Seconds into the video. */
  start: number;
  end: number;
  /** Plain text, with a newline between lines. */
  text: string;
}

/** Bytes to text: UTF-8 or UTF-16 by their marks, UTF-8 if it's valid, else Windows-1252, as most old .srt files are. */
export function decodeSubtitle(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const TIME = String.raw`(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})`;
const TIMING = new RegExp(`^\\s*${TIME}\\s*-->\\s*${TIME}`);

const seconds = (h: string | undefined, m: string, s: string, ms: string) => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&lrm;": "", "&rlm;": "" };

/** Takes off styling: <i>, <font>, {\an8}. Positions go with it; the line always sits at the bottom. */
const plainText = (lines: string[]) =>
  lines
    .map((l) => l.replace(/<[^>]*>/g, "").replace(/\{\\[^}]*\}/g, "").replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (e) => ENTITIES[e]!).trim())
    .filter(Boolean)
    .join("\n");

/** The cues of an .srt or .vtt, in order. Blocks that aren't cues (a header, NOTE, STYLE) are skipped. */
export function parseCues(source: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const block of source.trimStart().replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => TIMING.test(l));
    if (at === -1) continue;
    const t = TIMING.exec(lines[at]!)!;
    const start = seconds(t[1], t[2]!, t[3]!, t[4]!);
    const end = seconds(t[5], t[6]!, t[7]!, t[8]!);
    const text = plainText(lines.slice(at + 1));
    if (text && end > start) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function timestamp(sec: number): string {
  const ms = Math.round(sec * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/** WebVTT for these cues, moved `offset` seconds earlier; anything before that point is left out. */
export function cuesToVtt(cues: SubtitleCue[], offset = 0): string {
  const body = cues
    .filter((c) => c.end > offset)
    .map((c) => `${timestamp(Math.max(0, c.start - offset))} --> ${timestamp(c.end - offset)}\n${c.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}`);
  return ["WEBVTT", ...body].join("\n\n") + "\n";
}

/** The lines showing at `sec`. Cues can overlap, so a few before the last one to start are looked at too. */
export function cueAt(cues: SubtitleCue[], sec: number): string {
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cues[mid]!.start <= sec) low = mid + 1;
    else high = mid;
  }
  const showing: string[] = [];
  for (let i = low - 1; i >= 0 && i >= low - 8; i--) if (cues[i]!.end > sec) showing.unshift(cues[i]!.text);
  return showing.join("\n");
}

/**
 * Fetches a track's WebVTT and parses it. The server answers 503 with Retry-After while it reads a
 * track out of the video, so that's asked again; any other failure throws what the server said.
 */
export async function loadSubtitleCues(fetchVtt: () => Promise<Response>, signal?: AbortSignal): Promise<SubtitleCue[]> {
  const until = Date.now() + SUBTITLE_WAIT_MS;
  for (;;) {
    const res = await fetchVtt();
    if (res.ok) return parseCues(await res.text());
    const wait = Number(res.headers.get("retry-after"));
    if (res.status !== 503 || !wait || Date.now() > until) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? SUBTITLE_ERROR);
    }
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    if (signal?.aborted) throw new Error(SUBTITLE_ERROR);
  }
}

// ---------- File names ----------

const DEFAULT_TAG = /^(?:default|subs?|subtitles?|full)$/i;
const SDH_TAG = /^(?:sdh|cc|hearing[ -]?impaired)$/i;

/**
 * What a subtitle's file name says, with the video's name already off the front: "en",
 * "eng.forced", "en.sdh", "2_English", "Commentary". `hi` after a language means hearing impaired,
 * as Plex reads it; alone it's Hindi.
 */
export function sidecarTags(name: string): { language: string | null; title: string | null; forced: boolean; sdh: boolean } {
  const out = { language: null as string | null, title: null as string | null, forced: false, sdh: false };
  const words = name.replace(/^\d+[_ -]/, "").split(/[._ ]+/).filter(Boolean);
  const other: string[] = [];
  for (const word of words) {
    if (/^forced$/i.test(word)) out.forced = true;
    else if (SDH_TAG.test(word) || (out.language && /^hi$/i.test(word))) out.sdh = true;
    else if (!out.language && isLanguage(word)) out.language = subtitleLanguage(word);
    else if (!DEFAULT_TAG.test(word)) other.push(word);
  }
  if (other.length) out.title = other.join(" ");
  return out;
}

// ---------- Tracks ----------

/** The file's title, unless it only says what the row already says ("English (SDH)"). */
function usefulTitle(t: VideoSubtitleTrack): string | null {
  if (!t.title) return null;
  const left = t.title.replace(/\b(?:sdh|forced|full|cc|subtitles?)\b/gi, "").replace(/[\s()[\]-]+/g, " ").trim();
  const shown = trackName({ language: t.language, title: null, index: t.index });
  return !left || left.toLowerCase() === shown.toLowerCase() ? null : t.title;
}

/** "English", "Spanish, Latin America": a subtitle row's name. */
export const subtitleName = (t: VideoSubtitleTrack) => trackName({ language: t.language, title: usefulTitle(t), index: t.index });

/** "SDH" or "Forced", on the right of a row. */
export const subtitleDetails = (t: VideoSubtitleTrack) => (t.forced ? "Forced" : t.sdh ? "SDH" : null);

/** The rows in a sheet: by name, and within a language the plain track, then SDH, then forced. */
export function subtitleRows(tracks: VideoSubtitleTrack[]): VideoSubtitleTrack[] {
  const rank = (t: VideoSubtitleTrack) => (t.forced ? 2 : t.sdh ? 1 : 0);
  return [...tracks].sort((a, b) => subtitleName(a).localeCompare(subtitleName(b)) || rank(a) - rank(b));
}

/** What to remember for a pick: its language, or the track itself when the file doesn't say. */
export const subtitleMemory = (t: VideoSubtitleTrack | null) => (t ? (t.language ?? t.id) : SUBTITLES_OFF);

/**
 * The track a video opens with: the full track for what's remembered, else a forced track in the
 * language being listened to, which covers the foreign lines. A file marking a track as its
 * default doesn't turn subtitles on by itself.
 */
export function pickSubtitle(tracks: VideoSubtitleTrack[], remembered: string | null, audioLanguage: string | null): VideoSubtitleTrack | null {
  const rows = subtitleRows(tracks);
  if (remembered && remembered !== SUBTITLES_OFF) {
    const hit = rows.find((t) => !t.forced && (t.language === remembered || t.id === remembered));
    if (hit) return hit;
  }
  const language = audioLanguage ? subtitleLanguage(audioLanguage) : null;
  return (language && rows.find((t) => t.forced && t.language === language)) || null;
}
