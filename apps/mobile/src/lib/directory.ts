import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  apiPaths,
  errorText,
  feedLinkIn,
  type PodcastBrowse,
  type PodcastMoreLike,
  type PodcastPreview,
  type PodcastSearchResult,
} from "@murmur/shared/client";
import { api } from "./api";
import { nullIfMissing, useExplicitShows } from "./data";
import { queryClient } from "./query";
import { keys } from "./query-keys";
import { useDebounced } from "./search";

// The podcast directory, for Browse and Top shows. The server caches it for a day, so a list is
// kept a while here too.
const DIRECTORY_STALE = 10 * 60_000;

/** Browse's More like shelves and top shows. Null on a server from before Browse. */
export const useBrowse = () =>
  useQuery({
    queryKey: keys.podcastBrowse,
    queryFn: () => api<PodcastBrowse>(apiPaths.podcastBrowse).catch(nullIfMissing),
    staleTime: DIRECTORY_STALE,
  });

/** The top 50 shows overall, or in one category. */
export const useChart = (genreId: number | null) =>
  useQuery({
    queryKey: keys.podcastChart(genreId),
    queryFn: () => api<PodcastSearchResult[]>(apiPaths.podcastChart(genreId)),
    staleTime: DIRECTORY_STALE,
  });

/** Shows like one, followed or not: the ones the show recommends, then similar ones. */
export const useMoreLike = (feedUrl: string) =>
  useQuery({
    queryKey: keys.podcastMoreLike(feedUrl),
    queryFn: () => api<PodcastMoreLike>(apiPaths.podcastMoreLike(feedUrl)),
    staleTime: DIRECTORY_STALE,
  });

/**
 * Whether the server has the podcast directory (Browse, More like). It came with the Explicit
 * shows setting, so that's what tells, from prefs already loaded.
 */
export const useHasDirectory = () => useExplicitShows() !== undefined;

export type BoxFound = { state: "loading"; link: boolean } | { state: "error"; message: string } | { state: "ready"; shows: PodcastSearchResult[]; term: string };

/**
 * What Browse's box finds: shows by name from 2 letters, or the one feed a pasted link points at.
 * Null while there's nothing to look for.
 */
export function useBoxResults(text: string): BoxFound | null {
  const link = feedLinkIn(text);
  const term = useDebounced(link ? "" : text.trim(), 350);
  const search = useQuery({
    queryKey: keys.podcastSearch(term),
    queryFn: () => api<PodcastSearchResult[]>(apiPaths.podcastSearch(term)),
    enabled: !link && term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: DIRECTORY_STALE,
  });
  const feed = useQuery({
    queryKey: keys.podcastPreview(link ?? ""),
    queryFn: () => api<PodcastPreview>(apiPaths.podcastPreview(link!)),
    enabled: !!link,
    retry: false,
  });

  if (link) {
    if (feed.isError) return { state: "error", message: "That link isn't a podcast feed." };
    const p = feed.data;
    if (!p) return { state: "loading", link: true };
    const show = { title: p.title, author: p.author, artworkUrl: p.artworkUrl, thumbUrl: p.artworkUrl, feedUrl: p.feedUrl, episodeCount: p.episodeCount, subscribedId: p.subscribedId };
    return { state: "ready", shows: [show], term: link };
  }
  if (text.trim().length < 2) return null;
  if (search.data && term.length >= 2) return { state: "ready", shows: search.data, term };
  if (search.isError) return { state: "error", message: errorText(search.error) };
  return { state: "loading", link: false };
}

/** After following a show: Podcasts picks it up, and the directory's lists show it followed next time. */
export function refreshAfterSubscribe() {
  void queryClient.invalidateQueries({ queryKey: keys.podcasts });
  void queryClient.invalidateQueries({ queryKey: keys.newEpisodes });
  void queryClient.invalidateQueries({ queryKey: keys.continueEpisodes });
  // Left as they are on screen, where the check already shows; refetched when next opened.
  void queryClient.invalidateQueries({ queryKey: keys.all.podcastSearch, refetchType: "none" });
  void queryClient.invalidateQueries({ queryKey: keys.podcastDirectory, refetchType: "none" });
}
