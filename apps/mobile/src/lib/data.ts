import { useQuery } from "@tanstack/react-query";
import {
  apiPaths,
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
};

/**
 * Your Books tab layout (section order and which are hidden), saved on the server so the web
 * and the app share it. Until it loads, or on a server without it, the default order shows.
 */
export function useBookSections(): BookSection[] {
  const prefs = useQuery({ queryKey: keys.prefs, queryFn: () => api<UserPrefs>(apiPaths.prefs) });
  return bookSections(prefs.data?.bookSections);
}

/** Saves a new layout, showing it at once; puts the old one back if the server says no. */
export function saveBookSections(next: BookSection[]) {
  const previous = queryClient.getQueryData<UserPrefs>(keys.prefs);
  queryClient.setQueryData<UserPrefs>(keys.prefs, { ...previous, bookSections: next });
  api<UserPrefs>(apiPaths.prefs, { method: "PUT", body: { bookSections: next } })
    .then((saved) => queryClient.setQueryData(keys.prefs, saved))
    .catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Couldn't save the layout.");
      if (previous) queryClient.setQueryData(keys.prefs, previous);
      else void queryClient.resetQueries({ queryKey: keys.prefs });
    });
}

export const useBooks = () => useQuery({ queryKey: keys.books, queryFn: () => api<BookSummary[]>("/api/books") });

export const useBook = (id: string) =>
  useQuery({ queryKey: keys.book(id), queryFn: () => api<BookDetail>(`/api/books/${id}`) });

export const usePodcasts = () =>
  useQuery({ queryKey: keys.podcasts, queryFn: () => api<PodcastSummary[]>("/api/podcasts") });

export const usePodcast = (id: string) =>
  useQuery({ queryKey: keys.podcast(id), queryFn: () => api<PodcastDetail>(`/api/podcasts/${id}`) });

export const useEpisodes = (podcastId: string) =>
  useQuery({ queryKey: keys.episodes(podcastId), queryFn: () => api<EpisodeDto[]>(`/api/podcasts/${podcastId}/episodes?short=1`) });

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
