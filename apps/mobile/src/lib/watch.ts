import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  apiPaths,
  duration,
  episodeLabel,
  type MovieDetail,
  type MovieSummary,
  type ShowDetail,
  type ShowSummary,
  timeLeft,
  validSpeed,
  type VideoEpisode,
  videoLanguageKey,
  type VideoQuality,
  videoSpeedKey,
  type WatchHomeDto,
} from "@murmur/shared/client";
import { api } from "./api";
import { savedMovie, savedShow } from "./downloads";
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

// Watch hides while the server's video add-on is down; lib/changes.ts reloads this when it comes back.
export const useWatchHome = () => useQuery({ queryKey: watchKeys.home, queryFn: () => api<WatchHomeDto>(apiPaths.watchHome) });
export const useMovies = (enabled = true) => useQuery({ queryKey: watchKeys.movies, queryFn: () => api<MovieSummary[]>(apiPaths.movies), enabled });
export const useShows = (enabled = true) => useQuery({ queryKey: watchKeys.shows, queryFn: () => api<ShowSummary[]>(apiPaths.shows), enabled });
// A downloaded movie or show opens from its saved details until (or unless) the server answers.
export const useMovie = (id: string | undefined) =>
  useQuery({
    queryKey: watchKeys.movie(id ?? ""),
    queryFn: () => api<MovieDetail>(apiPaths.movie(id!)),
    enabled: !!id,
    placeholderData: () => (id ? savedMovie(id) : undefined),
  });
export const useShow = (id: string | undefined) =>
  useQuery({
    queryKey: watchKeys.show(id ?? ""),
    queryFn: () => api<ShowDetail>(apiPaths.show(id!)),
    enabled: !!id,
    placeholderData: () => (id ? savedShow(id) : undefined),
  });

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

/** An episode row's sub line: "S1 E2, 31m", with the time left once started. */
export function episodeSub(e: VideoEpisode): string {
  const position = e.progress && !e.progress.finished ? e.progress.positionSec : 0;
  return `${episodeLabel(e.season, e.episode)}, ${position > 0 ? timeLeft(e.durationSec, position) : duration(e.durationSec)}`;
}

export const seasonName =(season: number) => (season === 0 ? "Specials" : `Season ${season}`);

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

/** The audio language picked for a movie or show, so its next file opens with the same one. */
export const readVideoLanguage = (key: string) => getJson<string>(videoLanguageKey(key));

export function saveVideoLanguage(key: string, language: string | null) {
  if (language) setJson(videoLanguageKey(key), language);
  else removeKey(videoLanguageKey(key));
}

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

export const readVideoSpeed = (key: string): number => validSpeed(getJson<number>(videoSpeedKey(key)));

export function saveVideoSpeed(key: string, speed: number) {
  if (speed === 1) removeKey(videoSpeedKey(key));
  else setJson(videoSpeedKey(key), speed);
}
