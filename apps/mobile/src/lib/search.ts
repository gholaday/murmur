import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  albumMatches,
  apiPaths,
  type AlbumSummary,
  type BookSummary,
  byNameTier,
  matchesBook,
  matchesEpisode,
  type MovieSummary,
  SEARCH_LIMIT,
  type SearchKind,
  type SearchResultsDto,
  type ShowSummary,
  songMatches,
  type TrackDto,
  type WatchPoster,
} from "@murmur/shared/client";
import { api, HttpError } from "./api";
import { keys } from "./data";
import { type Download, useDownloads } from "./downloads";
import { queryClient, useOnline } from "./query";
import { createSavedStore, createStore } from "./store";
import { watchKeys } from "./watch";

// Search everywhere: the field lives in the dock, the results on the Search screen, so what's
// typed and which tab is picked sit here where both can reach them.

/** What's typed in the dock's search field. */
export const searchText = createStore("");
/** The Search screen's tab. */
export const searchKind = createStore<SearchKind>("all");

const RECENT_MAX = 8;
const recent = createSavedStore<string[]>("murmur.recentSearches", []);
export const useRecentSearches = recent.useValue;

/** Puts a search first in the recent list, once. */
export function rememberSearch(q: string) {
  const text = q.trim();
  if (!text) return;
  const lower = text.toLowerCase();
  recent.set([text, ...recent.get().filter((r) => r.toLowerCase() !== lower)].slice(0, RECENT_MAX));
}

export const forgetSearch = (q: string) => recent.set(recent.get().filter((r) => r !== q));

/** The value once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 200): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * Results for `q` on a tab: the server's, or when it can't be reached, what's downloaded and
 * matches, from the lists already on the phone. `offline` says which.
 */
export function useSearch(q: string, kind: SearchKind) {
  const online = useOnline();
  const downloads = useDownloads();
  const query = useQuery({
    queryKey: ["search", q, kind],
    queryFn: () => api<SearchResultsDto>(apiPaths.search(q, kind)),
    enabled: !!q,
    // The last results stay up while the next ones load, so the list doesn't blink per letter.
    placeholderData: keepPreviousData,
    retry: false,
  });
  const unreachable = !online || (query.isError && !(query.error instanceof HttpError));
  const offline = !!q && unreachable;
  const local = useMemo(() => (offline ? offlineSearch(q, kind, downloads) : undefined), [offline, q, kind, downloads]);
  const data = local ?? (q ? query.data : undefined);
  return { data, offline, pending: !!q && !offline && !query.data, error: !offline && query.isError ? query.error : null };
}

const has = (q: string, ...values: (string | null | undefined)[]) => values.some((v) => !!v && v.toLowerCase().includes(q));

/** Searches what's downloaded, with the matchers the tabs use, best name first. */
function offlineSearch(q: string, kind: SearchKind, downloads: Record<string, Download>): SearchResultsDto {
  const k = q.trim().toLowerCase();
  const limit = kind === "all" ? SEARCH_LIMIT.all : SEARCH_LIMIT.kind;
  const want = (tab: SearchKind) => kind === "all" || kind === tab;
  const done = Object.values(downloads).filter((d) => d.status === "done");
  const saved = (type: Download["type"]) => new Set(done.flatMap((d) => (d.type === type ? [d.id] : [])));
  const top = <T>(items: T[], name: (item: T) => string) => byNameTier(items, name, q).slice(0, limit);

  const books = want("books")
    ? (queryClient.getQueryData<BookSummary[]>(keys.books) ?? []).filter((b) => saved("book").has(b.id) && matchesBook(b, k))
    : [];
  const episodes = want("podcasts") ? done.flatMap((d) => (d.type === "podcast" && matchesEpisode(d.episode, k) ? [d.episode] : [])) : [];
  const albumIds = saved("album");
  const albums = want("music")
    ? done.flatMap((d): AlbumSummary[] => (d.type === "album" && albumMatches(d.album, k) ? [d.album] : []))
    : [];
  const songs = want("music")
    ? done.flatMap((d): TrackDto[] =>
        d.type === "track" && !albumIds.has(d.track.albumId) && songMatches(d.track, k) ? [d.track] : d.type === "album" ? d.album.tracks.filter((s) => songMatches(s, k)) : [],
      )
    : [];
  const movieIds = saved("movie");
  const showIds = new Set(done.flatMap((d) => (d.type === "show" ? [d.show.id] : [])));
  const watch: WatchPoster[] = want("watch")
    ? [
        ...(queryClient.getQueryData<MovieSummary[]>(watchKeys.movies) ?? [])
          .filter((m) => movieIds.has(m.id) && has(k, m.title))
          .map((m): WatchPoster => ({ kind: "movie", id: m.id, title: m.title, year: m.year, posterHash: m.posterHash, color: m.color, watched: !!m.progress?.finished, addedAt: m.addedAt })),
        ...(queryClient.getQueryData<ShowSummary[]>(watchKeys.shows) ?? [])
          .filter((s) => showIds.has(s.id) && has(k, s.title))
          .map((s): WatchPoster => ({ kind: "show", id: s.id, title: s.title, year: s.year, posterHash: s.posterHash, color: s.color, watched: s.episodes > 0 && s.watched === s.episodes, addedAt: s.addedAt })),
      ]
    : [];

  return {
    q,
    books: top(books, (b) => b.title),
    authors: [],
    series: [],
    podcasts: [],
    episodes: top(episodes, (e) => e.title),
    artists: [],
    albums: top(albums, (a) => a.title),
    songs: top(songs, (s) => s.title),
    watch: top(watch, (w) => w.title),
    tvEpisodes: [],
  };
}
