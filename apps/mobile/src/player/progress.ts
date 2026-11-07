import { AppState } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import { apiPaths, type ListeningStore, ListeningTracker, type ProgressItem, type UpNextSource } from "@murmur/shared/client";
import { api, HttpError } from "@/lib/api";
import { flushBookmarks, forgetBookmarks, refreshBookmarks } from "@/lib/bookmarks";
import { invalidateProgress } from "@/lib/data";
import { getJson, removeKey, setJson } from "@/lib/storage";

// Progress, listening time and song plays: saved on this phone first, so what happens offline
// syncs later. The audio engine and the video player both save through here.

const OUTBOX_KEY = "murmur.progressOutbox";
const LISTENING_KEY = "murmur.listening";
/** How often listening time goes up while playing; a pause sends it right away. */
const LISTENING_EVERY_MS = 60_000;

/** Time spent listening per day, for the stats; sent along with progress. */
export const listening = new ListeningTracker(
  () => getJson<ListeningStore>(LISTENING_KEY),
  (data) => setJson(LISTENING_KEY, data),
);

type Outbox = Record<string, ProgressItem>;

/** Progress saved on this phone that the server hasn't been told about yet, if any. */
export const unsentProgress = (itemType: ProgressItem["itemType"], itemId: string): ProgressItem | undefined =>
  getJson<Outbox>(OUTBOX_KEY)?.[`${itemType}:${itemId}`];

/**
 * Puts a place in the outbox and sends it with the listening totals; offline it waits for the
 * next save or reconnect. The video player saves through here too.
 */
export function queueProgress(entry: ProgressItem, refreshLists: boolean) {
  listening.persist();
  const outbox = getJson<Outbox>(OUTBOX_KEY) ?? {};
  outbox[`${entry.itemType}:${entry.itemId}`] = entry;
  setJson(OUTBOX_KEY, outbox);
  void flush(refreshLists);
}

/** Saves the listening time with no place to go with it: songs keep none, and a hold leaves the real one alone. `now` sends it at once. */
export function saveListening(now: boolean) {
  listening.persist();
  void flush(false, now);
}

let flushing = false;
let flushAgain = false;
let refreshAfterFlush = false;
let listeningDue = false;
let listeningSentAt = 0;

export async function flush(refreshLists = false, listeningNow = refreshLists) {
  // Waiting song plays go out on the same saves and reconnects.
  void flushPlays();
  if (refreshLists) refreshAfterFlush = true;
  if (listeningNow) listeningDue = true;
  if (flushing) {
    // Saved while another save is in flight (e.g. marked finished): send it right after.
    flushAgain = true;
    return;
  }
  flushing = true;
  const sent = new Map<string, ProgressItem>();
  try {
    for (;;) {
      do {
        flushAgain = false;
        const items = Object.values(getJson<Outbox>(OUTBOX_KEY) ?? {});
        if (items.length === 0) break;
        await api("/api/progress", { method: "PUT", body: { items } });
        // Drop what was sent unless it changed meanwhile.
        const now = getJson<Outbox>(OUTBOX_KEY) ?? {};
        for (const i of items) {
          const k = `${i.itemType}:${i.itemId}`;
          sent.set(k, i);
          if (now[k]?.updatedAt === i.updatedAt) delete now[k];
        }
        setJson(OUTBOX_KEY, now);
      } while (flushAgain);
      const report = listeningDue || Date.now() - listeningSentAt >= LISTENING_EVERY_MS ? listening.pending() : null;
      if (report) {
        await api("/api/listening", { method: "PUT", body: report });
        listening.sent(report);
        listeningSentAt = Date.now();
      }
      listeningDue = false;
      // Progress saved during the listening upload goes out now, not at the next save.
      if (!flushAgain) break;
    }
    // Lists showing what was sent refresh once the server has it. With nothing sent (e.g. just
    // coming back to the app) they're left to React Query's own staleness checks.
    if (refreshAfterFlush && sent.size) {
      refreshAfterFlush = false;
      invalidateProgress([...sent.values()]);
    }
  } catch {
    // Stays in the outbox until the next save or reconnect.
  } finally {
    flushing = false;
  }
}

// ---------- Song plays (kept in their own list, so plays made offline count later) ----------

/** A counted play waiting to be sent. Its id makes a retry count once. */
interface PlayEntry {
  trackId: string;
  source: { kind: UpNextSource["kind"]; refId: string | null } | null;
  playId: string;
  playedAt: number;
}

const PLAYS_KEY = "murmur.playOutbox";
/** The most plays kept unsent; a phone offline for months drops the oldest. */
const PLAYS_MAX = 500;

export function queuePlay(entry: PlayEntry) {
  const plays = [...(getJson<PlayEntry[]>(PLAYS_KEY) ?? []), entry].slice(-PLAYS_MAX);
  setJson(PLAYS_KEY, plays);
  playsWaiting = true;
  void flushPlays();
}

let sendingPlays: Promise<void> | null = null;
/** Whether any plays are waiting, so most flushes skip reading the list; null until it's first read. */
let playsWaiting: boolean | null = null;

/**
 * Sends waiting plays oldest first, each taken off once the server has it. One the server turns
 * down (a song that's gone) is dropped; offline or a server error leaves the rest for next time.
 */
function flushPlays(): Promise<void> {
  // Before the block below: with nothing to send it would finish at once and leave `sendingPlays` set for good.
  playsWaiting ??= !!getJson<PlayEntry[]>(PLAYS_KEY)?.length;
  if (!playsWaiting) return sendingPlays ?? Promise.resolve();
  sendingPlays ??= (async () => {
    try {
      for (;;) {
        const next = getJson<PlayEntry[]>(PLAYS_KEY)?.[0];
        if (!next) {
          playsWaiting = false;
          return;
        }
        try {
          await api(apiPaths.trackPlays, { method: "POST", body: next });
        } catch (err) {
          const refused = err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429;
          if (!refused) return;
        }
        setJson(PLAYS_KEY, (getJson<PlayEntry[]>(PLAYS_KEY) ?? []).filter((p) => p.playId !== next.playId));
      }
    } finally {
      sendingPlays = null;
    }
  })();
  return sendingPlays;
}

/** Sends what's waiting in the outbox now (before signing out, say); a failure leaves it there. */
export const flushProgress = () => Promise.all([flush(false, true), flushPlays(), flushBookmarks()]).then(() => undefined);

/** Drops unsent progress, plays, bookmarks and listening minutes, on sign-out: they're this account's, not the next one's. */
export function forgetProgress() {
  removeKey(OUTBOX_KEY);
  removeKey(PLAYS_KEY);
  playsWaiting = false;
  listening.clear();
  forgetBookmarks();
}

onlineManager.subscribe((online) => {
  if (!online) return;
  void flush(true);
  void refreshBookmarks();
});
AppState.addEventListener("change", (s) => {
  if (s !== "active") return;
  void flush(true);
  void refreshBookmarks();
});
