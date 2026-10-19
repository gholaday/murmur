import { useQuery } from "@tanstack/react-query";
import type {
  BookDetail,
  BookSummary,
  EpisodeDto,
  EpisodeWithShow,
  PodcastDetail,
  PodcastSummary,
  QueueEntry,
} from "@murmur/shared";
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
};

export const useBooks = () => useQuery({ queryKey: keys.books, queryFn: () => api<BookSummary[]>("/api/books") });

export const useBook = (id: string) =>
  useQuery({ queryKey: keys.book(id), queryFn: () => api<BookDetail>(`/api/books/${id}`) });

export const usePodcasts = () =>
  useQuery({ queryKey: keys.podcasts, queryFn: () => api<PodcastSummary[]>("/api/podcasts") });

export const usePodcast = (id: string) =>
  useQuery({ queryKey: keys.podcast(id), queryFn: () => api<PodcastDetail>(`/api/podcasts/${id}`) });

export const useEpisodes = (podcastId: string) =>
  useQuery({ queryKey: keys.episodes(podcastId), queryFn: () => api<EpisodeDto[]>(`/api/podcasts/${podcastId}/episodes`) });

export const useNewEpisodes = () =>
  useQuery({ queryKey: keys.newEpisodes, queryFn: () => api<EpisodeWithShow[]>("/api/episodes/new?limit=50") });

/** Started, unfinished episodes, most recently listened first. */
export const useContinueEpisodes = () =>
  useQuery({ queryKey: keys.continueEpisodes, queryFn: () => api<EpisodeWithShow[]>("/api/episodes/continue?limit=20") });

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
