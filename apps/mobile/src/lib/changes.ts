import { AppState } from "react-native";
import { apiPaths, CHANGES_HEADER, type ChangeKind, createChangesPoller } from "@murmur/shared/client";
import { absolute, authHeaders, onChangesHeader } from "./api";
import { queryClient } from "./query";
import { keys } from "./query-keys";
import { invalidateWatch } from "./watch";

// Live updates: new books, music, movies and shows appear as scans find them, and posters as
// matching lands. The poller is in packages/shared/src/changes.ts; this wires it to the app.

const { all } = keys;
const QUERIES: Record<Exclude<ChangeKind, "watch">, (readonly unknown[])[]> = {
  books: [all.books, all.book],
  music: [all.music, all.albums, all.album, all.artists, all.artist, all.tracks],
};

// A request that hangs gives up, so the next poll still runs.
const TIMEOUT_MS = 15_000;

const poller = createChangesPoller({
  fetchToken: async () =>
    (await fetch(absolute(apiPaths.changes), { headers: authHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS) })).headers.get(CHANGES_HEADER),
  onChange: (kinds) => {
    for (const kind of kinds) {
      if (kind === "watch") invalidateWatch();
      else for (const queryKey of QUERIES[kind]) void queryClient.invalidateQueries({ queryKey });
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
  for (const queryKey of [keys.books, keys.podcasts, keys.newEpisodes, keys.continueEpisodes, keys.serverVersion, keys.watch.home]) void queryClient.invalidateQueries({ queryKey });
}

// Only while the app is in front.
if (AppState.currentState === "active") poller.start();
AppState.addEventListener("change", (s) => {
  if (s === "active") return cameBack();
  poller.stop();
  if (s === "background") leftAt = Date.now();
});
