// The video add-on's API (`murmur-video`): Murmur asks it to read files and make streams and
// downloads, with the add-on secret as a bearer token. Internal only; players never call it.
import { z } from "zod";
import type { ProbedSubtitleTrack, VideoAudioTrack } from "./watch";

/** What ffprobe says about a video file. */
export interface ProbedVideo {
  container: string;
  durationSec: number;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  hdr: "hdr10" | "hlg" | "dolby-vision" | null;
  audioTracks: VideoAudioTrack[];
  subtitleTracks: ProbedSubtitleTrack[];
}

/** A file on the library, by the absolute path both containers mount it at. */
export const videoFileSchema = z.object({ file: z.string().min(1) });

export const videoStillSchema = videoFileSchema.extend({
  durationSec: z.number().nonnegative(),
  hdr: z.boolean(),
});

/** Text tracks to read out of a file as WebVTT, by their `0:s:N` index, all in one pass over it. */
export const videoSubtitlesSchema = videoFileSchema.extend({ tracks: z.array(z.number().int().nonnegative()).min(1) });

/** Each track's WebVTT, by index. */
export interface VideoSubtitlesDto {
  tracks: Record<string, string>;
}

/** One video and the choices for a stream or download of it. */
const videoSourceSchema = z.object({
  videoId: z.string().min(1),
  file: z.string().min(1),
  /** RFC 6381, as the file has it. */
  videoCodec: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  hdr: z.enum(["hdr10", "hlg", "dolby-vision"]).nullable(),
  /** The chosen track's RFC 6381 codec, or null when the file has no audio. */
  audioCodec: z.string().nullable(),
  track: z.number().int().nonnegative(),
  audio: z.enum(["copy", "aac"]),
  video: z.enum(["copy", "h264"]),
  quality: z.enum(["full", "light"]),
  durationSec: z.number().nonnegative(),
});
export type VideoSource = z.infer<typeof videoSourceSchema>;

/** `owner` is whoever the stream or download is for (Murmur's user id); only they can use it. */
export const videoStreamStartSchema = z.object({ owner: z.string().min(1), src: videoSourceSchema, start: z.number().nonnegative() });
export const videoDownloadStartSchema = z.object({ owner: z.string().min(1), src: videoSourceSchema });

export interface VideoStreamStarted {
  sessionId: string;
  /** Where the stream really starts: the keyframe at or before the time asked for. */
  start: number;
}

export interface VideoAddonHealth {
  ffmpeg: boolean;
  encoder: "nvenc" | "qsv" | "vaapi" | "amf" | "videotoolbox" | "cpu";
  toneMap: boolean;
  streams: number;
  downloads: number;
  version: string;
}

/** Settings' Video row: what's wrong with the add-on, or that it works and how it converts video. */
export type VideoStatus = { problem: string; working?: never } | { problem: null; working: string };

/** The header that names a stream's or download's owner on the add-on's file requests. */
export const VIDEO_OWNER_HEADER = "x-murmur-owner";

/** The port the video add-on listens on, unless VIDEO_PORT says otherwise. */
export const VIDEO_ADDON_PORT = 3001;

/** The video add-on's endpoints, as Murmur calls them. */
export const videoAddonPaths = {
  /** GET VideoAddonHealth. */
  health: "/health",
  /** POST { file }: ProbedVideo. */
  probe: "/probe",
  /** POST { file, durationSec, hdr }: a JPEG, empty when no frame could be grabbed. */
  still: "/still",
  /** POST { file, tracks }: VideoSubtitlesDto. */
  subtitles: "/subtitles",
  /** POST { owner, src, start }: VideoStreamStarted. */
  streams: "/streams",
  /** DELETE ends the stream. */
  stream: (id: string) => `/streams/${encodeURIComponent(id)}`,
  /** GET a playlist or piece of the stream. */
  streamFile: (id: string, file: string) => `/streams/${encodeURIComponent(id)}/${encodeURIComponent(file)}`,
  /** POST { owner, src }: VideoDownloadDto. */
  downloads: "/downloads",
  /** GET the finished MP4, DELETE cancels or removes it. */
  download: (id: string) => `/downloads/${encodeURIComponent(id)}`,
};

/** Response headers of a stream file or download that Murmur passes on to the player. */
export const VIDEO_PASS_THROUGH_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "retry-after"];

type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

/** Parses a single `bytes=` range. Multi-range requests are served as the whole file. */
export function parseRange(header: string | null, size: number): ByteRange {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startRaw = "", endRaw = ""] = m;
  if (startRaw === "" && endRaw === "") return "unsatisfiable";
  let start: number;
  let end: number;
  if (startRaw === "") {
    // suffix range: last N bytes
    const suffix = Number(endRaw);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
