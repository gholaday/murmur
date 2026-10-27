import { useQuery } from "@tanstack/react-query";
import {
  type AlbumDetail,
  type AlbumSummary,
  apiPaths,
  type ArtistDetail,
  type ArtistSummary,
  type MusicSummaryDto,
  type TrackDto,
  type BookDetail,
  type BookSection,
  bookSections,
  type BookSummary,
  type EpisodeDto,
  type EpisodeWithShow,
  type PodcastDetail,
  type PodcastSummary,
  type QueueEntry,
  type UserPrefs,
  type UserPrefsPatch,
  EPISODE_PAGE,
} from "@murmur/shared/client";
import { toast } from "@/components/toast";
import { api } from "./api";
import { queryClient } from "./query";

export const keys = {
  books: ["books"] as const,
  book: (id: string) => ["book", id] as const,
  podcasts: ["podcasts"] as const,
  podcast: (id: string) => ["podcast", id] as const,
  episodes: (podcastId: string) => ["episodes", podcastId] as const,
  newEpisodes: ["newEpisodes"] as const,
  continueEpisodes: ["continueEpisodes"] as const,
  queue: ["queue"] as const,
  prefs: ["prefs"] as const,
  music: ["music"] as const,
  albums: ["albums"] as const,
  album: (id: string) => ["album", id] as const,
  artists: ["artists"] as const,
  artist: (id: string) => ["artist", id] as const,
  tracks: ["tracks"] as const,
};

// Your own settings (Books tab layout, which tabs show), saved on the server so the web and the
// app share them. Until they load, or on a server without them, the defaults apply.
const usePrefs = () => useQuery({ queryKey: keys.prefs, queryFn: () => api<UserPrefs>(apiPaths.prefs) });

export function useBookSections(): BookSection[] {
  return bookSections(usePrefs().data?.bookSections);
}

/** Optional tabs; each is on unless you've switched it off. */
export function useTabPrefs(): UserPrefs["tabs"] {
  const tabs = usePrefs().data?.tabs;
  return { podcasts: tabs?.podcasts ?? true, music: tabs?.music ?? true };
}

/** Saves a change, showing it at once; puts the old prefs back if the server says no. */
function savePrefs(patch: UserPrefsPatch, failed: string) {
  const previous = queryClient.getQueryData<UserPrefs>(keys.prefs);
  if (previous) queryClient.setQueryData<UserPrefs>(keys.prefs, { ...previous, ...patch } as UserPrefs);
  api<UserPrefs>(apiPaths.prefs, { method: "PUT", body: patch })
    .then((saved) => queryClient.setQueryData(keys.prefs, saved))
    .catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : failed);
      if (previous) queryClient.setQueryData(keys.prefs, previous);
      else void queryClient.resetQueries({ queryKey: keys.prefs });
    });
}

export const saveBookSections = (next: BookSection[]) => savePrefs({ bookSections: next }, "Couldn't save the layout.");

export const saveTabPrefs = (tabs: UserPrefs["tabs"]) => savePrefs({ tabs }, "Couldn't save the tabs.");

export const useBooks = () => useQuery({ queryKey: keys.books, queryFn: () => api<BookSummary[]>("/api/books") });

export const useBook = (id: string) =>
  useQuery({ queryKey: keys.book(id), queryFn: () => api<BookDetail>(`/api/books/${id}`) });

/** Whether the server has music; everything about music hides until it says so. */
export const useMusicSummary = () => useQuery({ queryKey: keys.music, queryFn: () => api<MusicSummaryDto>(apiPaths.music) });

/** Every album, newest first; the Music tab sorts them on the phone, so a sort change needs no refetch. */
export const useAlbums = () => useQuery({ queryKey: keys.albums, queryFn: () => api<AlbumSummary[]>(apiPaths.albums("added")) });

export const useAlbum = (id: string) => useQuery({ queryKey: keys.album(id), queryFn: () => api<AlbumDetail>(apiPaths.album(id)) });

export const useArtists = (enabled = true) =>
  useQuery({ queryKey: keys.artists, queryFn: () => api<ArtistSummary[]>(apiPaths.artists), enabled });

export const useArtist = (id: string) => useQuery({ queryKey: keys.artist(id), queryFn: () => api<ArtistDetail>(apiPaths.artist(id)) });

/** Every song, A to Z; the Songs list filters it on the phone. */
export const useTracks = (enabled = true) => useQuery({ queryKey: keys.tracks, queryFn: () => api<TrackDto[]>(apiPaths.tracks()), enabled });

export const usePodcasts = () =>
  useQuery({ queryKey: keys.podcasts, queryFn: () => api<PodcastSummary[]>("/api/podcasts") });

export const usePodcast = (id: string) =>
  useQuery({ queryKey: keys.podcast(id), queryFn: () => api<PodcastDetail>(`/api/podcasts/${id}`) });

/** Every episode of a show. Long shows have over a thousand, so it waits until it's needed. */
export const useEpisodes = (podcastId: string, enabled = true) =>
  useQuery({ queryKey: keys.episodes(podcastId), queryFn: () => api<EpisodeDto[]>(`/api/podcasts/${podcastId}/episodes?short=1`), enabled });

/** A show's newest episodes, the first page of its list. Its key sits under the full list's, so invalidating one covers both. */
export const useFirstEpisodes = (podcastId: string, enabled = true) =>
  useQuery({
    queryKey: [...keys.episodes(podcastId), "first"],
    queryFn: () => api<EpisodeDto[]>(`/api/podcasts/${podcastId}/episodes?short=1&limit=${EPISODE_PAGE}`),
    enabled,
  });

// Lists ask for short notes (`short=1`); a row fetches the full notes when it's expanded.

export const useNewEpisodes = () =>
  useQuery({ queryKey: keys.newEpisodes, queryFn: () => api<EpisodeWithShow[]>("/api/episodes/new?limit=50&short=1") });

/** Started, unfinished episodes, most recently listened first. */
export const useContinueEpisodes = () =>
  useQuery({ queryKey: keys.continueEpisodes, queryFn: () => api<EpisodeWithShow[]>("/api/episodes/continue?limit=20&short=1") });

export const useQueue = () => useQuery({ queryKey: keys.queue, queryFn: () => api<QueueEntry[]>("/api/queue") });

/** After progress, played or archived state changes, refresh the lists that show it. */
export function invalidateListening() {
  void queryClient.invalidateQueries({ queryKey: keys.books });
  void queryClient.invalidateQueries({ queryKey: keys.newEpisodes });
  void queryClient.invalidateQueries({ queryKey: keys.continueEpisodes });
  void queryClient.invalidateQueries({ queryKey: keys.podcasts });
  void queryClient.invalidateQueries({ queryKey: ["episodes"] });
  void queryClient.invalidateQueries({ queryKey: ["book"] });
}

/** Book details, from cache when available (works offline for anything opened before). */
export function fetchBook(id: string): Promise<BookDetail> {
  return queryClient.fetchQuery({ queryKey: keys.book(id), queryFn: () => api<BookDetail>(`/api/books/${id}`), staleTime: 60_000 });
}

export function fetchEpisode(id: string): Promise<EpisodeWithShow> {
  return queryClient.fetchQuery({
    queryKey: ["episode", id],
    queryFn: () => api<EpisodeWithShow>(`/api/episodes/${id}`),
    staleTime: 60_000,
  });
}

/**
 * An episode's notes: as listed until the row is opened, then in full if the list cut them
 * short (`short=1`). Shares the cache entry the player uses for the same episode.
 */
export function useEpisodeNotes(episode: EpisodeDto, open: boolean): string | null {
  const full = useQuery({
    queryKey: ["episode", episode.id],
    queryFn: () => api<EpisodeWithShow>(`/api/episodes/${episode.id}`),
    enabled: open && !!episode.descriptionCut,
    staleTime: 60_000,
  });
  return (episode.descriptionCut ? full.data?.description : null) ?? episode.description;
}

/** Marks a book or episode finished, or resets it to the start. */
export async function setFinished(itemType: "book" | "episode", itemId: string, durationSec: number, finished: boolean) {
  await api("/api/progress", {
    method: "PUT",
    body: {
      items: [{ itemType, itemId, positionSec: finished ? durationSec : 0, durationSec, finished, updatedAt: Date.now() }],
    },
  });
  invalidateListening();
}
