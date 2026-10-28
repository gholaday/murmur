/**
 * Turns ffprobe's JSON into what a player needs: RFC 6381 codec strings (the form
 * `MediaSource.isTypeSupported` takes), resolution, HDR and the tracks. Pure, tested in codecs.test.ts.
 */
import type { VideoAudioTrack, VideoSubtitleTrack } from "@murmur/shared";

export interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  codec_tag_string?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  color_transfer?: string;
  channels?: number;
  disposition?: { default?: number; forced?: number; attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: Array<{ side_data_type?: string }>;
}

export interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
}

export interface ProbedVideo {
  container: string;
  durationSec: number;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  hdr: "hdr10" | "hlg" | "dolby-vision" | null;
  audioTracks: VideoAudioTrack[];
  subtitleTracks: VideoSubtitleTrack[];
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
const pad2 = (n: number) => String(n).padStart(2, "0");

function bitDepth(s: FfprobeStream): number {
  const raw = Number(s.bits_per_raw_sample);
  if (raw > 0) return raw;
  const m = s.pix_fmt?.match(/p(\d{2})(?:le|be)$/);
  return m ? Number(m[1]) : 8;
}

/** profile_idc and constraint flags for each H.264 profile name ffprobe prints. */
const AVC_PROFILES: Record<string, [number, number]> = {
  "constrained baseline": [0x42, 0xe0],
  baseline: [0x42, 0x00],
  main: [0x4d, 0x40],
  extended: [0x58, 0x00],
  high: [0x64, 0x00],
  "high 10": [0x6e, 0x00],
  "high 4:2:2": [0x7a, 0x00],
  "high 4:4:4 predictive": [0xf4, 0x00],
};

export function videoCodecString(s: FfprobeStream): string | null {
  const name = s.codec_name;
  if (!name) return null;
  const level = s.level && s.level > 0 ? s.level : null;
  switch (name) {
    case "h264": {
      const [profile, constraints] = AVC_PROFILES[s.profile?.toLowerCase() ?? ""] ?? [0x64, 0x00];
      return `avc1.${hex2(profile)}${hex2(constraints)}${hex2(level ?? 40)}`;
    }
    case "hevc": {
      // Main 10 is profile 2; everything else plays as Main. ffprobe's level is already level × 30.
      const main10 = /main 10/i.test(s.profile ?? "") || bitDepth(s) === 10;
      return main10 ? `hvc1.2.4.L${level ?? 150}.B0` : `hvc1.1.6.L${level ?? 120}.B0`;
    }
    case "av1": {
      const profile = /high/i.test(s.profile ?? "") ? 1 : /professional/i.test(s.profile ?? "") ? 2 : 0;
      return `av01.${profile}.${pad2(level ?? 8)}M.${pad2(bitDepth(s))}`;
    }
    case "vp9": {
      const profile = Number(s.profile?.match(/\d/)?.[0] ?? 0);
      return `vp09.${pad2(profile)}.${pad2(level ?? 40)}.${pad2(bitDepth(s))}`;
    }
    case "vp8":
      return "vp8";
    default:
      return name; // mpeg4, mpeg2video, vc1...: no browser plays them
  }
}

export function audioCodecString(s: FfprobeStream): string {
  switch (s.codec_name) {
    case "aac":
      return /he-aacv2/i.test(s.profile ?? "") ? "mp4a.40.29" : /he-aac/i.test(s.profile ?? "") ? "mp4a.40.5" : "mp4a.40.2";
    case "mp3":
      return "mp4a.6B";
    case "ac3":
      return "ac-3";
    case "eac3":
      return "ec-3";
    case "opus":
      return "opus";
    case "flac":
      return "flac";
    case "vorbis":
      return "vorbis";
    default:
      return s.codec_name ?? "unknown"; // dts, truehd, pcm_*: no browser plays them
  }
}

export function hdrKind(s: FfprobeStream): ProbedVideo["hdr"] {
  if (s.side_data_list?.some((d) => /dovi|dolby vision/i.test(d.side_data_type ?? "")) || /^dv(he|h1|av)/i.test(s.codec_tag_string ?? "")) {
    return "dolby-vision";
  }
  if (s.color_transfer === "smpte2084") return "hdr10";
  if (s.color_transfer === "arib-std-b67") return "hlg";
  return null;
}

const tag = (s: FfprobeStream, key: string) => {
  const v = s.tags?.[key] ?? s.tags?.[key.toUpperCase()];
  return v && v !== "und" ? v : null;
};

export function probedVideo(out: FfprobeOutput): ProbedVideo {
  const streams = out.streams ?? [];
  // Cover art in an MKV or MP4 shows up as a video stream; skip it.
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.filter((s) => s.codec_type === "audio");
  const subs = streams.filter((s) => s.codec_type === "subtitle");
  const duration = Number(out.format?.duration);
  return {
    container: out.format?.format_name ?? "unknown",
    durationSec: Number.isFinite(duration) ? duration : 0,
    videoCodec: video ? videoCodecString(video) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hdr: video ? hdrKind(video) : null,
    audioTracks: audio.map((s, i) => ({
      index: i,
      codec: audioCodecString(s),
      channels: s.channels ?? null,
      language: tag(s, "language"),
      title: tag(s, "title"),
      isDefault: Boolean(s.disposition?.default),
    })),
    subtitleTracks: subs.map((s, i) => ({
      index: i,
      codec: s.codec_name ?? "unknown",
      language: tag(s, "language"),
      title: tag(s, "title"),
      isDefault: Boolean(s.disposition?.default),
      forced: Boolean(s.disposition?.forced),
    })),
  };
}
