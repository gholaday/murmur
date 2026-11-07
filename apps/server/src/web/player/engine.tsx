"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  type AdSpan,
  type AlbumDetail,
  apiPaths,
  bookToPlayable,
  createPlayerCore,
  type EpisodeWithShow,
  episodeToPlayable,
  isCurrent,
  isPlayingFrom,
  isWaiting,
  type ListeningStore,
  ListeningTracker,
  type MusicSource,
  storageKeys,
  type Playable,
  type PlayerCore,
  type PlayerMedia,
  type PlayerState,
  type PlayRef,
  type PlayType,
  type ProgressItem,
  type QueueRef,
  type SavedPlace,
  type TrackDto,
  trackToPlayable,
  type UpNextSource,
  type UserPrefs,
  type BookDetail,
} from "@murmur/shared/client";
import { api, refused } from "../api";
import { useBookmarkSync } from "../bookmarks";
import { CAST_FAILED, CastMedia, MEDIA_EVENTS, type MediaEventName, stopCasting, useCast } from "../cast/cast";
import { getJson, removeKey, setJson } from "../storage";
import { adPrefsStore } from "./ad-prefs";
import { effectiveVolume, volumeStore } from "./volume";

// The web's side of the shared player (packages/shared/src/player-core.ts): two <audio> elements
// (one plays, the other loads the next song ahead of time) or the Chromecast, saving to the server
// and this browser, and the React hooks screens read the player through.

export { bookToPlayable, episodeToPlayable, type MusicSource, type Playable };

/** Where an item's page is. */
export function playableHref(it: Playable): string {
  if (it.type === "book") return `/book/${it.id}`;
  if (it.type === "track") return `/music/album/${it.album?.id ?? ""}`;
  return `/podcasts/${it.podcastId ?? ""}`;
}

/** Album cover colours, looked up once per album: songs carry none of their own. */
const albumColors = new Map<string, string | null>();

/** The colour to tint the player with: the item's own, or a song's album cover colour. */
export function useTint(item: Playable | null): string | null {
  const albumId = item?.color ? undefined : item?.album?.id;
  const [, loaded] = useState(0);
  useEffect(() => {
    if (!albumId || albumColors.has(albumId)) return;
    albumColors.set(albumId, null);
    api<AlbumDetail>(apiPaths.album(albumId)).then(
      (a) => {
        albumColors.set(albumId, a.coverColor);
        loaded((n) => n + 1);
      },
      () => albumColors.delete(albumId),
    );
  }, [albumId]);
  return item?.color ?? (albumId ? (albumColors.get(albumId) ?? null) : null);
}

// ---------- Listening time and progress ----------

const { listening: LISTENING_KEY, nowPlaying: NOW_PLAYING_KEY } = storageKeys;
let listeningTracker: ListeningTracker | null = null;

/** Time spent listening per day, for the stats; sent along with progress. */
function listening(): ListeningTracker {
  return (listeningTracker ??= new ListeningTracker(
    () => getJson<ListeningStore>(LISTENING_KEY),
    (data) => setJson(LISTENING_KEY, data),
  ));
}

/** Watching counts like listening: the video player adds its time here and sends it with its progress. */
export function addWatching(videoId: string, wallSec: number, movedSec: number, speed: number) {
  listening().add("video", videoId, wallSec, movedSec, speed);
}

export async function sendListening(keepalive = false) {
  const tracker = listening();
  tracker.persist();
  const report = tracker.pending();
  if (!report) return;
  await api(apiPaths.listening, { method: "PUT", body: report, keepalive });
  tracker.sent(report);
}

/** The latest place not yet on the server; the next save, or coming back online, sends it. */
let unsaved: ProgressItem | null = null;

async function flush() {
  const pending = unsaved;
  try {
    if (pending) {
      await api(apiPaths.progress, { method: "PUT", body: { items: [pending] }, keepalive: true });
      if (unsaved === pending) unsaved = null;
    }
    await sendListening(true);
  } catch {
    // Kept in `unsaved`; the next save or coming back online retries it.
  }
}

async function loadPlayable(ref: PlayRef): Promise<Playable> {
  if (ref.itemType === "book") return bookToPlayable(await api<BookDetail>(apiPaths.book(ref.itemId)));
  if (ref.itemType === "track") return trackToPlayable(await api<TrackDto>(apiPaths.track(ref.itemId)));
  return episodeToPlayable(await api<EpisodeWithShow>(apiPaths.episode(ref.itemId)));
}

// ---------- The audio: two <audio> elements, or the Chromecast ----------

/** What plays: one of the <audio> elements, or the Chromecast while casting. */
type Media = HTMLAudioElement | CastMedia;

/**
 * The shared player's audio. `current` plays; `spare` loads the next song ahead of time and its
 * events are ignored until it takes over. While casting the Chromecast plays and there's no spare.
 */
class WebMedia implements PlayerMedia {
  players: [HTMLAudioElement | null, HTMLAudioElement | null] = [null, null];
  current: Media | null = null;
  /** In-file seconds to seek to once the loaded file's details arrive. */
  pendingSeek: number | null = null;
  speed = 1;

  get spare(): HTMLAudioElement | null {
    if (this.current instanceof CastMedia) return null;
    return this.players[0] === this.current ? this.players[1] : this.players[0];
  }

  get playing() {
    return !!this.current && !this.current.paused;
  }

  get duration() {
    const d = this.current?.duration ?? 0;
    return Number.isFinite(d) ? d : 0;
  }

  load(it: Playable, fileIndex: number, inFileSec: number, autoplay: boolean, speed: number) {
    const el = this.current;
    if (!el) return;
    this.pendingSeek = inFileSec;
    this.speed = speed;
    el.src = it.files[fileIndex]?.path ?? "";
    if (el instanceof CastMedia) {
      el.startAt = inFileSec;
      el.autoplay = autoplay;
    }
    el.load();
    el.playbackRate = speed;
    if (autoplay) void el.play().catch(() => undefined);
  }

  play() {
    void this.current?.play().catch(() => undefined);
  }

  pause() {
    this.current?.pause();
  }

  seekTo(inFileSec: number) {
    if (this.current) this.current.currentTime = inFileSec;
  }

  setRate(rate: number) {
    this.speed = rate;
    if (this.current) this.current.playbackRate = rate;
  }

  preload(it: Playable) {
    const el = this.spare;
    if (!el) return false;
    el.preload = "auto";
    el.src = it.files[0]?.path ?? "";
    el.load();
    return true;
  }

  swapToPreloaded() {
    const next = this.spare;
    const old = this.current;
    if (!next?.getAttribute("src")) return false;
    this.current = next;
    this.pendingSeek = null;
    this.speed = 1;
    next.playbackRate = 1;
    void next.play().catch(() => undefined);
    if (old) empty(old);
    return true;
  }

  dropPreloaded() {
    const el = this.spare;
    if (el) empty(el);
  }

  unload() {
    for (const el of [this.current, this.spare]) if (el) empty(el);
  }
}

function empty(el: Media) {
  el.pause();
  el.removeAttribute("src");
  el.load();
}

// ---------- React ----------

/** The player for screens: its state, plus its controls. */
export interface PlayerApi extends Omit<PlayerState, "ads"> {
  expanded: boolean;
  /** The server finds ads (the ad detection add-on is set up). */
  adsEnabled: boolean;
  /** Ad times for the current episode, empty until it's scanned. */
  ads: AdSpan[];
  isCurrent: (type: PlayType, id: string) => boolean;
  /** True while the current song comes from this album, artist, playlist or song list. */
  isPlayingFrom: (kind: UpNextSource["kind"], refId: string | null) => boolean;
  /** True while `ref` is still to come in Up Next. */
  isWaiting: (ref: QueueRef) => boolean;
  playMusic: PlayerCore["playMusic"];
  playAt: PlayerCore["playAt"];
  removeAt: PlayerCore["removeFromUpNext"];
  moveItem: PlayerCore["moveUpNext"];
  clearUpNext: PlayerCore["clearUpNext"];
  restoreUpNext: PlayerCore["restoreUpNext"];
  addToUpNext: PlayerCore["addToUpNext"];
  removeWaiting: PlayerCore["removeWaiting"];
  trackStep: PlayerCore["trackStep"];
  toggleShuffle: PlayerCore["toggleShuffle"];
  cycleRepeat: PlayerCore["cycleRepeat"];
  play: (item: Playable, startAt?: number) => void;
  playRef: PlayerCore["playRef"];
  toggle: PlayerCore["toggle"];
  pause: PlayerCore["pause"];
  seek: PlayerCore["seek"];
  /** Goes to a bookmark, in this item or another, offering a way back to your real place. */
  jumpTo: (ref: PlayRef, sec: number) => Promise<void>;
  goBack: PlayerCore["goBack"];
  stayHere: PlayerCore["stayHere"];
  skipBy: PlayerCore["skipBy"];
  chapterStep: PlayerCore["chapterStep"];
  setSpeed: PlayerCore["setSpeed"];
  setSleep: PlayerCore["setSleep"];
  setSkip: PlayerCore["setSkip"];
  /** Points the browser's media controls back at the audio player, once a video has let go of them. */
  claimMediaSession: () => void;
  setExpanded: (open: boolean) => void;
  /** Marks the current item finished (or not) and saves it; resolves once saved. */
  markCurrent: (finished: boolean) => Promise<void>;
  /** Saves where it was and unloads; resolves once that save is done (signing out waits for it). */
  stop: PlayerCore["stop"];
}

const PlayerContext = createContext<PlayerApi | null>(null);
const CoreContext = createContext<{ core: PlayerCore; api: { get: () => PlayerApi; subscribe: (l: () => void) => () => void } } | null>(null);

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

function useCore() {
  const ctx = useContext(CoreContext);
  if (!ctx) throw new Error("player hooks must be used inside PlayerProvider");
  return ctx;
}

/**
 * One value from the player: a row re-renders only when its own answer changes, not on every
 * play, pause or Up Next change. `select` must return a plain value, not a new object.
 */
export function usePlayerSelect<T>(select: (p: PlayerApi) => T): T {
  const { api: store } = useCore();
  const read = () => select(store.get());
  return useSyncExternalStore(store.subscribe, read, read);
}

type PlayerControls = { [K in keyof PlayerApi as PlayerApi[K] extends (...args: never[]) => unknown ? K : never]: PlayerApi[K] };

/** The player's actions, for click handlers. The object never changes, so using it never re-renders. */
export function usePlayerControls(): PlayerControls {
  const { api: store } = useCore();
  return useMemo(
    () =>
      new Proxy({} as PlayerControls, {
        // Only the player's functions; anything else (symbols, `then`, devtools probes) isn't there.
        get: (_, key) =>
          typeof key === "string" && typeof store.get()[key as keyof PlayerApi] === "function"
            ? (...args: unknown[]) => (store.get()[key as keyof PlayerApi] as (...a: unknown[]) => unknown)(...args)
            : undefined,
      }),
    [store],
  );
}

const zero = () => 0;
const ignore = () => () => {};

/**
 * Current position in seconds. Pass `false` when this component isn't showing the current item,
 * so long lists don't re-render on every tick; it then reads 0.
 */
export function usePosition(enabled = true): number {
  const { core } = useCore();
  return useSyncExternalStore(enabled ? core.subscribePosition : ignore, enabled ? core.getPosition : zero, zero);
}

type NowPlaying = { type: PlayType; id: string; podcastId: string | null; playing: boolean };

/**
 * Whether what's loaded is this row's (`mine`), and playing. A row re-renders only when its own
 * answer changes, so long grids stay cheap.
 */
export function useNowPlaying(mine: (now: NowPlaying) => boolean): { current: boolean; playing: boolean } {
  const { core } = useCore();
  const state = useSyncExternalStore(
    core.subscribe,
    () => {
      const { item, playing } = core.getState();
      return item && mine({ type: item.type, id: item.id, podcastId: item.podcastId, playing }) ? (playing ? 2 : 1) : 0;
    },
    zero,
  );
  return { current: state > 0, playing: state === 2 };
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [media] = useState(() => new WebMedia());
  const [core] = useState(() =>
    createPlayerCore({
      media,
      api: (path, init) => api(path, init),
      refused,
      toast: (message, action) => toast(message, action ? { duration: 5000, action: { label: action.label, onClick: action.run } } : undefined),
      toastError: (message) => toast.error(message),
      getJson,
      setJson,
      removeKey,
      async saveProgress(entry, refreshLists) {
        unsaved = entry;
        await flush();
        // Pages showing played state (book, podcast, library) catch up once a finish lands.
        if (refreshLists && entry.finished) routerRef.current.refresh();
      },
      saveListening: () => flush(),
      addListening: (type, id, wallSec, movedSec, speed) => listening().add(type, id, wallSec, movedSec, speed),
      countPlay: (trackId, source) => void api(apiPaths.trackPlays, { method: "POST", body: { trackId, source } }).catch(() => undefined),
      loadPlayable,
      adPrefs: () => adPrefsStore.get(),
      positionMoved: (it, sec) => updatePositionState(it, sec, media.speed),
      now: () => performance.now(),
    }),
  );
  const state = useSyncExternalStore(core.subscribe, core.getState, core.getState);
  const [expanded, setExpanded] = useState(false);
  useBookmarkSync();

  // The elements keep their volume across sources, so it's set once and on every change.
  const castMedia = useRef<CastMedia | null>(null);
  useEffect(() => {
    media.current ??= media.players[0];
    const apply = () => {
      for (const el of [...media.players, castMedia.current]) if (el) el.volume = effectiveVolume(volumeStore.get());
    };
    apply();
    return volumeStore.subscribe(apply);
  }, [media]);

  // ---------- Startup: settings, queue, and whatever was playing last ----------

  useEffect(() => {
    core.init(null);
    // Up Next comes back from the server with its place, so next and previous work after a reload.
    void core.refreshUpNext();
    api<UserPrefs>(apiPaths.prefs)
      .then((p) => core.setMusicPrefs({ shuffle: p.shuffle, repeat: p.repeat }, false))
      .catch(() => undefined);
    const saved = getJson<SavedPlace>(NOW_PLAYING_KEY);
    if (!saved) return;
    loadPlayable(saved).then(
      (it) => !core.getState().item && core.restore(saved, it),
      () => removeKey(NOW_PLAYING_KEY),
    );
  }, [core]);

  // Save when the page is hidden or closed, and retry unsaved progress once back online.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && media.playing) void core.save();
    };
    const onOnline = () => void flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("online", onOnline);
    };
  }, [core, media]);

  // ---------- Lock screen, notification and headset controls ----------

  /**
   * Points the browser's media controls at the audio player. The video player takes them over
   * while it's open and hands them back through this when it closes.
   */
  const claimMediaSession = useMemo(
    () => () => {
      if (!("mediaSession" in navigator)) return;
      const ms = navigator.mediaSession;
      const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
        try {
          ms.setActionHandler(action, fn);
        } catch {
          // unsupported action
        }
      };
      const skip = () => core.getState().skip;
      set("play", () => core.toggle());
      set("pause", () => core.toggle());
      set("seekbackward", (d) => core.skipBy(-(d.seekOffset ?? skip().back)));
      set("seekforward", (d) => core.skipBy(d.seekOffset ?? skip().forward));
      // Previous and next mean the song for music, the chapter otherwise.
      set("previoustrack", () => core.chapterStep(-1));
      set("nexttrack", () => core.chapterStep(1));
      set("seekto", (d) => d.seekTime !== undefined && core.seek(d.seekTime));
      const it = core.getState().item;
      ms.metadata = it
        ? new MediaMetadata({
            title: it.title,
            artist: it.subtitle ?? "",
            album: it.type === "book" ? it.title : (it.subtitle ?? ""),
            artwork: it.coverPathLarge ? [{ src: it.coverPathLarge, sizes: "600x600", type: "image/webp" }] : [],
          })
        : null;
    },
    [core],
  );
  useEffect(() => claimMediaSession(), [claimMediaSession, state.item]);
  // An emptied player closes.
  useEffect(() => {
    if (!state.item) setExpanded(false);
  }, [state.item]);

  // ---------- The screens' view of it ----------

  const controls = useMemo(
    () => ({
      playMusic: core.playMusic,
      playAt: core.playAt,
      removeAt: core.removeFromUpNext,
      moveItem: core.moveUpNext,
      clearUpNext: core.clearUpNext,
      restoreUpNext: core.restoreUpNext,
      addToUpNext: core.addToUpNext,
      removeWaiting: core.removeWaiting,
      trackStep: core.trackStep,
      toggleShuffle: core.toggleShuffle,
      cycleRepeat: core.cycleRepeat,
      play: (item: Playable, startAt?: number) => core.play(item, startAt),
      playRef: core.playRef,
      toggle: core.toggle,
      pause: core.pause,
      seek: core.seek,
      async jumpTo(ref: PlayRef, sec: number) {
        // Go back lives in the full player.
        if (await core.jumpTo(ref, sec)) setExpanded(true);
      },
      goBack: core.goBack,
      stayHere: core.stayHere,
      skipBy: core.skipBy,
      chapterStep: core.chapterStep,
      setSpeed: core.setSpeed,
      setSleep: core.setSleep,
      setSkip: core.setSkip,
      claimMediaSession,
      setExpanded,
      async markCurrent(finished: boolean) {
        await core.markCurrent(finished);
        // A finish refreshes the pages as it saves; back to the start needs it here.
        if (!finished) routerRef.current.refresh();
      },
      stop: core.stop,
    }),
    [core, claimMediaSession],
  );

  const value = useMemo<PlayerApi>(
    () => ({
      ...state,
      ...controls,
      expanded,
      adsEnabled: state.ads?.enabled ?? false,
      ads: state.ads?.ads ?? [],
      isCurrent: (type, id) => isCurrent(state, type, id),
      isPlayingFrom: (kind, refId) => isPlayingFrom(state, kind, refId),
      isWaiting: (ref) => isWaiting(state.upNext, ref),
    }),
    [state, controls, expanded],
  );

  // ---------- Events from the audio ----------

  // The same whether an <audio> element or the Chromecast sends them. Events from anything but
  // the current one (the spare player preloading) are ignored.
  const onMedia: Record<MediaEventName, (el: Media) => void> = {
    loadedmetadata: (el) => {
      if (media.pendingSeek !== null) {
        el.currentTime = media.pendingSeek;
        media.pendingSeek = null;
      }
      el.playbackRate = media.speed;
      core.loaded(el.duration);
    },
    waiting: () => core.loadingChanged(true),
    playing: () => core.loadingChanged(false),
    timeupdate: (el) => {
      if (media.pendingSeek === null) core.time(el.currentTime, !el.paused);
    },
    play: () => core.playingChanged(true),
    pause: () => core.playingChanged(false),
    seeked: () => updatePositionState(core.getState().item, core.getPosition(), media.speed, true),
    ended: () => core.ended(),
    error: (el) => {
      if (!core.getState().item || !el.getAttribute("src")) return;
      if (el instanceof CastMedia) {
        // Ending the cast brings the item back here, where it can still play.
        core.playingChanged(false);
        toast.error(CAST_FAILED);
        stopCasting();
        return;
      }
      core.failed();
    },
  };
  const onMediaRef = useRef(onMedia);
  onMediaRef.current = onMedia;
  const fire = (name: MediaEventName, el: Media) => {
    if (el === media.current) onMediaRef.current[name](el);
  };

  // Casting: a connected Chromecast takes over from the <audio> element where it is, playing if
  // it was playing; when casting ends, the item comes back here paused, where the TV left it.
  const castDevice = useCast().device;
  useEffect(() => {
    if (castDevice && !(media.current instanceof CastMedia)) {
      if (!castMedia.current) {
        const cm = new CastMedia(() => {
          const now = core.getState().item;
          return now && { title: now.title, subtitle: now.subtitle, image: now.coverPathLarge };
        });
        for (const name of MEDIA_EVENTS) cm.addEventListener(name, () => fire(name, cm));
        castMedia.current = cm;
      }
      const wasPlaying = media.playing;
      for (const p of media.players) p?.pause();
      media.current = castMedia.current;
      castMedia.current.volume = effectiveVolume(volumeStore.get());
      core.reload(wasPlaying);
    } else if (!castDevice && media.current instanceof CastMedia) {
      media.current.release();
      media.current = media.players[0];
      core.playingChanged(false);
      core.reload(false);
    }
    // Only when casting starts or ends; `fire` reads the latest handlers through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castDevice, core, media]);

  const [apiStore] = useState(() => {
    let current = value;
    const listeners = new Set<() => void>();
    return {
      get: () => current,
      set: (next: PlayerApi) => void (current = next),
      notify: () => listeners.forEach((l) => l()),
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };
  });
  // Set during render on purpose: children rendering in this same pass read the new value, so
  // nothing tears within a commit. Subscribers hear about it once it's committed, below.
  apiStore.set(value);
  useLayoutEffect(() => apiStore.notify(), [apiStore, value]);
  const coreValue = useMemo(() => ({ core, api: apiStore }), [core, apiStore]);

  return (
    <PlayerContext.Provider value={value}>
      <CoreContext.Provider value={coreValue}>
        {children}
        {[0, 1].map((n) => (
          <audio
            key={n}
            ref={(el) => {
              media.players[n] = el;
            }}
            preload="metadata"
            onLoadedMetadata={(e) => fire("loadedmetadata", e.currentTarget)}
            onWaiting={(e) => fire("waiting", e.currentTarget)}
            onPlaying={(e) => fire("playing", e.currentTarget)}
            onTimeUpdate={(e) => fire("timeupdate", e.currentTarget)}
            onPlay={(e) => fire("play", e.currentTarget)}
            onPause={(e) => fire("pause", e.currentTarget)}
            onSeeked={(e) => fire("seeked", e.currentTarget)}
            onEnded={(e) => fire("ended", e.currentTarget)}
            onError={(e) => fire("error", e.currentTarget)}
          />
        ))}
      </CoreContext.Provider>
    </PlayerContext.Provider>
  );
}

let lastPositionState = 0;

/** Keeps the lock screen's progress bar in step, at most every few seconds unless `force`. */
function updatePositionState(it: Playable | null, pos: number, speed: number, force = false) {
  if (!("mediaSession" in navigator) || !it || !(it.durationSec > 0)) return;
  const now = Date.now();
  if (!force && now - lastPositionState < 5000) return;
  lastPositionState = now;
  try {
    navigator.mediaSession.setPositionState({ duration: it.durationSec, position: Math.min(pos, it.durationSec), playbackRate: speed });
  } catch {
    // older browsers
  }
}
