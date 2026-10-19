import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioStatus } from "expo-audio";
import { File, Directory, Paths } from "expo-file-system";
import { onlineManager } from "@tanstack/react-query";
import {
  apiPaths,
  type BookDetail,
  type ChapterDto,
  type EpisodeWithShow,
  type ItemType,
  type ProgressItem,
  type QueueEntry,
  type QueueRef,
} from "@murmur/shared";
import { absolute, api, authHeaders } from "@/lib/api";
import { fetchBook, fetchEpisode, invalidateListening, keys } from "@/lib/data";
import { getDownload, localUri } from "@/lib/downloads";
import { queryClient } from "@/lib/query";
import { getJson, removeKey, setJson } from "@/lib/storage";

// One audio player for the whole app, kept outside React so playback, the lock screen and
// progress saving carry on whatever screen is showing (or with the screen off).
// Mirrors the web player's engine (apps/server/src/web/player/engine.tsx).

const SAVE_EVERY_MS = 10_000;
const NOW_PLAYING_KEY = "murmur.nowPlaying";
const OUTBOX_KEY = "murmur.progressOutbox";
const SKIP_KEY = "murmur.skip";
/** Android's player tops out at 2x. */
export const MAX_SPEED = 2;
export const MIN_SPEED = 0.5;

export interface PlayableFile {
  path: string;
  startSec: number;
  durationSec: number;
}

/** Anything the player can play: a book (one or more files on one timeline) or an episode. */
export interface Playable {
  type: ItemType;
  id: string;
  title: string;
  subtitle: string | null;
  coverPath: string | null;
  coverPathLarge: string | null;
  color: string | null;
  durationSec: number;
  files: PlayableFile[];
  chapters: ChapterDto[];
  podcastId: string | null;
  startAt: number;
  speed: number;
}

export const clampSpeed = (s: number) => Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, s)) * 100) / 100;

export function bookToPlayable(b: BookDetail): Playable {
  return {
    type: "book",
    id: b.id,
    title: b.title,
    subtitle: b.author,
    coverPath: b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 200) : null,
    coverPathLarge: b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 600) : null,
    color: b.coverColor,
    durationSec: b.durationSec,
    files: b.files.map((f) => ({ path: apiPaths.bookFileUrl(b.id, f.index), startSec: f.startSec, durationSec: f.durationSec })),
    chapters: b.chapters,
    podcastId: null,
    startAt: b.progress && !b.progress.finished ? b.progress.positionSec : 0,
    speed: clampSpeed(b.progress?.speed ?? 1),
  };
}

export function episodeToPlayable(e: EpisodeWithShow): Playable {
  const dur = e.durationSec ?? 0;
  return {
    type: "episode",
    id: e.id,
    title: e.title,
    subtitle: e.podcastTitle,
    coverPath: e.podcastCoverHash ? apiPaths.podcastCoverUrl(e.podcastId, e.podcastCoverHash, 200) : null,
    coverPathLarge: e.podcastCoverHash ? apiPaths.podcastCoverUrl(e.podcastId, e.podcastCoverHash, 600) : null,
    color: e.podcastCoverColor,
    durationSec: dur,
    files: [{ path: apiPaths.episodeUrl(e.id), startSec: 0, durationSec: dur }],
    chapters: [],
    podcastId: e.podcastId,
    startAt: e.progress && !e.progress.finished ? e.progress.positionSec : 0,
    speed: clampSpeed(e.speed),
  };
}

/** Loads an item's details: the download's saved copy first, so it works offline. */
export async function loadPlayable(ref: QueueRef): Promise<Playable> {
  const dl = getDownload(ref.itemType, ref.itemId);
  if (ref.itemType === "book") {
    try {
      return bookToPlayable(await fetchBook(ref.itemId));
    } catch (err) {
      if (dl?.type === "book") return bookToPlayable(dl.book);
      throw err;
    }
  }
  try {
    return episodeToPlayable(await fetchEpisode(ref.itemId));
  } catch (err) {
    if (dl?.type === "episode") return episodeToPlayable(dl.episode);
    throw err;
  }
}

export function chapterAt(chapters: ChapterDto[], position: number): number {
  return chapters.findLastIndex((c) => c.startSec <= position + 0.25);
}

export type SleepTimer = { mode: "off" } | { mode: "timer"; endsAt: number } | { mode: "chapter"; endSec: number };
export interface SkipSettings {
  back: number;
  forward: number;
}

export interface PlayerState {
  item: Playable | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  speed: number;
  sleep: SleepTimer;
  skip: SkipSettings;
  queue: QueueEntry[];
  /** False until the queue has come back from the server once, so screens don't flash "empty". */
  queueLoaded: boolean;
}

// ---------- Store ----------

let state: PlayerState = {
  item: null,
  playing: false,
  loading: false,
  error: null,
  speed: 1,
  sleep: { mode: "off" },
  skip: getJson<SkipSettings>(SKIP_KEY) ?? { back: 10, forward: 30 },
  queue: [],
  queueLoaded: false,
};
let position = 0;
const stateListeners = new Set<() => void>();
const positionListeners = new Set<() => void>();

function set(change: Partial<PlayerState>) {
  state = { ...state, ...change };
  stateListeners.forEach((l) => l());
}

function setPosition(p: number) {
  position = p;
  positionListeners.forEach((l) => l());
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    (l) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    () => state,
  );
}

/** Current position in seconds; only components that show time should subscribe. */
export function usePosition(): number {
  return useSyncExternalStore(
    (l) => {
      positionListeners.add(l);
      return () => positionListeners.delete(l);
    },
    () => position,
  );
}

export const getPosition = () => position;
export const isCurrent = (s: PlayerState, type: ItemType, id: string) => s.item?.type === type && s.item.id === id;

// ---------- Audio ----------

const player = createAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: true });
void setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode: "doNotMix", playsInSilentMode: true });

let fileIndex = 0;
let pendingSeek: number | null = null;
let autoplayAfterLoad = false;
let lastSaved = 0;
let lockScreenActive = false;

const fileAt = (it: Playable, sec: number) => Math.max(0, it.files.findLastIndex((f) => f.startSec <= sec));

function sourceFor(it: Playable, idx: number) {
  const local = localUri(it.type, it.id, idx);
  if (local) return { uri: local };
  const f = it.files[idx];
  return f ? { uri: absolute(f.path), headers: authHeaders() } : null;
}

function load(it: Playable, at: number, autoplay: boolean) {
  const idx = fileAt(it, at);
  fileIndex = idx;
  pendingSeek = at - (it.files[idx]?.startSec ?? 0);
  autoplayAfterLoad = autoplay;
  setPosition(at);
  set({ error: null, loading: true });
  player.replace(sourceFor(it, idx));
  // Playback starts once the position is restored (see the status listener).
}

player.addListener("playbackStatusUpdate", (s: AudioStatus) => {
  const it = state.item;
  if (!it) return;
  if (s.error) {
    set({ loading: false, playing: false, error: "Couldn't play this. Check your connection and try again." });
    return;
  }
  if (s.isLoaded && pendingSeek !== null) {
    const to = pendingSeek;
    pendingSeek = null;
    void player.seekTo(to).then(() => {
      player.setPlaybackRate(state.speed);
      if (autoplayAfterLoad) player.play();
    });
    // Feeds often omit or misstate an episode's length; trust the file.
    if (it.type === "episode" && s.duration > 0 && Math.abs(it.durationSec - s.duration) > 1) {
      set({ item: { ...it, durationSec: s.duration, files: [{ ...it.files[0]!, durationSec: s.duration }] } });
    }
    return;
  }
  if (s.playing !== state.playing || s.isBuffering !== state.loading) {
    const wasPlaying = state.playing;
    set({ playing: s.playing, loading: s.isBuffering || !s.isLoaded });
    if (wasPlaying && !s.playing && !s.didJustFinish) save();
  }
  if (pendingSeek === null && s.isLoaded) {
    const pos = (it.files[fileIndex]?.startSec ?? 0) + s.currentTime;
    setPosition(pos);
    if (s.playing && Date.now() - lastSaved > SAVE_EVERY_MS) save();
    const sl = state.sleep;
    if (sl.mode === "chapter" && pos >= sl.endSec - 0.3) {
      player.pause();
      set({ sleep: { mode: "off" } });
    }
  }
  if (s.didJustFinish) {
    const next = fileIndex + 1;
    if (next < it.files.length) {
      load(it, it.files[next]!.startSec, true);
      return;
    }
    save(true);
    void advance();
  }
});

// ---------- Lock screen ----------

async function artworkFor(it: Playable): Promise<string | undefined> {
  if (!it.coverPathLarge) return undefined;
  try {
    const dir = new Directory(Paths.cache, "artwork");
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `${it.type}-${it.id}-${it.coverPathLarge.split("h=")[1] ?? "x"}.img`);
    if (!file.exists) await File.downloadFileAsync(absolute(it.coverPathLarge), file, { headers: authHeaders() });
    return file.uri;
  } catch {
    return undefined;
  }
}

async function showOnLockScreen(it: Playable) {
  const metadata = {
    title: it.title,
    artist: it.subtitle ?? undefined,
    albumTitle: it.type === "book" ? it.title : (it.subtitle ?? undefined),
    artworkUrl: await artworkFor(it),
  };
  if (state.item !== it && state.item?.id !== it.id) return;
  if (lockScreenActive) player.updateLockScreenMetadata(metadata);
  else player.setActiveForLockScreen(true, metadata, { showSeekBackward: true, showSeekForward: true });
  lockScreenActive = true;
}

// ---------- Progress (saved to an outbox first, so offline listening syncs later) ----------

type Outbox = Record<string, ProgressItem>;

function save(finished = false, refreshLists = finished || !state.playing) {
  const it = state.item;
  if (!it) return;
  const dur = it.durationSec || player.duration || 0;
  const entry: ProgressItem = {
    itemType: it.type,
    itemId: it.id,
    positionSec: finished ? dur : position,
    durationSec: dur,
    finished,
    speed: state.speed,
    updatedAt: Date.now(),
  };
  lastSaved = Date.now();
  const outbox = getJson<Outbox>(OUTBOX_KEY) ?? {};
  outbox[`${it.type}:${it.id}`] = entry;
  setJson(OUTBOX_KEY, outbox);
  void flush(refreshLists);
}

let flushing = false;
let flushAgain = false;
let refreshAfterFlush = false;
async function flush(refreshLists = false) {
  if (refreshLists) refreshAfterFlush = true;
  if (flushing) {
    // Saved while another save is in flight (e.g. marked finished): send it right after.
    flushAgain = true;
    return;
  }
  flushing = true;
  try {
    do {
      flushAgain = false;
      const items = Object.values(getJson<Outbox>(OUTBOX_KEY) ?? {});
      if (items.length === 0) break;
      await api("/api/progress", { method: "PUT", body: { items } });
      // Drop what was sent unless it changed meanwhile.
      const now = getJson<Outbox>(OUTBOX_KEY) ?? {};
      for (const i of items) {
        const k = `${i.itemType}:${i.itemId}`;
        if (now[k]?.updatedAt === i.updatedAt) delete now[k];
      }
      setJson(OUTBOX_KEY, now);
    } while (flushAgain);
    // Lists showing finished state or progress refresh once the server has it.
    if (refreshAfterFlush) {
      refreshAfterFlush = false;
      invalidateListening();
    }
  } catch {
    // Stays in the outbox until the next save or reconnect.
  } finally {
    flushing = false;
  }
}

onlineManager.subscribe((online) => {
  if (online) void flush(true);
});
AppState.addEventListener("change", (s) => {
  if (s === "active") void flush(true);
});

// ---------- Queue ----------

function setQueue(q: QueueEntry[]) {
  set({ queue: q, queueLoaded: true });
  queryClient.setQueryData(keys.queue, q);
}

export async function refreshQueue() {
  try {
    setQueue(await api<QueueEntry[]>("/api/queue"));
  } catch {
    // Keep what we have; offline, that's the honest answer rather than a placeholder forever.
    set({ queueLoaded: true });
  }
}

export async function queueReplace(refs: QueueRef[]) {
  setQueue(await api<QueueEntry[]>("/api/queue", { method: "PUT", body: { items: refs } }));
}

export async function queueAdd(ref: QueueRef, at: "next" | "last") {
  setQueue(await api<QueueEntry[]>("/api/queue", { method: "POST", body: { ...ref, at } }));
}

function removeFromQueue(ref: QueueRef) {
  const q = state.queue;
  if (!q.some((e) => e.itemType === ref.itemType && e.itemId === ref.itemId)) return;
  void queueReplace(
    q.filter((e) => !(e.itemType === ref.itemType && e.itemId === ref.itemId)).map((e) => ({ itemType: e.itemType, itemId: e.itemId })),
  ).catch(() => undefined);
}

async function advance() {
  const next = state.queue[0];
  if (next) await playRef({ itemType: next.itemType, itemId: next.itemId });
}

// ---------- Controls ----------

export function play(it: Playable, startAt?: number) {
  const cur = state.item;
  if (cur && cur.type === it.type && cur.id === it.id) {
    if (startAt !== undefined) seek(startAt);
    player.play();
    return;
  }
  if (cur && state.playing) save();
  set({ item: it, speed: it.speed, sleep: { mode: "off" } });
  load(it, startAt ?? it.startAt, true);
  setJson(NOW_PLAYING_KEY, { itemType: it.type, itemId: it.id } satisfies QueueRef);
  removeFromQueue({ itemType: it.type, itemId: it.id });
  void showOnLockScreen(it);
}

export async function playRef(ref: QueueRef, startAt?: number) {
  try {
    play(await loadPlayable(ref), startAt);
  } catch (err) {
    set({ error: err instanceof Error ? err.message : "Couldn't load that." });
  }
}

export function toggle() {
  if (!state.item) return;
  if (player.playing) player.pause();
  else {
    // Reaching the end then pressing play starts again rather than doing nothing.
    if (state.item.durationSec && position >= state.item.durationSec - 1) seek(0);
    player.play();
  }
}

export const pause = () => player.pause();

export function seek(sec: number) {
  const it = state.item;
  if (!it) return;
  const dur = it.durationSec || player.duration || 0;
  const t = Math.min(Math.max(0, sec), Math.max(0, dur - 0.5));
  const idx = fileAt(it, t);
  if (idx === fileIndex && pendingSeek === null) {
    void player.seekTo(t - (it.files[idx]?.startSec ?? 0));
    setPosition(t);
  } else {
    load(it, t, player.playing);
  }
}

export const skipBy = (delta: number) => seek(position + delta);

export function chapterStep(dir: -1 | 1) {
  const it = state.item;
  if (!it) return;
  if (it.chapters.length === 0) return skipBy(dir * 30);
  const i = chapterAt(it.chapters, position);
  if (dir === 1) {
    const next = it.chapters[i + 1];
    if (next) seek(next.startSec);
    return;
  }
  // Like a CD player: back goes to the start of this chapter unless you're already near it.
  const cur = it.chapters[i];
  if (cur && position - cur.startSec > 3) seek(cur.startSec);
  else seek(it.chapters[Math.max(0, i - 1)]?.startSec ?? 0);
}

export function setSpeed(s: number) {
  const speed = clampSpeed(s);
  set({ speed });
  player.setPlaybackRate(speed);
  const it = state.item;
  if (!it) return;
  set({ item: { ...it, speed } });
  if (it.type === "episode" && it.podcastId) {
    void api(`/api/podcasts/${it.podcastId}`, { method: "PATCH", body: { speed } }).catch(() => undefined);
  } else {
    save();
  }
}

let sleepTimer: ReturnType<typeof setInterval> | null = null;
export function setSleep(s: SleepTimer) {
  set({ sleep: s });
  if (sleepTimer) clearInterval(sleepTimer);
  sleepTimer = null;
  if (s.mode !== "timer") return;
  sleepTimer = setInterval(() => {
    if (Date.now() < s.endsAt) return;
    player.pause();
    setSleep({ mode: "off" });
  }, 1000);
}

export function setSkip(s: SkipSettings) {
  set({ skip: s });
  setJson(SKIP_KEY, s);
}

/** Marks the current item finished (or not) and saves it. */
export function markCurrent(finished: boolean) {
  if (finished) {
    // Finishing clears it from the player, like the web player.
    save(true);
    clear();
  } else {
    seek(0);
    setPosition(0);
    save(false, true);
  }
}

export function stop() {
  if (state.playing) save();
  clear();
}

/** Empties the player without saving; status events for the old item are ignored after this. */
function clear() {
  set({ item: null, playing: false, loading: false, error: null });
  player.pause();
  player.clearLockScreenControls();
  lockScreenActive = false;
  player.replace(null);
  removeKey(NOW_PLAYING_KEY);
}

/** Called once signed in: loads Up Next and puts back whatever was playing last, paused. */
export async function restorePlayer() {
  void flush();
  void refreshQueue();
  const saved = getJson<QueueRef>(NOW_PLAYING_KEY);
  if (!saved || state.item) return;
  try {
    const it = await loadPlayable(saved);
    if (state.item) return;
    set({ item: it, speed: it.speed });
    load(it, it.startAt, false);
    void showOnLockScreen(it);
  } catch {
    removeKey(NOW_PLAYING_KEY);
  }
}
