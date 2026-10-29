// ---------- Chromecast links, shared by web and app ----------

import type { PlaybackSupport } from "./watch";

/** From POST /api/cast: put `base` in front of any API path the cast covers; it works until `expiresAt`. */
export interface CastLinkDto {
  base: string;
  expiresAt: number;
}

/**
 * The prefix a cast link must cover for an API path, as POST /api/cast takes it: a book's files
 * and a converted stream's pieces share their folder; anything else is the path itself.
 */
export function castPrefix(path: string): string {
  const bare = path.split("?")[0]!;
  if (/^\/api\/stream\/book\/[^/]+\//.test(bare) || /^\/api\/watch\/streams\/[^/]+\//.test(bare)) {
    return bare.slice(0, bare.lastIndexOf("/") + 1);
  }
  return bare;
}

/**
 * What a Chromecast plays as it is, for playbackPlan: H.264 in an MP4 with AAC, MP3, Opus, Vorbis
 * or FLAC sound. Anything else (an MKV, HEVC, surround formats) is streamed, remuxed or converted.
 */
export const CAST_SUPPORT: PlaybackSupport = {
  video: (codec) => codec.startsWith("avc1"),
  audio: (codec) => codec.startsWith("mp4a") || ["mp3", "opus", "vorbis", "flac"].includes(codec),
  container: (container) => container.startsWith("mov,mp4"),
};

/** The content type Google's player is told: a converted stream, a video file, or audio. */
export function castContentType(path: string): string {
  if (path.includes(".m3u8")) return "application/x-mpegurl";
  return path.startsWith("/api/stream/video/") ? "video/mp4" : "audio/mpeg";
}
