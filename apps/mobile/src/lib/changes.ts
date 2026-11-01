import { AppState } from "react-native";
import { CHANGES_HEADER, type ChangeKind, createChangesPoller } from "@murmur/shared/client";
import { absolute, authHeaders, onChangesHeader } from "./api";
import { keys } from "./data";
import { queryClient } from "./query";
import { invalidateWatch, watchKeys } from "./watch";

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

// The server's count covers scans and edits, not your listening on another device or new episodes,
// so after a while away the lists showing those refresh. Quick trips to another app refresh nothing.
const AWAY_MS = 5 * 60_000;
let leftAt = 0;

function cameBack() {
  poller.start();
  if (!leftAt || Date.now() - leftAt < AWAY_MS) return;
  for (const queryKey of [keys.books, keys.podcasts, keys.newEpisodes, keys.continueEpisodes, keys.serverVersion, watchKeys.home]) void queryClient.invalidateQueries({ queryKey });
}

// Only while the app is in front.
if (AppState.currentState === "active") poller.start();
AppState.addEventListener("change", (s) => {
  if (s === "active") return cameBack();
  poller.stop();
  if (s === "background") leftAt = Date.now();
});
