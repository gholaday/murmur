import { useSyncExternalStore } from "react";
import { type AudioPlayer, type AudioStatus, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { onlineManager } from "@tanstack/react-query";
import {
  apiPaths,
  type BookDetail,
  bookmarkNear,
  bookmarkSpot,
  bookToPlayable,
  createPlayerCore,
  entryToPlayable,
  type EpisodeWithShow,
  episodeToPlayable,
  isCurrent,
  storageKeys,
  type Playable,
  type PlayerMedia,
  type PlayerState,
  type PlayRef,
  type PlayType,
  type SavedPlace,
  type TrackDto,
  trackToPlayable,
  type UpNextDto,
  type UserPrefs,
} from "@murmur/shared/client";
import { absolute, api, authHeaders, HttpError, refused } from "@/lib/api";
import { addBookmark, bookmarksFor, newBookmark, refreshBookmarks } from "@/lib/bookmarks";
import { fetchBook, fetchEpisode, fetchPrefs, keys } from "@/lib/data";
import { downloadTypeOf, getDownload, localTrackUri, localUri, savedTrack, saveDownloadAds } from "@/lib/downloads";
import { tapHaptic } from "@/lib/haptics";
import { queryClient } from "@/lib/query";
import { getJson, removeKey, setJson } from "@/lib/storage";
import { createStore } from "@/lib/store";
import { toast } from "@/components/toast";
import { adPrefsStore } from "./ad-prefs";
import { CastPlayer, onCastDevice } from "./cast";
import { createLockScreen } from "./lock-screen";
import { flush, listening, queuePlay, queueProgress, saveListening, unsentProgress } from "./progress";

// One audio player for the whole app, kept outside React so playback, the lock screen and
// progress saving carry on whatever screen is showing (or with the screen off). What plays, Up
// Next, saving, ads, the sleep timer and music's hand-over are the shared player core, the same
// one the web player runs; this is the phone's side of it: expo-audio, the Chromecast, the lock
// screen, downloads and putting back what was playing after a restart.

export { bookToPlayable, episodeToPlayable, isCurrent, isPlayingFrom, isWaiting, type MusicSource, type Playable, type PlayerState } from "@murmur/shared/client";

// ---------- Loading an item's details ----------

/**
 * Loads an item's details, falling back to the download's saved copy offline. Progress not yet
 * sent to the server (listened offline) is newer than either, so it wins.
 */
async function loadPlayable(ref: PlayRef): Promise<Playable> {
  return resumeFrom(await loadPlayableDetails(ref));
}

/** `it` starting where it was last left on this phone, when that's newer than what its details say. */
export function resumeFrom(it: Playable): Playable {
  if (it.type === "track") return it; // songs start from the top
  const unsent = unsentProgress(it.type, it.id);
  return unsent && !unsent.finished ? { ...it, startAt: unsent.positionSec } : it;
}

/** An item's details from the server (or from the cache, if they've only just been fetched). */
async function fetchPlayable(ref: PlayRef): Promise<Playable> {
  if (ref.itemType === "track") return trackToPlayable(await api<TrackDto>(apiPaths.track(ref.itemId)));
  if (ref.itemType === "book") return bookToPlayable(await fetchBook(ref.itemId));
  return episodeToPlayable(await fetchEpisode(ref.itemId));
}

/** An item's details as this phone has them, with no request: its download, or Up Next. */
function savedPlayable(ref: PlayRef): Playable | null {
  if (ref.itemType === "track") {
    const saved = savedTrack(ref.itemId);
    if (saved) return trackToPlayable(saved);
  } else {
    const dl = getDownload(downloadTypeOf(ref.itemType), ref.itemId);
    if (dl?.type === "book") return bookToPlayable(dl.book);
    if (dl?.type === "podcast") return episodeToPlayable(dl.episode);
  }
  const entry = core.getState().upNext.items.find((e) => e.itemType === ref.itemType && e.itemId === ref.itemId);
  return entry ? entryToPlayable(entry) : null;
}

async function loadPlayableDetails(ref: PlayRef): Promise<Playable> {
  try {
    return await fetchPlayable(ref);
  } catch (err) {
    const saved = savedPlayable(ref);
    if (saved) return saved;
    throw err;
  }
}

/** What can show at once for an item put back after a restart: the cached details, else the saved ones. */
function cachedPlayable(ref: SavedPlace): Playable | null {
  const book = ref.itemType === "book" ? queryClient.getQueryData<BookDetail>(keys.book(ref.itemId)) : undefined;
  const episode = ref.itemType === "episode" ? queryClient.getQueryData<EpisodeWithShow>(keys.episode(ref.itemId)) : undefined;
  const it = book ? bookToPlayable(book) : episode ? episodeToPlayable(episode) : savedPlayable(ref);
  return it ? resumeFrom(it) : null;
}

// ---------- Audio ----------

// Two players: `player()` is the one playing; the other loads the next song ahead of time so it
// can take over the moment the current one ends. Events from the spare one are ignored. They and
// the audio session are made the first time something loads, not while the app is opening.
let players: AudioPlayer[] | null = null;
let inUse = 0;
const player = () => (players ??= makePlayers())[inUse]!;
const spare = () => (players ??= makePlayers())[1 - inUse]!;

// The patched expo-audio sends the notification's previous and next taps as "remoteTrack", and its
// bookmark button as "remoteBookmark".
type RemoteEmitter = {
  addListener(event: "remoteTrack", fn: (e: { direction: number }) => void): unknown;
  addListener(event: "remoteBookmark", fn: () => void): unknown;
};

function makePlayers() {
  void setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode: "doNotMix", playsInSilentMode: true });
  const made = [0, 1].map(() => createAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: true }));
  for (const p of made) {
    p.addListener("playbackStatusUpdate", (s: AudioStatus) => {
      if (p === made[inUse] && !casting) onStatus(s);
    });
    const remote = p as unknown as RemoteEmitter;
    remote.addListener("remoteTrack", ({ direction }) => {
      if (p === made[inUse]) core.trackStep(direction < 0 ? -1 : 1);
    });
    remote.addListener("remoteBookmark", () => {
      if (p === made[inUse]) bookmarkHere();
    });
  }
  return made;
}

/** The item and file loaded, for the downloaded-copy fallback. */
let loaded: { it: Playable; idx: number } | null = null;
/** The song the spare player has loaded. */
let preloadedItem: Playable | null = null;
let pendingSeek: number | null = null;
/**
 * Set by load until the player reports the new file not loaded yet. A status sent just before the
 * replace still describes the old file, loaded: taken for the new one, it spent the restore seek
 * and gave an episode the song's length (an episode after a song showed 5:12 and stuck there).
 */
let awaitingSource = false;
let autoplayAfterLoad = false;
let rate = 1;
/** Until the restore seek lands the player still reports the file's start, which would reset the place to 0. */
let seeking = false;
/** Whether the loaded file is the phone's downloaded copy rather than the server's stream. */
let playingLocal = false;

/** The downloaded copy of a file, if this phone has one. */
const localFor = (it: Playable, idx: number) => (it.type === "track" ? localTrackUri(it.id) : localUri(it.type, it.id, idx));

function sourceFor(it: Playable, idx: number) {
  const local = localFor(it, idx);
  if (local) return { uri: local };
  const f = it.files[idx];
  return f ? { uri: absolute(f.path), headers: authHeaders() } : null;
}

/** While casting, the Chromecast plays instead of the phone's player; there's no spare, so songs follow each other on the TV with its own short gap. */
let casting = false;

const castPlayer = new CastPlayer({
  loaded: () => {
    core.loaded(castPlayer.duration);
    core.time(castPlayer.position, castPlayer.playing);
    core.playingChanged(castPlayer.playing);
  },
  time: () => core.time(castPlayer.position, castPlayer.playing),
  playing: (playing) => core.playingChanged(playing),
  buffering: (loading) => core.loadingChanged(loading),
  ended: () => core.ended(),
});

const castLoad = (it: Playable, idx: number, inFileSec: number, autoplay: boolean, speed: number) =>
  // The TV starts there itself; a download streams from the server, which the TV can reach.
  castPlayer.load(it.files[idx]?.path ?? "", { title: it.title, subtitle: it.subtitle, image: it.coverPathLarge }, inFileSec, autoplay, speed);

/** What plays: the phone's players, or the Chromecast while casting. */
const media: PlayerMedia = {
  get playing() {
    return casting ? castPlayer.playing : !!players && player().playing;
  },
  get duration() {
    return casting ? castPlayer.duration : players ? player().duration : 0;
  },
  load(it, idx, inFileSec, autoplay, speed) {
    loaded = { it, idx };
    rate = speed;
    if (casting) {
      pendingSeek = null;
      awaitingSource = false;
      playingLocal = false;
      castLoad(it, idx, inFileSec, autoplay, speed);
      return;
    }
    pendingSeek = inFileSec;
    awaitingSource = true;
    autoplayAfterLoad = autoplay;
    playingLocal = !!localFor(it, idx);
    // Playback starts once the place is restored (see onStatus).
    player().replace(sourceFor(it, idx));
  },
  play: () => (casting ? castPlayer.play() : player().play()),
  pause: () => (casting ? castPlayer.pause() : players && player().pause()),
  seekTo: (sec) => (casting ? castPlayer.seek(sec) : void player().seekTo(sec)),
  setRate(r) {
    rate = r;
    if (casting) castPlayer.setRate(r);
    else if (players) player().setPlaybackRate(r);
  },
  preload(it) {
    if (casting) return false;
    preloadedItem = it;
    const p = spare();
    p.replace(sourceFor(it, 0));
    p.setPlaybackRate(1);
    return true;
  },
  swapToPreloaded() {
    const it = preloadedItem;
    preloadedItem = null;
    if (!it) return false;
    loaded = { it, idx: 0 };
    rate = 1;
    pendingSeek = null;
    awaitingSource = false;
    seeking = false;
    autoplayAfterLoad = false;
    const old = player();
    inUse = 1 - inUse;
    playingLocal = !!localFor(it, 0);
    player().setPlaybackRate(1);
    player().play();
    old.pause();
    old.replace(null);
    return true;
  },
  dropPreloaded() {
    preloadedItem = null;
    if (players) spare().replace(null);
  },
  unload() {
    loaded = null;
    if (players) player().pause();
    // Closing or stopping while casting stops the TV too.
    castPlayer.stop();
    if (players) player().replace(null);
  },
};

function onStatus(s: AudioStatus) {
  const { item, error } = core.getState();
  if (!item) return;
  if (s.error) {
    // Downloaded while streaming, then the connection went: carry on from the saved copy.
    if (!playingLocal && loaded && localFor(loaded.it, loaded.idx)) return core.reload(core.getState().playing || autoplayAfterLoad);
    return core.failed();
  }
  // What the failed file reports after its error isn't loading; play loads it again.
  if (error) return;
  if (awaitingSource) {
    if (s.isLoaded) return;
    awaitingSource = false;
  }
  if (s.isLoaded && pendingSeek !== null) {
    const to = pendingSeek;
    pendingSeek = null;
    seeking = true;
    const p = player();
    void p.seekTo(to).then(() => {
      if (p !== player()) return;
      seeking = false;
      p.setPlaybackRate(rate);
      if (autoplayAfterLoad) p.play();
      core.loaded(s.duration);
    });
    return;
  }
  core.loadingChanged(seeking || !s.isLoaded || s.isBuffering);
  // Only the time waits for the restore seek; a pause or the end in that window still counts.
  if (!seeking && s.isLoaded) core.time(s.currentTime, s.playing);
  core.playingChanged(s.playing);
  if (s.didJustFinish) core.ended();
}

// ---------- The core ----------

const lockScreen = createLockScreen({
  item: () => core.getState().item,
  position: () => core.getPosition(),
  skip: () => core.getState().skip,
  player,
  casting: () => casting,
});

const core = createPlayerCore({
  media,
  api: (path, init) => api(path, init),
  toast: (message, action) => toast.show(message, action ? { duration: 5000, action: { label: action.label, onPress: action.run } } : undefined),
  toastError: (message) => toast.error(message),
  refused,
  getJson,
  setJson,
  removeKey,
  saveProgress: queueProgress,
  // Paused, the listening time goes to the server at once; playing, with the next save.
  saveListening: (paused) => saveListening(paused),
  addListening: (type, id, wallSec, movedSec, speed) => listening.add(type, id, wallSec, movedSec, speed),
  countPlay: (trackId, source) =>
    queuePlay({ trackId, source, playId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`, playedAt: Date.now() }),
  loadPlayable,
  adPrefs: () => adPrefsStore.get(),
  // Offline: a download carries the ad times it was saved with.
  savedAds(id) {
    const dl = getDownload("podcast", id);
    return dl?.type === "podcast" ? (dl.ads ?? null) : null;
  },
  adsLoaded: saveDownloadAds,
  // A copy stays on this phone, so Up Next shows offline.
  upNextChanged: (l) => queryClient.setQueryData(keys.upNext, l),
  musicPrefsChanged(prefs) {
    const cached = queryClient.getQueryData<UserPrefs>(keys.prefs);
    if (cached) queryClient.setQueryData<UserPrefs>(keys.prefs, { ...cached, ...prefs });
  },
  itemShown: (it) => (it ? void lockScreen.show(it) : lockScreen.clear()),
  positionMoved: (it, sec) => lockScreen.moved(it, sec),
  skipChanged: () => lockScreen.skipChanged(),
  haptic: tapHaptic,
  now: Date.now,
});

// Your skip settings, shuffle and repeat as last known, and the Up Next saved on this phone, so it
// shows offline too; the server's replace them.
core.init(queryClient.getQueryData<UserPrefs>(keys.prefs), queryClient.getQueryData<UpNextDto>(keys.upNext));

// The core's state in the app's stores, for the hooks below.
const store = createStore(core.getState());
core.subscribe(() => store.set(core.getState()));
// Ticks skip React with the app in the background (screen off, another app open).
const place = createStore(core.getPosition(), { foregroundOnly: true });
core.subscribePosition(() => place.set(core.getPosition()));

// A connected Chromecast takes over where the phone is, playing if it was playing, and Google's
// notification replaces this one. When casting ends, the item comes back here paused, where the TV left it.
onCastDevice((device) => {
  const it = core.getState().item;
  if (device && !casting) {
    const wasPlaying = core.getState().playing;
    casting = true;
    if (players) player().pause();
    lockScreen.clear();
    core.reload(wasPlaying);
  } else if (!device && casting) {
    casting = false;
    castPlayer.release();
    core.playingChanged(false);
    core.reload(false);
    if (it) void lockScreen.show(it);
  }
});

/** The notification's bookmark button: saves this spot, unless it already has one. */
function bookmarkHere() {
  const { item: it, playing, speed } = core.getState();
  const position = core.getPosition();
  if (!it || it.type === "track" || bookmarkNear(bookmarksFor(it.type, it.id), position)) return;
  addBookmark(newBookmark(it, bookmarkSpot(position, playing, speed)));
}

// ---------- For screens ----------

export const getPlayerState = core.getState;
export const getPosition = core.getPosition;

/** Runs `listener` on every player change, outside React (the video player ends when audio starts). */
export const onPlayerChange = (listener: (s: PlayerState) => void) => core.subscribe(() => listener(core.getState()));

export const usePlayer = store.useValue;

/**
 * One value picked from the player state. Return a primitive, so a component (a card in a long
 * grid, say) only renders again when that value changes, not on every player update.
 */
export const usePlayerSelect = store.useSelect;

/** Current position in seconds; only components that show time should subscribe. */
export const usePosition = place.useValue;

/**
 * Something worked out from the position, like the text of a time. A component using it renders
 * only when the answer changes, not on every tick, so return a primitive.
 */
export const usePositionSelect = place.useSelect;

/**
 * The position while this item is the one loaded, else null. Rows in long lists use this so
 * only the playing row re-renders on each tick, not every row on screen.
 */
export function useItemPosition(type: PlayType, id: string): number | null {
  return useSyncExternalStore(
    (l) => {
      const stopPlace = place.subscribe(l);
      const stopState = store.subscribe(l);
      return () => {
        stopPlace();
        stopState();
      };
    },
    () => (isCurrent(store.get(), type, id) ? place.get() : null),
  );
}

export const {
  play,
  playRef,
  playMusic,
  playAt,
  trackStep,
  toggleShuffle,
  cycleRepeat,
  refreshUpNext,
  addToUpNext,
  moveUpNext,
  clearUpNext,
  restoreUpNext,
  removeWaiting,
  jumpTo,
  goBack,
  stayHere,
  toggle,
  pause,
  seek,
  skipBy,
  chapterStep,
  setSpeed,
  setSleep,
  setSkip,
  markCurrent,
  stop,
} = core;

/** Takes out the Up Next item at `index`. */
export const removeAt = core.removeFromUpNext;

/**
 * Marks a book or episode finished, or back to the start, from a list or page. It goes through
 * the outbox like the player's own saves, so it works offline and syncs later.
 */
export function setFinished(itemType: "book" | "episode", itemId: string, durationSec: number, finished: boolean) {
  queueProgress({ itemType, itemId, positionSec: finished ? durationSec : 0, durationSec, finished, updatedAt: Date.now() }, true);
}

// ---------- Restore ----------

/** Called once signed in: loads Up Next and puts back whatever was playing last, paused. */
export async function restorePlayer() {
  void flush();
  void refreshBookmarks();
  // Up Next comes back from the server with its place, so next and previous work after a restart.
  void core.refreshUpNext();
  // Older servers have no shuffle or repeat; those stay off.
  // Unreachable, the last known shuffle and repeat stand, and the next start asks again.
  fetchPrefs().then((p) => core.setMusicPrefs({ shuffle: p.shuffle ?? false, repeat: p.repeat ?? "off" }, false), () => undefined);
  await restoreNowPlaying();
}

/** Puts back what was playing when the app closed, paused: from what's on the phone at once, then as the server has it. */
async function restoreNowPlaying() {
  const saved = getJson<SavedPlace>(storageKeys.nowPlaying);
  if (!saved || core.getState().item) return;
  const cached = cachedPlayable(saved);
  // At the place saved with it, which is newer than the details.
  if (cached) core.restore(saved, cached);
  await refreshRestored(saved, cached ? core.getPosition() : null);
}

/**
 * Brings a restored item up to date, or restores it if nothing could show yet (`shownAt` null).
 * Anything you've done with it since stays. It's only forgotten once the server says it's gone;
 * offline, or with the server down, it tries again when the phone is back online.
 */
async function refreshRestored(saved: SavedPlace, shownAt: number | null) {
  const untouched = () => {
    const s = core.getState();
    return !!s.item && isCurrent(s, saved.itemType, saved.itemId) && !s.playing && !media.playing && Math.abs(core.getPosition() - shownAt!) < 2;
  };
  try {
    const fresh = resumeFrom(await fetchPlayable(saved));
    if (shownAt === null) {
      if (!core.getState().item) core.putBack(fresh);
      return;
    }
    if (!untouched()) return;
    // An episode's length and chapters came from the file and the server since; a book's details are all here.
    const cur = core.getState().item!;
    core.updateItem(fresh.type === "book" ? fresh : { ...cur, startAt: fresh.startAt, speed: fresh.speed }, fresh.startAt);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 410)) {
      if (shownAt === null) removeKey(storageKeys.nowPlaying);
      else if (untouched()) core.clear();
      return;
    }
    // Turned down some other way: asking again would get the same, and what's shown stays playable.
    if (refused(err)) return;
    const unsubscribe = onlineManager.subscribe((online) => {
      if (!online) return;
      unsubscribe();
      void refreshRestored(saved, shownAt);
    });
  }
}
