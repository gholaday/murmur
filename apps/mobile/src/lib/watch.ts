import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  apiPaths,
  channelsLabel,
  codecName,
  type MovieDetail,
  type MovieSummary,
  type ShowDetail,
  type ShowSummary,
  VIDEO_SPEEDS,
  type VideoAudioTrack,
  type VideoEpisode,
  type VideoQuality,
  type WatchHomeDto,
} from "@murmur/shared/client";
import { api } from "./api";
import { queryClient } from "./query";
import { getJson, removeKey, setJson } from "./storage";

// Watch: movies and TV shows. The lists and pages, marking things watched, and where screens go.

export const watchKeys = {
  all: ["watch"] as const,
  home: ["watch", "home"] as const,
  movies: ["watch", "movies"] as const,
  movie: (id: string) => ["watch", "movie", id] as const,
  shows: ["watch", "shows"] as const,
  show: (id: string) => ["watch", "show", id] as const,
};

export const useWatchHome = () => useQuery({ queryKey: watchKeys.home, queryFn: () => api<WatchHomeDto>(apiPaths.watchHome) });
export const useMovies = (enabled = true) => useQuery({ queryKey: watchKeys.movies, queryFn: () => api<MovieSummary[]>(apiPaths.movies), enabled });
export const useShows = (enabled = true) => useQuery({ queryKey: watchKeys.shows, queryFn: () => api<ShowSummary[]>(apiPaths.shows), enabled });
export const useMovie = (id: string | undefined) =>
  useQuery({ queryKey: watchKeys.movie(id ?? ""), queryFn: () => api<MovieDetail>(apiPaths.movie(id!)), enabled: !!id });
export const useShow = (id: string | undefined) =>
  useQuery({ queryKey: watchKeys.show(id ?? ""), queryFn: () => api<ShowDetail>(apiPaths.show(id!)), enabled: !!id });

/** Everything on the Watch tab and pages loads again, after watching or marking something. */
export const invalidateWatch = () => void queryClient.invalidateQueries({ queryKey: watchKeys.all });

/** Marks movies (by the movie's id) or episodes watched, or back to the start. */
export async function markWatched(items: { id: string; durationSec: number }[], finished: boolean) {
  const updatedAt = Date.now();
  await api("/api/progress", {
    method: "PUT",
    body: {
      items: items.map((i) => ({
        itemType: "video",
        itemId: i.id,
        positionSec: finished ? i.durationSec : 0,
        durationSec: i.durationSec,
        finished,
        updatedAt,
      })),
    },
  });
  invalidateWatch();
}

/** A show's episodes in watching order: seasons in order, Specials last, as the server lists them. */
export const showEpisodes = (show: ShowDetail): VideoEpisode[] => show.seasonList.flatMap((s) => s.episodes);

export const seasonName = (season: number) => (season === 0 ? "Specials" : `Season ${season}`);

/** How far through, as a percentage, for progress bars. */
export const percentDone = (positionSec: number, durationSec: number) => (durationSec ? Math.min(100, (positionSec / durationSec) * 100) : 0);

export const openMovie = (id: string) => router.push({ pathname: "/movie/[id]", params: { id } });
export const openTvShow = (id: string) => router.push({ pathname: "/tv/[id]", params: { id } });

/**
 * What the video player opens: a movie (optionally one version of it), or an episode of a show,
 * with a converted-picture quality picked for this viewing.
 */
export type WatchTarget = ({ kind: "movie"; id: string; version?: string } | { kind: "episode"; id: string; showId: string }) & { quality?: VideoQuality };

export function watchParams(target: WatchTarget): Record<string, string> {
  const q: Record<string, string> = target.quality ? { q: target.quality } : {};
  return target.kind === "movie"
    ? { kind: "movie", id: target.id, ...(target.version ? { v: target.version } : {}), ...q }
    : { kind: "episode", id: target.id, show: target.showId, ...q };
}

export const openVideoPlayer = (target: WatchTarget) => router.push({ pathname: "/watch-player", params: watchParams(target) });

// ---------- Audio tracks and quality ----------

const languageKey = (key: string) => `murmur.videoAudio.${key}`;

/** The audio language picked for a movie or show, so its next file opens with the same one. */
export const readVideoLanguage = (key: string) => getJson<string>(languageKey(key));

export function saveVideoLanguage(key: string, language: string | null) {
  if (language) setJson(languageKey(key), language);
  else removeKey(languageKey(key));
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

export const QUALITY_LABEL: Record<VideoQuality, string> = { full: "1080p", light: "720p" };
export const QUALITY_SUB: Record<VideoQuality, string> = { full: "Full", light: "Lighter, easier on the server" };

// Media3 plays nearly any picture, so what this phone can't decode is only known once a file is
// tried (10-bit HEVC on an older phone, say). The codecs that failed are kept, so the next file
// like that goes straight to a converted stream and its page offers the quality.
const UNPLAYABLE_KEY = "murmur.videoUnplayable";

/** The codec and its profile ("hvc1.2.4" for 10-bit HEVC), without the level and flags that vary by file. */
const codecKind = (codec: string) => codec.replace(/^hev1/, "hvc1").split(".").slice(0, 3).join(".");

export const pictureUnplayable = (codec: string | null) => !!codec && (getJson<string[]>(UNPLAYABLE_KEY) ?? []).includes(codecKind(codec));

export function markPictureUnplayable(codec: string | null) {
  if (!codec || pictureUnplayable(codec)) return;
  setJson(UNPLAYABLE_KEY, [...(getJson<string[]>(UNPLAYABLE_KEY) ?? []), codecKind(codec)]);
}

// ---------- Speed, remembered per movie and per show ----------

const speedKey = (key: string) => `murmur.videoSpeed.${key}`;

export function readVideoSpeed(key: string): number {
  const v = getJson<number>(speedKey(key));
  return v !== null && VIDEO_SPEEDS.includes(v) ? v : 1;
}

export function saveVideoSpeed(key: string, speed: number) {
  if (speed === 1) removeKey(speedKey(key));
  else setJson(speedKey(key), speed);
}
