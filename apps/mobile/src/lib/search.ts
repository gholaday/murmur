import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  albumMatches,
  apiPaths,
  type AlbumSummary,
  type BookSummary,
  byNameTier,
  matchesBook,
  type MovieSummary,
  parseRecent,
  RECENT_SEARCHES_KEY,
  SEARCH_LIMIT,
  type SearchKind,
  type SearchResultsDto,
  type ShowSummary,
  songMatches,
  type TrackDto,
  type WatchPoster,
  withRecent,
} from "@murmur/shared/client";
import { api, HttpError } from "./api";
import { keys } from "./data";
import { type Download, useDownloads } from "./downloads";
import { queryClient, useOnline } from "./query";
import { getJson } from "./storage";
import { createSavedStore, createStore } from "./store";
import { watchKeys } from "./watch";

// Search everywhere: the field lives in the dock, the results on the Search screen, so what's
// typed and which tab is picked sit here where both can reach them.

/** What's typed in the dock's search field. */
export const searchText = createStore("");
/** The Search screen's tab. */
export const searchKind = createStore<SearchKind>("all");

const recent = createSavedStore<string[]>(RECENT_SEARCHES_KEY, parseRecent(getJson<unknown>(RECENT_SEARCHES_KEY)));
export const useRecentSearches = recent.useValue;

/** Puts a search first in the recent list, once. */
export function rememberSearch(q: string) {
  if (q.trim()) recent.set(withRecent(recent.get(), q));
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

const searchQuery = (q: string, kind: SearchKind, enabled: boolean) => ({
  queryKey: ["search", q, kind],
  queryFn: () => api<SearchResultsDto>(apiPaths.search(q, kind)),
  enabled: enabled && !!q,
  // The last results stay up while the next ones load, so the list doesn't blink per letter;
  // only the same kind's, as another kind's wouldn't fit the tab.
  placeholderData: (prev: SearchResultsDto | undefined, prevQuery?: { queryKey: readonly unknown[] }) =>
    prevQuery?.queryKey[2] === kind ? prev : undefined,
  retry: false,
});

/**
 * Results for `q` on a tab: the server's, or when it can't be reached, what's downloaded and
 * matches, from the lists already on the phone. `offline` says which. All is always asked for,
 * as `everything` says which kinds found anything and so which tabs show; a kind's tab asks for
 * its own as well, alongside.
 */
export function useSearch(q: string, kind: SearchKind) {
  const online = useOnline();
  const downloads = useDownloads();
  const allQuery = useQuery(searchQuery(q, "all", true));
  const kindQuery = useQuery(searchQuery(q, kind, kind !== "all"));
  const errors = [allQuery.error, kind === "all" ? null : kindQuery.error].filter((e) => !!e);
  const unreachable = !online || errors.some((e) => !(e instanceof HttpError));
  const offline = !!q && unreachable;
  const local = useMemo(
    () => (offline ? { all: offlineSearch(q, "all", downloads), kind: kind === "all" ? undefined : offlineSearch(q, kind, downloads) } : undefined),
    [offline, q, kind, downloads],
  );
  const everything = local ? local.all : q ? allQuery.data : undefined;
  // Until a kind's own answer comes, its part of All's stands in.
  const data = local ? (local.kind ?? local.all) : !q ? undefined : kind === "all" ? allQuery.data : (kindQuery.data ?? allQuery.data);
  return { data, everything, offline, pending: !!q && !offline && !everything, error: offline ? null : (errors[0] ?? null) };
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
  // Like the server, an episode by its own name or its show's, not its notes.
  const episodes = want("podcasts") ? done.flatMap((d) => (d.type === "podcast" && has(k, d.episode.title, d.episode.podcastTitle) ? [d.episode] : [])) : [];
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
