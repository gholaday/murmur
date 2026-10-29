import { AppState } from "react-native";
import { CHANGES_HEADER, type ChangeKind, createChangesPoller } from "@murmur/shared/client";
import { absolute, authHeaders, onChangesHeader } from "./api";
import { queryClient } from "./query";
import { invalidateWatch } from "./watch";

// Live updates: new books, music, movies and shows appear as scans find them, and posters as
// matching lands. The poller is in packages/shared/src/changes.ts; this wires it to the app.

const QUERIES: Record<Exclude<ChangeKind, "watch">, string[]> = {
  books: ["books", "book"],
  music: ["music", "albums", "album", "artists", "artist", "tracks"],
};

// A request that hangs gives up, so the next poll still runs.
const TIMEOUT_MS = 15_000;

const poller = createChangesPoller({
  fetchToken: async () =>
    (await fetch(absolute("/api/changes"), { headers: authHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS) })).headers.get(CHANGES_HEADER),
  onChange: (kinds) => {
    for (const kind of kinds) {
      if (kind === "watch") invalidateWatch();
      else for (const key of QUERIES[kind]) void queryClient.invalidateQueries({ queryKey: [key] });
    }
  },
});

onChangesHeader(poller.seen);

// Only while the app is in front.
if (AppState.currentState === "active") poller.start();
AppState.addEventListener("change", (s) => (s === "active" ? poller.start() : poller.stop()));
