import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import { dehydrate, focusManager, hydrate, onlineManager, QueryClient, type DehydratedState, type Query } from "@tanstack/react-query";
import { HttpError, type SavedPlace, storageKeys } from "@murmur/shared/client";
import { onReach, serverAnswers } from "./api";
import { keys, keyStartsWith } from "./query-keys";
import { getJson, removeKey, setJson } from "./storage";

const LISTS_KEY = storageKeys.queryCache;
const DETAILS_KEY = storageKeys.queryDetails;
const SAVE_DELAY_MS = 2_000;
const SAVED_EPISODES = 50;
/** The most book, album, podcast and movie pages kept for the next launch, the newest ones. */
const SAVED_DETAILS = 30;

/**
 * Server data is cached on the phone, so the library and podcast lists open instantly and
 * still show (with downloads playable) when there's no connection.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 7 * 24 * 60 * 60 * 1000,
      // Something that's gone stays gone: a retry would only hold its page blank, and offline it
      // pauses there for good.
      retry: (count, err) => count < 2 && !(err instanceof HttpError && err.status === 404) && !(err instanceof Error && /Signed out/.test(err.message)),
      networkMode: "offlineFirst",
      // Coming back to the app refreshes only what can change away from it: see lib/changes.ts.
      refetchOnWindowFocus: false,
    },
    mutations: { networkMode: "offlineFirst" },
  },
});

// The data last saved per query. A refetch that brings back the same thing keeps the same object
// (React Query shares unchanged data), so most refetches don't write anything.
const lastData = new Map<string, unknown>();

for (const key of [LISTS_KEY, DETAILS_KEY]) {
  const saved = getJson<DehydratedState>(key);
  if (saved) hydrate(queryClient, saved);
}
// 1.4 saved "your music" lists, which are gone; dropped, they leave the saved copy at its next save.
for (const queryKey of [[...keys.all.albums, "mine"], [...keys.all.tracks, "mine"]]) queryClient.removeQueries({ queryKey, exact: true });
for (const q of queryClient.getQueryCache().getAll()) lastData.set(q.queryHash, q.state.data);

/**
 * Only what the app needs to open offline is saved: library, podcasts, music, Up Next and
 * the pages behind them. Searches, previews and admin screens refetch, which keeps the
 * saved copy (read in full at every launch) small. Pages are saved apart from the lists, so
 * opening one doesn't write every list again, and only the newest few are kept.
 */
const { all } = keys;
const PERSISTED = [
  all.books,
  all.book,
  all.podcasts,
  all.podcast,
  all.episodes,
  all.episode,
  all.newEpisodes,
  all.continueEpisodes,
  all.upNext,
  all.prefs,
  all.music,
  all.album,
  all.artist,
  all.playlists,
  all.playlist,
  all.albums,
  all.artists,
  // What you hid, so search with no connection leaves it out too.
  all.hidden,
  // Movies and shows: the Watch tab, its lists and pages.
  keys.watch.all,
];
const persisted = (key: readonly unknown[]) => PERSISTED.some((p) => keyStartsWith(key, p));

const DETAILS = [all.book, all.podcast, all.episodes, all.episode, all.album, all.artist, all.playlist, keys.watch.allMovies, keys.watch.allShows];
const isDetail = (key: readonly unknown[]) => DETAILS.some((p) => keyStartsWith(key, p));

/** The item playing, whose details put it back on the next launch however long ago they came in. */
function playingDetail(key: readonly unknown[]) {
  const now = getJson<SavedPlace>(storageKeys.nowPlaying);
  const playing = now?.itemType === "book" ? keys.book(now.itemId) : now?.itemType === "episode" ? keys.episode(now.itemId) : null;
  return !!playing && keyStartsWith(key, playing);
}

const worthSaving = (q: Query) => q.state.status === "success" && persisted(q.queryKey);

function saveLists() {
  setJson(LISTS_KEY, dehydrate(queryClient, { shouldDehydrateQuery: (q) => worthSaving(q) && !isDetail(q.queryKey) }));
}

function saveDetails() {
  const details = queryClient.getQueryCache().getAll().filter((q) => worthSaving(q) && isDetail(q.queryKey));
  const newest = details.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt).slice(0, SAVED_DETAILS);
  const kept = new Set<Query>(newest);
  const state = dehydrate(queryClient, { shouldDehydrateQuery: (q) => kept.has(q) || (worthSaving(q) && playingDetail(q.queryKey)) });
  // A long-running show can list over a thousand episodes; offline, the newest ones are enough,
  // and the full list comes back on the next fetch.
  for (const q of state.queries) {
    if (keyStartsWith(q.queryKey, all.episodes) && Array.isArray(q.state.data) && q.state.data.length > SAVED_EPISODES) {
      q.state = { ...q.state, data: q.state.data.slice(0, SAVED_EPISODES), isInvalidated: true };
    }
  }
  setJson(DETAILS_KEY, state);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let listsChanged = false;
let detailsChanged = false;
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "updated" || event.action.type !== "success" || !persisted(event.query.queryKey)) return;
  const data = event.query.state.data;
  if (lastData.get(event.query.queryHash) === data) return;
  lastData.set(event.query.queryHash, data);
  if (isDetail(event.query.queryKey)) detailsChanged = true;
  else listsChanged = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (listsChanged) saveLists();
    if (detailsChanged) saveDetails();
    listsChanged = detailsChanged = false;
  }, SAVE_DELAY_MS);
});

/** Forgets the saved copy, on sign-out, so the next account doesn't open on this one's lists. */
export function clearPersistedCache() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  listsChanged = detailsChanged = false;
  lastData.clear();
  removeKey(LISTS_KEY);
  removeKey(DETAILS_KEY);
}

/** How often to ask again while the server can't be reached and the app is open. */
const RECHECK_MS = 15_000;

/**
 * Offline means the server can't be reached, not that Android sees no internet: a server on
 * the home network works without internet, and a phone with internet may not reach it. No
 * network at all is offline at once; otherwise every request says whether it got through, and
 * while one didn't, the server is asked again now and then (and on a network change or
 * coming back to the app) until it answers.
 */
onlineManager.setEventListener((setOnline) => {
  let connected = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stopTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const check = async () => {
    stopTimer();
    if (!connected) return setOnline(false);
    const reached = await serverAnswers();
    if (connected) mark(reached);
  };
  const mark = (reached: boolean) => {
    setOnline(reached);
    stopTimer();
    if (!reached && connected && AppState.currentState === "active") timer = setTimeout(() => void check(), RECHECK_MS);
  };
  onReach(mark);
  // At launch the first requests tell; only no network at all is known before them.
  void Network.getNetworkStateAsync().then((s) => {
    connected = !!s.isConnected;
    if (!connected) setOnline(false);
  });
  const net = Network.addNetworkStateListener((s) => {
    connected = !!s.isConnected;
    void check();
  });
  const app = AppState.addEventListener("change", (state) => {
    if (state === "active" && !onlineManager.isOnline()) void check();
    else if (state !== "active") stopTimer();
  });
  return () => {
    stopTimer();
    net.remove();
    app.remove();
  };
});

AppState.addEventListener("change", (state) => focusManager.setFocused(state === "active"));

/** Whether the server can be reached, as React Query sees it. */
export const useOnline = () => useSyncExternalStore(onlineManager.subscribe.bind(onlineManager), () => onlineManager.isOnline());
