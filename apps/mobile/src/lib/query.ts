import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import { dehydrate, focusManager, hydrate, onlineManager, QueryClient, type DehydratedState } from "@tanstack/react-query";
import { getJson, setJson } from "./storage";

const CACHE_KEY = "murmur.queryCache";
const SAVE_DELAY_MS = 2_000;
const SAVED_EPISODES = 50;

/**
 * Server data is cached on the phone, so the library and podcast lists open instantly and
 * still show (with downloads playable) when there's no connection.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 7 * 24 * 60 * 60 * 1000,
      retry: (count, err) => count < 2 && !(err instanceof Error && /Signed out/.test(err.message)),
      networkMode: "offlineFirst",
    },
    mutations: { networkMode: "offlineFirst" },
  },
});

const saved = getJson<DehydratedState>(CACHE_KEY);
if (saved) hydrate(queryClient, saved);

/**
 * Only what the app needs to open offline is saved: library, podcasts, your music, Up Next and
 * the pages behind them. Searches, previews, Browse and admin screens refetch, which keeps the
 * saved copy (read in full at every launch) small.
 */
const PERSISTED = new Set([
  "books",
  "book",
  "podcasts",
  "podcast",
  "episodes",
  "episode",
  "newEpisodes",
  "continueEpisodes",
  "queue",
  "prefs",
  "music",
  "album",
  "artist",
  "playlists",
  "playlist",
  // Movies and shows: the Watch tab, its lists and pages.
  "watch",
]);
// Albums, artists and songs come in two scopes; only your own ("mine") is kept, not Browse's "all".
const SCOPED = new Set(["albums", "artists", "tracks"]);
const persisted = (key: readonly unknown[]) =>
  PERSISTED.has(key[0] as string) || (SCOPED.has(key[0] as string) && key[1] === "mine");

let saveTimer: ReturnType<typeof setTimeout> | null = null;
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "updated" || event.action.type !== "success" || !persisted(event.query.queryKey)) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const state = dehydrate(queryClient, { shouldDehydrateQuery: (q) => q.state.status === "success" && persisted(q.queryKey) });
    // A long-running show can list over a thousand episodes; offline, the newest ones are enough,
    // and the full list comes back on the next fetch.
    for (const q of state.queries) {
      if (q.queryKey[0] === "episodes" && Array.isArray(q.state.data) && q.state.data.length > SAVED_EPISODES) {
        q.state = { ...q.state, data: q.state.data.slice(0, SAVED_EPISODES), dataUpdatedAt: 0 };
      }
    }
    setJson(CACHE_KEY, state);
  }, SAVE_DELAY_MS);
});

// React Query's web defaults don't know about app focus or connectivity on a phone.
onlineManager.setEventListener((setOnline) => {
  const sub = Network.addNetworkStateListener((s) => setOnline(s.isInternetReachable !== false && !!s.isConnected));
  return () => sub.remove();
});

AppState.addEventListener("change", (state) => focusManager.setFocused(state === "active"));

/** Whether the phone has a connection, as React Query sees it. */
export const useOnline = () => useSyncExternalStore(onlineManager.subscribe.bind(onlineManager), () => onlineManager.isOnline());
