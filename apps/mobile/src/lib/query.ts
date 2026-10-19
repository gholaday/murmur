import { AppState } from "react-native";
import * as Network from "expo-network";
import { dehydrate, focusManager, hydrate, onlineManager, QueryClient, type DehydratedState } from "@tanstack/react-query";
import { getJson, setJson } from "./storage";

const CACHE_KEY = "murmur.queryCache";
const SAVE_DELAY_MS = 2_000;

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

let saveTimer: ReturnType<typeof setTimeout> | null = null;
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "updated" || event.action.type !== "success") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    setJson(CACHE_KEY, dehydrate(queryClient, { shouldDehydrateQuery: (q) => q.state.status === "success" }));
  }, SAVE_DELAY_MS);
});

// React Query's web defaults don't know about app focus or connectivity on a phone.
onlineManager.setEventListener((setOnline) => {
  const sub = Network.addNetworkStateListener((s) => setOnline(s.isInternetReachable !== false && !!s.isConnected));
  return () => sub.remove();
});

AppState.addEventListener("change", (state) => focusManager.setFocused(state === "active"));
