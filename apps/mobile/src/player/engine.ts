import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { type AudioLockScreenOptions, type AudioMetadata, type AudioPlayer, createAudioPlayer, setAudioModeAsync, type AudioStatus } from "expo-audio";
import { File, Directory, Paths } from "expo-file-system";
import { onlineManager } from "@tanstack/react-query";
import {
  ADS_POLL_MS,
  albumCover,
  apiPaths,
  type BookDetail,
  chapterAt,
  type ChapterDto,
  clampSpeed,
  type EpisodeAdsDto,
  type EpisodeWithShow,
  EMPTY_UP_NEXT,
  type ListeningStore,
  ListeningTracker,
  moveItem as moveListItem,
  nextIndex,
  nextRepeatMode,
  NOW_PLAYING_KEY,
  parseSkip,
  PLAY_COUNTS_AFTER_SEC,
  type PlayType,
  previousIndex,
  type ProgressItem,
  type QueueRef,
  removeAt as removeListItem,
  type RepeatMode,
  SAVE_EVERY_MS,
  setShuffle,
  SKIP_KEY,
  type SkipSettings,
  type SleepTimer,
  startMusic,
  startSingle,
  type TrackDto,
  type UpNextDto,
  type UpNextEntry,
  type UpNextInput,
  type UpNextList,
  type UpNextSource,
  type UserPrefs,
} from "@murmur/shared/client";
import { absolute, api, authHeaders } from "@/lib/api";
import { fetchBook, fetchEpisode, invalidateListening, keys } from "@/lib/data";
import { getDownload, localTrackUri, localUri, savedTrack, saveDownloadAds } from "@/lib/downloads";
import { tapHaptic } from "@/lib/haptics";
import { isIOS } from "@/lib/platform";
import { queryClient } from "@/lib/query";
import { getJson, removeKey, setJson } from "@/lib/storage";
import { toast } from "@/components/toast";
import { adModeFor, adPrefsStore, adToSkip, playedThrough } from "./ad-prefs";

// One audio player for the whole app, kept outside React so playback, the lock screen and
// progress saving carry on whatever screen is showing (or with the screen off).
// Mirrors the web player's engine (apps/server/src/web/player/engine.tsx).

const OUTBOX_KEY = "murmur.progressOutbox";
const LISTENING_KEY = "murmur.listening";

/** Time spent listening per day, for the stats; sent along with progress. */
const listening = new ListeningTracker(
  () => getJson<ListeningStore>(LISTENING_KEY),
  (data) => setJson(LISTENING_KEY, data),
);

export interface PlayableFile {
  path: string;
  startSec: number;
  durationSec: number;
}

/** Anything the player can play: a book (one or more files on one timeline), an episode or a song. */
export interface Playable {
  type: PlayType;
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
  /** A song's album, for "Go to album" and the lock screen. */
  album: { id: string; title: string } | null;
  startAt: number;
  speed: number;
}

/** What was playing, saved on this phone so a restart picks it up. */
type PlayRef = { itemType: PlayType; itemId: string };

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
    album: null,
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
    album: null,
    startAt: e.progress && !e.progress.finished ? e.progress.positionSec : 0,
    speed: clampSpeed(e.speed),
  };
}

/** A song: always from the start, at 1x, with no position kept. */
export function trackToPlayable(t: TrackDto): Playable {
  return {
    type: "track",
    id: t.id,
    title: t.title,
    subtitle: t.artist,
    coverPath: albumCover(t.albumId, t.coverHash),
    coverPathLarge: albumCover(t.albumId, t.coverHash, 600),
    color: null,
    durationSec: t.durationSec,
    files: [{ path: apiPaths.trackUrl(t.id), startSec: 0, durationSec: t.durationSec }],
    chapters: [],
    podcastId: null,
    album: { id: t.albumId, title: t.album },
    startAt: 0,
    speed: 1,
  };
}

/**
 * Loads an item's details, falling back to the download's saved copy offline. Progress not yet
 * sent to the server (listened offline) is newer than either, so it wins.
 */
export async function loadPlayable(ref: PlayRef): Promise<Playable> {
  const it = await loadPlayableDetails(ref);
  const unsent = getJson<Outbox>(OUTBOX_KEY)?.[`${ref.itemType}:${ref.itemId}`];
  return unsent && !unsent.finished ? { ...it, startAt: unsent.positionSec } : it;
}

async function loadPlayableDetails(ref: PlayRef): Promise<Playable> {
  if (ref.itemType === "track") {
    try {
      return trackToPlayable(await api<TrackDto>(apiPaths.track(ref.itemId)));
    } catch (err) {
      const saved = savedTrack(ref.itemId);
      if (saved) return trackToPlayable(saved);
      throw err;
    }
  }
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

export interface PlayerState {
  item: Playable | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  speed: number;
  sleep: SleepTimer;
  skip: SkipSettings;
  /**
   * Up Next: one running list of what played, what's playing (`index`) and what's next, kept on the
   * server. A book isn't in it (index -1), so all of it is still to come.
   */
  upNext: UpNextDto;
  /** False until Up Next has come back from the server once, so screens don't flash "empty". */
  upNextLoaded: boolean;
  /** Ad detection for the current episode; null for books and until the server answers. */
  ads: EpisodeAdsDto | null;
  /** Your shuffle and repeat settings for music, kept on the server so every device shares them. */
  shuffle: boolean;
  repeat: RepeatMode;
}

/** Where music plays from, as the album, artist and Songs screens hand it to the player. */
export interface MusicSource {
  kind: UpNextSource["kind"];
  refId: string | null;
  title: string;
  tracks: TrackDto[];
}

// ---------- Store ----------

let state: PlayerState = {
  item: null,
  playing: false,
  loading: false,
  error: null,
  speed: 1,
  sleep: { mode: "off" },
  skip: parseSkip(getJson<SkipSettings>(SKIP_KEY)),
  // The copy saved on this phone, so Up Next shows offline too; the server's replaces it.
  upNext: queryClient.getQueryData<UpNextDto>(keys.upNext) ?? EMPTY_UP_NEXT,
  upNextLoaded: false,
  ads: null,
  shuffle: false,
  repeat: "off",
};
let position = 0;
const stateListeners = new Set<() => void>();
const positionListeners = new Set<() => void>();

function set(change: Partial<PlayerState>) {
  state = { ...state, ...change };
  if ("item" in change) watchAds();
  stateListeners.forEach((l) => l());
}

// With the app in the background (screen off, another app open) nothing on screen shows the
// position, so ticks skip React entirely; it catches up when the app comes back.
let appActive = AppState.currentState !== "background";
AppState.addEventListener("change", (s) => {
  appActive = s !== "background";
  if (appActive) positionListeners.forEach((l) => l());
});

function setPosition(p: number) {
  position = p;
  if (appActive) positionListeners.forEach((l) => l());
  // The lock screen names the chapter playing, so it changes as a chapter ends.
  const it = state.item;
  if (lockScreenOn && it && it.chapters.length > 1 && chapterAt(it.chapters, p) !== lockScreenChapter) void showOnLockScreen(it);
}

export const getPlayerState = () => state;

/** Runs `listener` on every player change, outside React (the video player ends when audio starts). */
export function onPlayerChange(listener: (s: PlayerState) => void): () => void {
  const l = () => listener(state);
  stateListeners.add(l);
  return () => stateListeners.delete(l);
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

/**
 * One value picked from the player state. Return a primitive, so a component (a card in a long
 * grid, say) only renders again when that value changes, not on every player update.
 */
export function usePlayerSelect<T>(select: (s: PlayerState) => T): T {
  return useSyncExternalStore(
    (l) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    () => select(state),
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

/**
 * The position while this item is the one loaded, else null. Rows in long lists use this so
 * only the playing row re-renders on each tick, not every row on screen.
 */
export function useItemPosition(type: PlayType, id: string): number | null {
  return useSyncExternalStore(
    (l) => {
      positionListeners.add(l);
      stateListeners.add(l);
      return () => {
        positionListeners.delete(l);
        stateListeners.delete(l);
      };
    },
    () => (isCurrent(state, type, id) ? position : null),
  );
}

// ---------- Ads ----------

let adsFor: string | null = null;
let adsTimer: ReturnType<typeof setTimeout> | undefined;
/** Ads (by index) the listener chose to hear with Undo, so auto-skip leaves them alone. */
let adsAllowed = new Set<number>();

/**
 * Asks for the current episode's ad times when the item changes, and again every minute while
 * its scan is still running. Any failure just means no marks, never a playback problem.
 */
function watchAds() {
  const it = state.item;
  const key = it ? `${it.type}:${it.id}` : null;
  if (key === adsFor) return;
  adsFor = key;
  clearTimeout(adsTimer);
  adsAllowed = new Set();
  state = { ...state, ads: null };
  if (!it || it.type !== "episode") return;
  const fetchAds = async () => {
    try {
      const info = await api<EpisodeAdsDto>(apiPaths.episodeAds(it.id));
      if (adsFor !== key) return;
      set({ ads: info });
      saveDownloadAds(it.id, info);
      if (!info.enabled || info.status === "done" || info.status === "failed") return;
    } catch {
      if (adsFor !== key) return;
      // Offline: a download carries the ad times it was saved with.
      const dl = getDownload("episode", it.id);
      if (!state.ads && dl?.type === "episode" && dl.ads) set({ ads: dl.ads });
    }
    adsTimer = setTimeout(() => void fetchAds(), ADS_POLL_MS);
  };
  void fetchAds();
}

let lastTickAt = 0;
let lastListenAt = 0;
let lastListenKey = "";

function countListening(it: Playable, moved: number) {
  const now = Date.now();
  const key = `${it.type}:${it.id}`;
  if (lastListenAt && key === lastListenKey) listening.add(it.type, it.id, (now - lastListenAt) / 1000, moved, state.speed, now);
  lastListenAt = now;
  lastListenKey = key;
}

/**
 * Auto-skip: jumps past an ad break when playback runs into it, never when you seek into one.
 * Normal play means the position moved forward by about as much as the clock did; with the
 * screen off Android spaces out status updates, so this isn't a fixed few seconds. An ad right
 * at the start (a pre-roll) counts as run into when playback starts there.
 */
function maybeSkipAd(prev: number, pos: number) {
  const now = Date.now();
  const elapsed = lastTickAt ? (now - lastTickAt) / 1000 : 0;
  lastTickAt = now;
  if (playedThrough(prev, pos, elapsed, state.speed)) skipAdCrossed(prev, pos);
}

/**
 * Skips the break when a move forward from `prev` to `pos` crossed an ad's start and landed
 * inside it, in Auto-skip mode. Undo goes back to `undoTo` (or the ad's start) and lets it play.
 */
function skipAdCrossed(prev: number, pos: number, undoTo?: number) {
  const spans = state.ads?.enabled ? state.ads.ads : [];
  const it = state.item;
  if (!spans.length || !it) return;
  if (adModeFor(adPrefsStore.get(), it.podcastId) !== "auto") return;
  const brk = adToSkip(spans, prev, pos, adsAllowed, undoTo);
  if (!brk) return;
  seek(brk.endSec);
  toast.show(brk.indexes.length > 1 ? `Skipped ${brk.indexes.length} ads` : "Skipped ad", {
    duration: 5000,
    action: {
      label: "Undo",
      onPress: () => {
        for (const idx of brk.indexes) adsAllowed.add(idx);
        seek(brk.undoTo);
      },
    },
  });
}

export const getPosition = () => position;
export const isCurrent = (s: PlayerState, type: PlayType, id: string) => s.item?.type === type && s.item.id === id;

// ---------- Audio ----------

// Two players: `player` is the one playing; the other loads the next song ahead of time so it
// can take over the moment the current one ends. Events from the spare one are ignored.
const players = [0, 1].map(() => createAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: true }));
let player: AudioPlayer = players[0]!;
const spare = () => (player === players[0] ? players[1]! : players[0]!);
/** The song the spare player has loaded, ready to go. */
let preloaded: string | null = null;
void setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode: "doNotMix", playsInSilentMode: true });

let fileIndex = 0;
let pendingSeek: number | null = null;
/**
 * Set by load until the player reports the new file not loaded yet. A status sent just before the
 * replace still describes the old file, loaded: taken for the new one, it spent the restore seek
 * and gave an episode the song's length (an episode after a song showed 5:12 and stuck there).
 */
let awaitingSource = false;
let autoplayAfterLoad = false;
let seeking = false;
/** Whether the loaded file is the phone's downloaded copy rather than the server's stream. */
let playingLocal = false;
let lastSaved = 0;
/** The player the lock screen and notification are bound to, and whether they show song buttons. */
let lockScreenOn: AudioPlayer | null = null;
let lockScreenSongs = false;
/** The chapter the lock screen shows, or -1 for an item without chapters. */
let lockScreenChapter = -1;
let lockScreenMetadata: AudioMetadata | undefined;

/**
 * Songs get previous and next on the lock screen; books and episodes get the skip buttons,
 * jumping as far as the player's own (iOS; Android has its own).
 */
const lockScreenOptions = (): AudioLockScreenOptions =>
  state.item?.type === "track"
    ? { showSeekBackward: false, showSeekForward: false, showPreviousTrack: true, showNextTrack: true }
    : { showSeekBackward: true, showSeekForward: true, seekBackwardInterval: state.skip.back, seekForwardInterval: state.skip.forward };

const fileAt = (it: Playable, sec: number) => Math.max(0, it.files.findLastIndex((f) => f.startSec <= sec));

/** The downloaded copy of a file, if this phone has one. */
const localFor = (it: Playable, idx: number) => (it.type === "track" ? localTrackUri(it.id) : localUri(it.type, it.id, idx));

function sourceFor(it: Playable, idx: number) {
  const local = localFor(it, idx);
  if (local) return { uri: local };
  const f = it.files[idx];
  return f ? { uri: absolute(f.path), headers: authHeaders() } : null;
}

function load(it: Playable, at: number, autoplay: boolean) {
  const idx = fileAt(it, at);
  fileIndex = idx;
  pendingSeek = at - (it.files[idx]?.startSec ?? 0);
  awaitingSource = true;
  autoplayAfterLoad = autoplay;
  setPosition(at);
  set({ error: null, loading: true });
  playingLocal = !!localFor(it, idx);
  player.replace(sourceFor(it, idx));
  // Playback starts once the position is restored (see the status listener).
}

// The patched expo-audio sends the notification's previous and next taps as "remoteTrack".
type RemoteTrackEmitter = { addListener(event: "remoteTrack", fn: (e: { direction: number }) => void): unknown };

for (const p of players) {
  p.addListener("playbackStatusUpdate", (s: AudioStatus) => {
    if (p === player) onStatus(s);
  });
  (p as unknown as RemoteTrackEmitter).addListener("remoteTrack", ({ direction }) => {
    if (p === player) trackStep(direction < 0 ? -1 : 1);
  });
}

function onStatus(s: AudioStatus) {
  const it = state.item;
  if (!it) return;
  if (s.error) {
    // Downloaded while streaming, then the connection went: carry on from the saved copy.
    if (!playingLocal && localFor(it, fileIndex)) {
      load(it, position, state.playing || autoplayAfterLoad);
      return;
    }
    set({ loading: false, playing: false, error: "Couldn't play this. Check your connection and try again." });
    return;
  }
  if (awaitingSource) {
    if (s.isLoaded) return;
    awaitingSource = false;
  }
  if (s.isLoaded && pendingSeek !== null) {
    const to = pendingSeek;
    pendingSeek = null;
    // Until the seek lands the player still reports the file's start, which would reset the
    // restored position to 0 (and, paused, nothing would correct it).
    seeking = true;
    void player.seekTo(to).then(() => {
      seeking = false;
      setPosition((it.files[fileIndex]?.startSec ?? 0) + to);
      player.setPlaybackRate(state.speed);
      if (autoplayAfterLoad) player.play();
    });
    // Feeds often omit or misstate an episode's length; trust the file.
    if (it.type === "episode" && s.duration > 0 && Math.abs(it.durationSec - s.duration) > 1) {
      set({ item: { ...it, durationSec: s.duration, files: [{ ...it.files[0]!, durationSec: s.duration }] } });
    }
    return;
  }
  const loading = s.isBuffering || !s.isLoaded;
  if (s.playing !== state.playing || loading !== state.loading) {
    const wasPlaying = state.playing;
    set({ playing: s.playing, loading });
    if (wasPlaying && !s.playing && !s.didJustFinish) save();
  }
  if (pendingSeek === null && !seeking && s.isLoaded) {
    const pos = (it.files[fileIndex]?.startSec ?? 0) + s.currentTime;
    const prev = position;
    setPosition(pos);
    if (s.playing) {
      maybeSkipAd(prev, pos);
      countListening(it, pos - prev);
      if (it.type === "track") musicTick(it, pos, pos - prev);
    } else {
      lastTickAt = 0;
      lastListenAt = 0;
    }
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
    if (it.type === "track") {
      save();
      // "End of song" on the sleep timer stops here rather than going on.
      if (state.sleep.mode === "chapter") return set({ sleep: { mode: "off" } });
      // The same song on Repeat one, else what's next in Up Next.
      return playNext(nextIndex(state.upNext, state.repeat, true));
    }
    save(true);
    // A book ends there; nothing starts on its own. An episode goes on down Up Next (repeat is for songs).
    if (it.type === "episode") playNext(nextIndex(state.upNext, "off", true));
  }
}

// ---------- Music ----------

/** Start the next song loading this long before the current one ends, so it follows without a gap. */
const PRELOAD_SEC = 10;
/** Seconds of the current song heard, toward counting it as played; sent once per play. */
let heardSec = 0;
let counted = false;

/** While a song plays: count it once heard long enough, and preload the next one near its end. */
function musicTick(it: Playable, pos: number, heard: number) {
  if (heard > 0 && heard < 5) heardSec += heard;
  const dur = it.durationSec || player.duration || 0;
  const needed = dur > 0 ? Math.min(PLAY_COUNTS_AFTER_SEC, dur / 2) : PLAY_COUNTS_AFTER_SEC;
  if (!counted && heardSec >= needed) {
    counted = true;
    void api(apiPaths.trackPlays, { method: "POST", body: { trackId: it.id } }).catch(() => undefined);
  }
  if (!(dur > 0 && dur - pos < PRELOAD_SEC)) return;
  const next = nextIndex(state.upNext, state.repeat, true);
  const e = typeof next === "number" ? state.upNext.items[next] : undefined;
  if (e?.itemType === "track") preload(e.track);
}

/** The spare player starts loading `track`, so it can take over the moment the current song ends. */
function preload(track: TrackDto) {
  if (preloaded === track.id) return;
  preloaded = track.id;
  const p = spare();
  p.replace(sourceFor(trackToPlayable(track), 0));
  p.setPlaybackRate(1);
}

/** Drops whatever the spare player loaded ahead. */
function dropPreloaded() {
  if (!preloaded) return;
  preloaded = null;
  spare().replace(null);
}

/**
 * Shows and saves `l`, and plays its item at `l.index`: from the spare player when it preloaded
 * that song, so it follows without a gap.
 */
function go(l: UpNextDto, save: "list" | "index") {
  const e = l.items[l.index];
  if (!e) return;
  setList(l, save);
  const it = entryToPlayable(e);
  if (e.itemType === "track" && preloaded === e.itemId) {
    // The gapless hand-over: the spare player already has the song loaded.
    const old = player;
    player = spare();
    preloaded = null;
    fileIndex = 0;
    pendingSeek = null;
    awaitingSource = false;
    seeking = false;
    autoplayAfterLoad = false;
    playingLocal = !!localFor(it, 0);
    lastTickAt = 0;
    lastListenAt = 0;
    heardSec = 0;
    counted = false;
    setPosition(0);
    player.setPlaybackRate(1);
    player.play();
    old.pause();
    old.replace(null);
    // "End of song" was for the one that just ended; a plain timer carries on.
    set({ item: it, speed: 1, error: null, ...(state.sleep.mode === "chapter" ? { sleep: { mode: "off" } as const } : {}) });
    setJson(NOW_PLAYING_KEY, { itemType: it.type, itemId: it.id } satisfies PlayRef);
    void showOnLockScreen(it);
  } else {
    dropPreloaded();
    // Songs play from the start; an episode carries on where you left it.
    play(it, e.itemType === "track" ? 0 : undefined, true);
  }
}

/** Plays the Up Next item at `index`. */
export const playAt = (index: number) => go({ ...state.upNext, index }, "index");

/**
 * Starts music from an album, an artist or a list of songs, from song `index` (-1 for Play: the
 * first song, or any song with shuffle on). Its songs take over Up Next; episodes waiting stay after
 * them. Shuffle follows your setting; `shuffle` true turns it on first, for the Shuffle buttons.
 */
export function playMusic(source: MusicSource, index: number, shuffle = false) {
  if (!source.tracks.length) return;
  if (shuffle && !state.shuffle) setMusicPrefs({ shuffle: true }, true);
  const { kind, refId, title } = source;
  dropPreloaded();
  go(startMusic(state.upNext, { kind, refId, title }, source.tracks.map(trackEntry), index, shuffle || state.shuffle), "list");
}

/** Plays what `nextIndex` picked: the same song again, or another item. */
function playNext(next: "again" | number | null) {
  if (next === null) return;
  if (next !== "again") return playAt(next);
  heardSec = 0;
  counted = false;
  seek(0);
  player.play();
}

/**
 * Previous and next for songs and episodes (and the notification's pair), as the web's: previous
 * restarts the item once it's more than 3 s in. Repeat is for songs; an episode steps through Up
 * Next, and past either end of it moves to the episode beside it in its show's list.
 */
export function trackStep(dir: -1 | 1) {
  const it = state.item;
  if (!it || it.type === "book") return;
  tapHaptic();
  const l = state.upNext;
  const repeat = it.type === "track" ? state.repeat : "off";
  if (dir === -1 && position > 3) return seek(0);
  // Skipping on Repeat one moves on, so repeat drops to the whole list.
  if (dir === 1 && repeat === "one") setMusicPrefs({ repeat: "all" }, true);
  const index = l.index < 0 ? null : dir === 1 ? nextIndex(l, repeat, false) : previousIndex(l, repeat);
  if (typeof index === "number") return playAt(index);
  if (it.type === "track") return dir === -1 ? seek(0) : undefined;
  void api<{ id: string | null }>(apiPaths.episodeNeighbor(it.id, dir)).then(
    ({ id }) => (id ? playRef({ itemType: "episode", itemId: id }) : dir === -1 ? seek(0) : undefined),
    () => undefined,
  );
}

/** Sets shuffle and repeat here, and on the server when `persist` (an older server ignores them). */
function setMusicPrefs(prefs: { shuffle?: boolean; repeat?: RepeatMode }, persist: boolean) {
  set(prefs);
  if (!persist) return;
  const cached = queryClient.getQueryData<UserPrefs>(keys.prefs);
  if (cached) queryClient.setQueryData<UserPrefs>(keys.prefs, { ...cached, ...prefs });
  void api(apiPaths.prefs, { method: "PUT", body: prefs }).catch(() => undefined);
}

/** Turns shuffle on or off, reordering the album's or list's songs still to come. */
export function toggleShuffle() {
  tapHaptic();
  const on = !state.shuffle;
  setMusicPrefs({ shuffle: on }, true);
  if (!state.upNext.source) return;
  setList(setShuffle(state.upNext, on), "list");
}

/** Repeat off, then all, then one. */
export function cycleRepeat() {
  tapHaptic();
  setMusicPrefs({ repeat: nextRepeatMode(state.repeat) }, true);
}

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

/**
 * Shows the item on the lock screen and Control Center (Android's media notification). A book
 * with chapters shows the chapter as the title and the book under it.
 */
async function showOnLockScreen(it: Playable) {
  const ci = it.chapters.length > 1 ? chapterAt(it.chapters, position) : -1;
  lockScreenChapter = ci;
  const chapter = ci >= 0 ? it.chapters[ci] : undefined;
  const metadata: AudioMetadata = {
    title: chapter?.title ?? it.title,
    artist: chapter ? it.title : (it.subtitle ?? undefined),
    albumTitle: it.type === "book" ? it.title : (it.album?.title ?? it.subtitle ?? undefined),
    artworkUrl: await artworkFor(it),
  };
  if (state.item !== it && state.item?.id !== it.id) return;
  lockScreenMetadata = metadata;
  // A new song can be on the other player, and songs show different buttons, so either means
  // setting the controls up again rather than just changing the text.
  const songs = it.type === "track";
  if (lockScreenOn === player && lockScreenSongs === songs) player.updateLockScreenMetadata(metadata);
  else player.setActiveForLockScreen(true, metadata, lockScreenOptions());
  lockScreenOn = player;
  lockScreenSongs = songs;
}

// ---------- Progress (saved to an outbox first, so offline listening syncs later) ----------

type Outbox = Record<string, ProgressItem>;

function save(finished = false, refreshLists = finished || !state.playing) {
  const it = state.item;
  if (!it) return;
  if (it.type === "track") {
    // Songs keep no position; only the listening time goes to the server.
    lastSaved = Date.now();
    listening.persist();
    void flush();
    return;
  }
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
  listening.persist();
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
  let sent = false;
  try {
    for (;;) {
      do {
        flushAgain = false;
        const items = Object.values(getJson<Outbox>(OUTBOX_KEY) ?? {});
        if (items.length === 0) break;
        await api("/api/progress", { method: "PUT", body: { items } });
        sent = true;
        // Drop what was sent unless it changed meanwhile.
        const now = getJson<Outbox>(OUTBOX_KEY) ?? {};
        for (const i of items) {
          const k = `${i.itemType}:${i.itemId}`;
          if (now[k]?.updatedAt === i.updatedAt) delete now[k];
        }
        setJson(OUTBOX_KEY, now);
      } while (flushAgain);
      const report = listening.pending();
      if (report) {
        await api("/api/listening", { method: "PUT", body: report });
        listening.sent(report);
      }
      // Progress saved during the listening upload goes out now, not at the next save.
      if (!flushAgain) break;
    }
    // Lists showing finished state or progress refresh once the server has it. With nothing
    // sent (e.g. just coming back to the app) they're left to React Query's own staleness checks.
    if (refreshAfterFlush && sent) {
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

// ---------- Up Next ----------

const trackEntry = (track: TrackDto): UpNextEntry => ({ itemType: "track", itemId: track.id, added: false, track });
const toRefs = (l: UpNextList): UpNextInput => ({ ...l, items: l.items.map(({ itemType, itemId, added }) => ({ itemType, itemId, added })) });
const entryToPlayable = (e: UpNextEntry): Playable => (e.itemType === "track" ? trackToPlayable(e.track) : episodeToPlayable(e.episode));
const sameRef = (a: QueueRef, b: QueueRef) => a.itemType === b.itemType && a.itemId === b.itemId;

/**
 * Shows a changed list at once and saves it: "list" sends the whole list, "index" only where it's
 * at. A copy stays on this phone, so Up Next shows offline.
 */
function setList(l: UpNextDto, save: "list" | "index" | false) {
  set({ upNext: l, upNextLoaded: true });
  queryClient.setQueryData(keys.upNext, l);
  if (save === "index") void api(apiPaths.upNext, { method: "PATCH", body: { index: l.index } }).catch(() => undefined);
  if (save === "list") void api(apiPaths.upNext, { method: "PUT", body: toRefs(l) }).catch(() => undefined);
}

export async function refreshUpNext() {
  try {
    setList(await api<UpNextDto>(apiPaths.upNext), false);
  } catch {
    // Keep what we have; offline, that's the honest answer rather than a placeholder forever.
    set({ upNextLoaded: true });
  }
}

/** Saves a list with an item this phone has no details for yet (a new episode), and shows the server's copy. */
async function putRefs(l: UpNextInput) {
  setList(await api<UpNextDto>(apiPaths.upNext, { method: "PUT", body: l }), false);
}

/**
 * Adds an item from anywhere, or several in order (an album): "next" after the item playing (and
 * what you added after it), or "last".
 */
export async function addToUpNext(ref: QueueRef | QueueRef[], at: "next" | "last") {
  const body = Array.isArray(ref) ? { items: ref, at } : { ...ref, at };
  setList(await api<UpNextDto>(apiPaths.upNext, { method: "POST", body }), false);
}

/** Takes out the item at `index`. Taking out the one playing moves on, or stops when nothing comes after it. */
export function removeAt(index: number) {
  const was = state.upNext.index;
  const { list, play: next } = removeListItem(state.upNext, index);
  if (next !== null) return go(list, "list");
  setList(list, "list");
  if (index === was) stop();
}

export const moveUpNext = (from: number, to: number) => setList(moveListItem(state.upNext, from, to), "list");

/** Empties what's still to come; what played and the item playing stay. */
export const clearUpNext = () => setList({ ...state.upNext, items: state.upNext.items.slice(0, state.upNext.index + 1) }, "list");

/** Puts back a list from before a change, for Undo. */
export const restoreUpNext = (l: UpNextDto) => setList(l, "list");

/** Whether `ref` is still to come in Up Next (not played already, not playing). */
export const isWaiting = (l: UpNextList, ref: QueueRef) => l.items.some((e, i) => i > l.index && sameRef(e, ref));

/** Takes `ref` out of what's still to come. */
export function removeWaiting(ref: QueueRef) {
  const l = state.upNext;
  const at = l.items.findIndex((e, i) => i > l.index && sameRef(e, ref));
  if (at >= 0) removeAt(at);
}

/** Whether the music playing comes from this album, artist, playlist or your songs. */
export const isPlayingFrom = (s: PlayerState, kind: UpNextSource["kind"], refId: string | null) =>
  s.item?.type === "track" && s.upNext.source?.kind === kind && s.upNext.source.refId === refId;

// ---------- Controls ----------

/**
 * Loads and plays `it`. `fromList` is for Up Next's own items, which leave the list as it is; a
 * book, or an episode from its show, takes over: the songs leave Up Next and waiting episodes stay.
 */
export function play(it: Playable, startAt?: number, fromList = false) {
  const cur = state.item;
  if (cur && cur.type === it.type && cur.id === it.id) {
    if (startAt !== undefined) seek(startAt);
    player.play();
    return;
  }
  if (cur && state.playing) save();
  heardSec = 0;
  counted = false;
  set({ item: it, speed: it.speed, sleep: { mode: "off" } });
  load(it, startAt ?? it.startAt, true);
  setJson(NOW_PLAYING_KEY, { itemType: it.type, itemId: it.id } satisfies PlayRef);
  void showOnLockScreen(it);
  if (fromList || it.type === "track") return;
  dropPreloaded();
  if (it.type === "book") setList(startSingle(state.upNext, null), "list");
  else void putRefs(startSingle(toRefs(state.upNext), { itemType: "episode", itemId: it.id, added: false })).catch(() => undefined);
}

export async function playRef(ref: PlayRef, startAt?: number) {
  try {
    play(await loadPlayable(ref), startAt);
  } catch (err) {
    set({ error: err instanceof Error ? err.message : "Couldn't load that." });
  }
}

export function toggle() {
  if (!state.item) return;
  tapHaptic();
  // After an error the player is stuck; play loads it again from where it was (the
  // downloaded copy if there is one now).
  if (state.error) return load(state.item, position, true);
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
  // While playing, progress saves every few seconds anyway; paused, nothing else would keep it.
  if (!state.playing) save();
}

/**
 * The skip buttons. Skipping forward into an ad counts as running into it, so Auto-skip jumps
 * the break; Undo comes back to where the skip landed.
 */
export function skipBy(delta: number) {
  tapHaptic();
  const from = position;
  seek(from + delta);
  if (delta > 0) skipAdCrossed(from, position, position);
}

/** Previous and next: the chapter, else the song or episode (see trackStep), else 30 s for a book. */
export function chapterStep(dir: -1 | 1) {
  const it = state.item;
  if (!it) return;
  if (it.type === "track") return trackStep(dir);
  // Without chapters, an episode's previous and next move through Up Next and then its show; a book skips 30 s.
  if (it.chapters.length <= 1) return it.type === "book" ? skipBy(dir * 30) : trackStep(dir);
  tapHaptic();
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
  // iOS reads the intervals when the lock screen controls are set up, so set them up again.
  if (isIOS && lockScreenOn === player) player.setActiveForLockScreen(true, lockScreenMetadata, lockScreenOptions());
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
  if (lockScreenOn) lockScreenOn.clearLockScreenControls();
  lockScreenOn = null;
  lockScreenChapter = -1;
  lockScreenMetadata = undefined;
  player.replace(null);
  dropPreloaded();
  removeKey(NOW_PLAYING_KEY);
}

/** Called once signed in: loads Up Next and puts back whatever was playing last, paused. */
export async function restorePlayer() {
  void flush();
  // Up Next comes back from the server with its place, so next and previous work after a restart.
  void refreshUpNext();
  // Older servers have no shuffle or repeat; those stay off.
  api<UserPrefs>(apiPaths.prefs)
    .then((p) => {
      queryClient.setQueryData(keys.prefs, p);
      setMusicPrefs({ shuffle: p.shuffle ?? false, repeat: p.repeat ?? "off" }, false);
    })
    .catch(() => undefined);
  const saved = getJson<PlayRef>(NOW_PLAYING_KEY);
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
