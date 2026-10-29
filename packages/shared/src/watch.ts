// Watch: movies and TV shows. What the server sends for the Watch tab, movie and show pages.

import { apiPaths } from "./api-paths";
import { gigabytes } from "./format";
import { collator, sortTitle } from "./library";

export type WatchSort = "added" | "title" | "year";
export const WATCH_SORTS: Array<{ id: WatchSort; label: string }> = [
  { id: "added", label: "Recently added" },
  { id: "title", label: "Title" },
  { id: "year", label: "Year" },
];
/** Where the device keeps the Movies, Shows and Watched sort. */
export const WATCH_SORT_KEY = "murmur.watchSort";

/** Movies and shows in the picked order: newest added, A to Z (ignoring "The"), or newest year. */
export function sortWatch<T>(items: T[], sort: WatchSort, of: (item: T) => { title: string; year: string | null; addedAt: number }): T[] {
  const byTitle = (a: T, b: T) => collator.compare(sortTitle(of(a).title), sortTitle(of(b).title));
  const list = [...items];
  if (sort === "added") return list.sort((a, b) => of(b).addedAt - of(a).addedAt || byTitle(a, b));
  if (sort === "year") return list.sort((a, b) => (of(b).year ?? "").localeCompare(of(a).year ?? "") || byTitle(a, b));
  return list.sort(byTitle);
}

/** An audio track in a video file, in the file's own order. */
export interface VideoAudioTrack {
  /** The stream's index among the file's audio streams (ffmpeg's `0:a:N`). */
  index: number;
  /** RFC 6381 string (mp4a.40.2, ec-3), or ffprobe's codec name (dts, truehd) when there's none. */
  codec: string;
  channels: number | null;
  /** ISO 639-2 language from the file, like "eng". */
  language: string | null;
  title: string | null;
  isDefault: boolean;
}

/** A subtitle track inside a video file. Shown once subtitles are supported. */
export interface VideoSubtitleTrack {
  index: number;
  /** ffprobe's codec name: subrip, ass, mov_text, webvtt, hdmv_pgs_subtitle, dvd_subtitle. */
  codec: string;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  forced: boolean;
}

/** What a player needs to decide how to play a file (see Playback in the Watch section of docs/SPEC.md). */
export interface VideoFileInfo {
  /** ffprobe's format name, like "matroska,webm". */
  container: string;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  hdr: "hdr10" | "hlg" | "dolby-vision" | null;
  audioTracks: VideoAudioTrack[];
  subtitleTracks: VideoSubtitleTrack[];
  size: number;
  /** The file's name, for the details at the bottom of a movie page. */
  fileName: string;
}

/** Your place in a movie or episode. */
export interface VideoProgress {
  positionSec: number;
  finished: boolean;
  updatedAt: number;
}

/** A movie. Its files are versions (a director's cut, a 4K copy); progress belongs to the movie. */
export interface MovieSummary {
  id: string;
  title: string;
  year: string | null;
  /** The first version's length. */
  durationSec: number;
  posterHash: string | null;
  /** The poster's colour as a header tint, or null with no poster. */
  color: string | null;
  /** The first version's still. */
  stillHash: string | null;
  versions: number;
  addedAt: number;
  progress: VideoProgress | null;
}

/** One file of a movie. Its id is what streams. */
export interface MovieVersion {
  id: string;
  /** From the file name: "Director's Cut", "IMAX". */
  edition: string | null;
  durationSec: number;
  stillHash: string | null;
  file: VideoFileInfo;
}

export interface MovieDetail extends MovieSummary {
  description: string | null;
  backdropHash: string | null;
  /** The TMDB title it's matched to; null when not matched. */
  tmdbId: number | null;
  /** Biggest picture first; the first is the one Play starts. */
  versionList: MovieVersion[];
}

/** "4K", "1080p", "720p", or the height. */
export function resolutionLabel(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  if (width >= 3200 || height >= 1800) return "4K";
  if (width >= 1800 || height >= 1000) return "1080p";
  if (width >= 1200 || height >= 700) return "720p";
  return `${height}p`;
}

/** What a version is called in the version picker: "Despecialized Edition 720p", "1080p". */
export function versionLabel(v: MovieVersion): string {
  const res = resolutionLabel(v.file.width, v.file.height);
  return [v.edition, res].filter(Boolean).join(" ") || v.file.fileName;
}

/** A TV episode (podcast episodes are EpisodeDto). */
export interface VideoEpisode {
  id: string;
  showId: string;
  season: number;
  episode: number;
  title: string;
  description: string | null;
  durationSec: number;
  stillHash: string | null;
  progress: VideoProgress | null;
  file: VideoFileInfo;
}

export interface ShowSummary {
  id: string;
  title: string;
  year: string | null;
  posterHash: string | null;
  color: string | null;
  seasons: number;
  episodes: number;
  /** Episodes you've finished. */
  watched: number;
  addedAt: number;
}

export interface ShowDetail extends ShowSummary {
  description: string | null;
  backdropHash: string | null;
  /** The TMDB title it's matched to; null when not matched. */
  tmdbId: number | null;
  /** Seasons in order, Specials (0) last. */
  seasonList: Array<{ season: number; episodes: VideoEpisode[] }>;
  /** Where Resume goes: the episode in progress, else the next unwatched one. Null when all are watched. */
  upNextId: string | null;
}

/** A TMDB search result in the Match sheet. */
export interface WatchMatchResult {
  tmdbId: number;
  title: string;
  year: string | null;
  overview: string | null;
  /** A small poster straight from TMDB. */
  posterUrl: string | null;
}

/** A card in Continue watching or Next episodes. */
export interface WatchCard {
  /** The movie's id, or the episode's. */
  id: string;
  kind: "movie" | "episode";
  title: string;
  /** Episodes: the show's title is `title`, and these say which episode. */
  showId: string | null;
  season: number | null;
  episode: number | null;
  episodeTitle: string | null;
  durationSec: number;
  stillHash: string | null;
  /** What the still is served under: the episode, or the movie's first version. */
  stillId: string;
  /** The movie's or the show's backdrop, shown before the still. */
  backdropHash: string | null;
  /** The movie's or the show's poster, for when there's no backdrop or still. */
  posterHash: string | null;
  progress: VideoProgress | null;
}

/** A card's picture: the movie's or show's backdrop, then the still, then the poster. */
export function watchCardArtUrl(card: WatchCard): string | null {
  const art = (kind: "poster" | "backdrop", hash: string) =>
    card.kind === "movie" ? apiPaths.movieArtUrl(card.id, kind, hash, "small") : apiPaths.showArtUrl(card.showId!, kind, hash, "small");
  if (card.backdropHash) return art("backdrop", card.backdropHash);
  if (card.stillHash) return apiPaths.videoStillUrl(card.stillId, card.stillHash, "small");
  if (card.posterHash) return art("poster", card.posterHash);
  return null;
}

/** A poster in Recently added: a movie or a show. */
export interface WatchPoster {
  kind: "movie" | "show";
  id: string;
  title: string;
  year: string | null;
  posterHash: string | null;
  color: string | null;
  /** Movies you finished, or shows with every episode watched. */
  watched: boolean;
  addedAt: number;
}

export interface WatchHomeDto {
  /** At least one movies or shows folder is set up. Watch is hidden everywhere when false. */
  enabled: boolean;
  continueWatching: WatchCard[];
  nextEpisodes: WatchCard[];
  recentlyAdded: WatchPoster[];
}

/** Whether there's anything to watch, for the tab bar and You. */
export interface WatchSummaryDto {
  /** A movies or shows folder is set up. */
  enabled: boolean;
  movies: number;
  shows: number;
}

/** What the player needs for an episode: it, its show, and the episodes after it. */
export interface EpisodePlayDto {
  episode: VideoEpisode;
  /** The show, with its poster's colour for the player's tint. */
  show: { id: string; title: string; color: string | null };
  /** The rest of the show in order, starting with the next episode. */
  next: VideoEpisode[];
}

/** A video counts as watched once you're this far through. */
export const WATCHED_AT = 0.92;

export type WatchArtKind = "poster" | "backdrop" | "still";

/** What a device can play, asked by the player (on the web, `MediaSource.isTypeSupported`). */
export interface PlaybackSupport {
  /** An RFC 6381 video codec, like "hvc1.2.4.L150.B0". */
  video: (codec: string) => boolean;
  /** An RFC 6381 audio codec, or ffprobe's name for ones without one ("dts"). */
  audio: (codec: string) => boolean;
  /** ffprobe's container name; null when the device can't tell, and the file is simply tried. */
  container: (container: string) => boolean | null;
}

/** "HEVC", "Dolby Digital", "MKV": codec and container names for the can't-play sheet and file details. */
export function codecName(codec: string): string {
  const c = codec.toLowerCase();
  if (c.startsWith("avc1") || c === "h264") return "H.264";
  if (c.startsWith("hvc1") || c.startsWith("hev1") || c === "hevc") return "HEVC";
  if (c.startsWith("av01")) return "AV1";
  if (c.startsWith("vp09")) return "VP9";
  if (c.startsWith("mp4a.40")) return "AAC";
  if (c === "mp4a.6b" || c === "mp3") return "MP3";
  const names: Record<string, string> = {
    vp8: "VP8",
    "ac-3": "Dolby Digital",
    "ec-3": "Dolby Digital Plus",
    dts: "DTS",
    truehd: "Dolby TrueHD",
    opus: "Opus",
    flac: "FLAC",
    vorbis: "Vorbis",
    mpeg4: "MPEG-4",
    mpeg2video: "MPEG-2",
    vc1: "VC-1",
    "matroska,webm": "MKV",
    "mov,mp4,m4a,3gp,3g2,mj2": "MP4",
    avi: "AVI",
    mpegts: "TS",
  };
  return names[c] ?? codec.toUpperCase();
}

/** "Stereo", "5.1": a track's channels the way a person says them. */
export function channelsLabel(channels: number | null): string | null {
  if (!channels) return null;
  return channels === 1 ? "Mono" : channels === 2 ? "Stereo" : channels === 6 ? "5.1" : channels === 8 ? "7.1" : `${channels} channels`;
}

/** How a video gets played: the file as it is, or streamed from the server with the picture copied or converted. */
export type PlaybackPlan =
  | { kind: "direct" }
  /**
   * Streamed (HLS) with this audio track, its sound copied or converted to AAC. "remux" copies the
   * picture; "transcode" converts it to H.264 because this device can't play it as it is.
   */
  | { kind: "remux" | "transcode"; track: number; audio: RemuxAudio };

export type RemuxAudio = "copy" | "aac";
export type StreamVideo = "copy" | "h264";
/** How a converted picture is made: full is up to 1080p, light is up to 720p and easier on a small server. */
export type VideoQuality = "full" | "light";
export const VIDEO_QUALITIES: VideoQuality[] = ["full", "light"];

/** Sound an MP4 can carry as it is; anything else is converted to AAC. */
const mp4Audio = (codec: string) => codec.startsWith("mp4a") || ["ac-3", "ec-3", "opus", "flac"].includes(codec);

/** The audio track a file plays by default. */
export function defaultAudioTrack(file: VideoFileInfo): number {
  return (file.audioTracks.find((t) => t.isDefault) ?? file.audioTracks[0])?.index ?? 0;
}

/**
 * Plays the file as it is when this device reads the container, the picture and the sound and the
 * default track is wanted; otherwise has the server stream it, converting only what won't play.
 * `forceRemux` is for a file that was tried as it is and wouldn't open.
 */
export function playbackPlan(
  file: VideoFileInfo,
  support: PlaybackSupport,
  opts: { track?: number | null; forceRemux?: boolean } = {},
): PlaybackPlan {
  const main = defaultAudioTrack(file);
  const track = opts.track ?? main;
  const chosen = file.audioTracks.find((t) => t.index === track);
  const plays = !chosen || support.audio(chosen.codec);
  const audio: RemuxAudio = !chosen || (plays && mp4Audio(chosen.codec)) ? "copy" : "aac";
  if (file.videoCodec && !support.video(file.videoCodec)) return { kind: "transcode", track, audio };
  if (support.container(file.container) === false || opts.forceRemux || track !== main || !plays) return { kind: "remux", track, audio };
  return { kind: "direct" };
}

/** What a stream session is asked for. */
export interface StreamRequest {
  track: number;
  audio: RemuxAudio;
  video: StreamVideo;
  /** For a converted picture; the server's default is full. */
  quality?: VideoQuality;
  /** Seconds into the video to start from. */
  start: number;
}

/** A remuxed stream that has started: its HLS playlist, and where in the video it really starts. */
export interface StreamSessionDto {
  sessionId: string;
  playlistUrl: string;
  /** Seconds into the video; the stream's own clock starts at 0 here. */
  start: number;
}

/**
 * A video the server is making into an MP4 for the phone to keep (`POST apiPaths.videoDownload`).
 * Ask again every few seconds while it's preparing; once ready, download `fileUrl` like any file
 * (it has a length and takes range requests, so an interrupted download can resume). The file is
 * kept on the server for a few hours, and DELETE on `fileUrl` cancels or removes it.
 */
export interface VideoDownloadDto {
  id: string;
  status: "preparing" | "ready" | "failed";
  /** 0 to 1 while preparing, from how far into the video ffmpeg has got. */
  progress: number;
  /** Bytes, once ready. */
  size: number | null;
  error: string | null;
  fileUrl: string;
}

/** "Season 2", or "Specials" for season 0. */
export const seasonName = (season: number): string => (season === 0 ? "Specials" : `Season ${season}`);

/** "S2 E4", or "Special 3" for season 0. */
export function episodeLabel(season: number, episode: number): string {
  return season === 0 ? `Special ${episode}` : `S${season} E${episode}`;
}

// ---------- The player's rules, the same on the web and the app ----------

export const QUALITY_LABEL: Record<VideoQuality, string> = { full: "1080p", light: "720p" };

export const VIDEO_PLAYER = {
  saveEveryMs: 10_000,
  /** Seeks within a stream stay this far from its live edge, so the player doesn't stall there. */
  edgeSec: 2,
  /** This many stalls on a converted stream and the player says the server can't keep up. */
  slowAfterStalls: 3,
  /** The next-episode card shows this long before the end, and counts down from `countdown`. */
  nextCardAtSec: 30,
  countdown: 10,
  hideAfterMs: 3000,
  doubleTapMs: 300,
  /** Your place is only saved once the video has moved this far from where it opened. */
  touchedAfterSec: 3,
} as const;

/** Where the audio language is remembered, per movie and per show. */
export const videoLanguageKey = (key: string) => `murmur.videoAudio.${key}`;

/** How far through, as a percentage, for progress bars. */
export const percentDone = (positionSec: number, durationSec: number) => (durationSec ? Math.min(100, (positionSec / durationSec) * 100) : 0);

/** Where a video opens: your place, unless it's finished or only the credits are left, which starts over. */
export const resumeStart = (startAt: number, durationSec: number) => (startAt > 0 && startAt < durationSec * WATCHED_AT ? startAt : 0);

/** The remembered language's track, when the file has one and it isn't already the default; else the default. */
export function trackForLanguage(file: VideoFileInfo, language: string | null): number {
  const main = defaultAudioTrack(file);
  if (!language || file.audioTracks.find((t) => t.index === main)?.language === language) return main;
  return file.audioTracks.find((t) => t.language === language)?.index ?? main;
}

let languageNames: Intl.DisplayNames | null = null;

/** "English" for "eng"; the track's title, or its number, when the file doesn't say. */
export function trackName(t: VideoAudioTrack): string {
  let language: string | null = null;
  if (t.language && t.language !== "und") {
    try {
      languageNames ??= new Intl.DisplayNames(undefined, { type: "language" });
      language = languageNames.of(t.language) ?? null;
    } catch {
      language = t.language.toUpperCase();
    }
  }
  if (language && t.title && !t.title.toLowerCase().includes(language.toLowerCase())) return `${language}, ${t.title}`;
  return t.title ?? language ?? `Track ${t.index + 1}`;
}

/** "Dolby Digital 5.1": a track's codec and channels. */
export const trackDetails = (t: VideoAudioTrack) => [codecName(t.codec), channelsLabel(t.channels)].filter(Boolean).join(" ");

/** "HEVC", "HDR10", "Dolby Digital 5.1", "MKV", "4.2 GB": the pills under File. */
export function fileDetailParts(file: VideoFileInfo): string[] {
  const audio = file.audioTracks.find((t) => t.isDefault) ?? file.audioTracks[0];
  return [
    file.videoCodec ? codecName(file.videoCodec) : null,
    file.hdr ? (file.hdr === "dolby-vision" ? "Dolby Vision" : file.hdr === "hlg" ? "HLG" : "HDR10") : null,
    audio ? `${codecName(audio.codec)}${audio.channels && audio.channels > 2 ? ` ${channelsLabel(audio.channels)}` : ""}` : null,
    codecName(file.container),
    gigabytes(file.size),
  ].filter((p): p is string => !!p);
}
