"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  apiPaths,
  type AdSpan,
  type AlbumDetail,
  type BookDetail,
  type EpisodeAdsDto,
  type ChapterDto,
  type EpisodeWithShow,
  type ItemType,
  type PlayType,
  type TrackDto,
  albumCover,
  PLAY_COUNTS_AFTER_SEC,
  addItem,
  EMPTY_UP_NEXT,
  moveItem as moveListItem,
  nextIndex,
  nextRepeatMode,
  previousIndex,
  removeAt as removeListItem,
  type RepeatMode,
  setShuffle,
  startMusic,
  startSingle,
  type UpNextDto,
  type UpNextEntry,
  type UpNextInput,
  type UpNextList,
  type UpNextSource,
  type UserPrefs,
  type ListeningStore,
  ListeningTracker,
  type ProgressItem,
  type QueueEntry,
  type QueueRef,
  ADS_POLL_MS,
  chapterAt,
  fitChapters,
  clampSpeed,
  DEFAULT_SKIP,
  NOW_PLAYING_KEY,
  parseSkip,
  SAVE_EVERY_MS,
  SKIP_KEY,
  type SkipSettings,
  type SleepTimer,
} from "@murmur/shared/client";
import { api } from "../api";
import { CAST_FAILED, CastMedia, MEDIA_EVENTS, type MediaEventName, stopCasting, useCast } from "../cast/cast";
import { adModeFor, adPrefsStore, adToSkip, playedThrough } from "./ad-prefs";
import { effectiveVolume, volumeStore } from "./volume";

/** Album cover colours, looked up once per album: songs carry none of their own. */
const albumColors = new Map<string, string | null>();

/** The colour to tint the player with: the item's own, or a song's album cover colour. */
export function useTint(item: Playable | null): string | null {
  const albumId = item?.color ? undefined : item?.albumId;
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

const LISTENING_KEY = "murmur.listening";
let listeningTracker: ListeningTracker | null = null;

/** Time spent listening per day, for the stats; sent along with progress. Browser only. */
function listening(): ListeningTracker {
  return (listeningTracker ??= new ListeningTracker(
    () => {
      try {
        return JSON.parse(localStorage.getItem(LISTENING_KEY) ?? "null") as ListeningStore | null;
      } catch {
        return null;
      }
    },
    (data) => {
      try {
        localStorage.setItem(LISTENING_KEY, JSON.stringify(data));
      } catch {
        // Storage blocked: totals still go to the server while this tab is open.
      }
    },
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
  await api("/api/listening", { method: "PUT", body: report, keepalive });
  tracker.sent(report);
}

export interface PlayableFile {
  url: string;
  startSec: number;
  durationSec: number;
}

/** Anything the player can play: a book (one or more files on one timeline), an episode or a song. */
export interface Playable {
  type: PlayType;
  id: string;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  coverUrlLarge: string | null;
  color: string | null;
  /** A song's album, whose cover colour it takes (see useTint). */
  albumId?: string;
  href: string;
  durationSec: number;
  files: PlayableFile[];
  chapters: ChapterDto[];
  podcastId: string | null;
  /** Where playback starts if it isn't already loaded. */
  startAt: number;
  speed: number;
}

export function bookToPlayable(b: BookDetail): Playable {
  const resume = b.progress && !b.progress.finished ? b.progress.positionSec : 0;
  return {
    type: "book",
    id: b.id,
    title: b.title,
    subtitle: b.author,
    coverUrl: b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 200) : null,
    coverUrlLarge: b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 600) : null,
    color: b.coverColor,
    href: `/book/${b.id}`,
    durationSec: b.durationSec,
    files: b.files.map((f) => ({ url: apiPaths.bookFileUrl(b.id, f.index), startSec: f.startSec, durationSec: f.durationSec })),
    chapters: b.chapters,
    podcastId: null,
    startAt: resume,
    speed: clampSpeed(b.progress?.speed ?? 1),
  };
}

export function episodeToPlayable(e: EpisodeWithShow): Playable {
  const resume = e.progress && !e.progress.finished ? e.progress.positionSec : 0;
  const dur = e.durationSec ?? 0;
  return {
    type: "episode",
    id: e.id,
    title: e.title,
    subtitle: e.podcastTitle,
    coverUrl: e.podcastCoverHash ? apiPaths.podcastCoverUrl(e.podcastId, e.podcastCoverHash, 200) : null,
    coverUrlLarge: e.podcastCoverHash ? apiPaths.podcastCoverUrl(e.podcastId, e.podcastCoverHash, 600) : null,
    color: e.podcastCoverColor,
    href: `/podcasts/${e.podcastId}`,
    durationSec: dur,
    files: [{ url: apiPaths.episodeUrl(e.id), startSec: 0, durationSec: dur }],
    chapters: [],
    podcastId: e.podcastId,
    startAt: resume,
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
    coverUrl: albumCover(t.albumId, t.coverHash),
    coverUrlLarge: albumCover(t.albumId, t.coverHash, 600),
    color: null,
    albumId: t.albumId,
    href: `/music/album/${t.albumId}`,
    durationSec: t.durationSec,
    files: [{ url: apiPaths.trackUrl(t.id), startSec: 0, durationSec: t.durationSec }],
    chapters: [],
    podcastId: null,
    startAt: 0,
    speed: 1,
  };
}

/** What was playing, saved on this device so a reload picks it up. */
export type PlayRef = { itemType: PlayType; itemId: string };

async function loadPlayable(ref: PlayRef): Promise<Playable> {
  if (ref.itemType === "book") return bookToPlayable(await api<BookDetail>(`/api/books/${ref.itemId}`));
  if (ref.itemType === "track") return trackToPlayable(await api<TrackDto>(apiPaths.track(ref.itemId)));
  return episodeToPlayable(await api<EpisodeWithShow>(`/api/episodes/${ref.itemId}`));
}

/** Where music plays from, as the album, artist and Songs pages hand it to the player. */
export interface MusicSource {
  kind: UpNextSource["kind"];
  refId: string | null;
  title: string;
  tracks: TrackDto[];
}

const trackEntry = (track: TrackDto): UpNextEntry => ({ itemType: "track", itemId: track.id, added: false, track });
const toRefs = (l: UpNextList): UpNextInput => ({
  ...l,
  items: l.items.map(({ itemType, itemId, added }) => ({ itemType, itemId, added })),
});
const entryToPlayable = (e: UpNextEntry): Playable => (e.itemType === "track" ? trackToPlayable(e.track) : episodeToPlayable(e.episode));
const sameRef = (a: QueueRef, b: QueueRef) => a.itemType === b.itemType && a.itemId === b.itemId;

/** Start the next song loading this long before the current one ends, so it follows without a gap. */
const PRELOAD_SEC = 10;


interface PlayerApi {
  item: Playable | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  speed: number;
  sleep: SleepTimer;
  skip: SkipSettings;
  expanded: boolean;
  /** The server finds ads (the ad detection add-on is set up). */
  adsEnabled: boolean;
  /** Ad times for the current episode, empty until it's scanned. */
  ads: AdSpan[];
  /** Up Next: one running list of what played, what's playing and what's next. */
  upNext: UpNextDto;
  /** False until Up Next has been fetched once, so an empty list isn't shown too early. */
  upNextLoaded: boolean;
  isCurrent: (type: PlayType, id: string) => boolean;
  /** True while the current song comes from this album, artist, playlist or song list. */
  isPlayingFrom: (kind: UpNextSource["kind"], refId: string | null) => boolean;
  /**
   * Plays `source` from its song at `index` (-1 for Play: the first song, or any song with shuffle on).
   * Shuffle follows your setting; `shuffle` true turns it on first, for the Shuffle buttons.
   */
  playMusic: (source: MusicSource, index: number, shuffle?: boolean) => void;
  /** Plays the item at `index` in Up Next. */
  playAt: (index: number) => void;
  /** Takes an item out of Up Next; taking out the one playing moves on to the next. */
  removeAt: (index: number) => void;
  moveItem: (from: number, to: number) => void;
  /** Empties what's still to come. */
  clearUpNext: () => void;
  /** Puts back a list from before, for Undo. */
  restoreUpNext: (l: UpNextDto) => void;
  /** Adds one item, or several in order (a whole album or playlist). */
  addToUpNext: (refs: QueueRef | QueueRef[], at: "next" | "last") => Promise<void>;
  /** True while `ref` is still to come in Up Next. */
  isWaiting: (ref: QueueRef) => boolean;
  /** Takes `ref` out of what's still to come. */
  removeWaiting: (ref: QueueRef) => void;
  /**
   * Previous and next in Up Next, for songs and episodes: back restarts the item unless it's just
   * begun. Past either end of the list, an episode moves to the one beside it in its show's list.
   */
  trackStep: (dir: -1 | 1) => void;
  /** Your shuffle and repeat settings for music, kept between sessions. */
  shuffle: boolean;
  repeat: RepeatMode;
  /** Turns shuffle on or off, reordering what's left of the album or list. */
  toggleShuffle: () => void;
  /** Repeat off, then all, then one. */
  cycleRepeat: () => void;
  /** Plays an item, resuming where you left off unless `startAt` is given. */
  play: (item: Playable, startAt?: number) => void;
  playRef: (ref: PlayRef, startAt?: number) => Promise<void>;
  toggle: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  skipBy: (delta: number) => void;
  chapterStep: (dir: -1 | 1) => void;
  setSpeed: (speed: number) => void;
  setSleep: (sleep: SleepTimer) => void;
  setSkip: (skip: SkipSettings) => void;
  /** Points the browser's media controls back at the audio player, once a video has let go of them. */
  claimMediaSession: () => void;
  setExpanded: (open: boolean) => void;
  /** Marks the current item finished (or not) and saves it; resolves once saved. */
  markCurrent: (finished: boolean) => Promise<void>;
  stop: () => void;
}

const PlayerContext = createContext<PlayerApi | null>(null);

/**
 * The playhead, which changes several times a second. It lives outside React state so a
 * tick re-renders only the components that ask for it, not everything under the player.
 */
const positionStore = (() => {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: number) {
      if (next === value) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
})();
const zero = () => 0;
const ignore = () => () => {};

/** What's loaded and whether it's playing, for rows that only need to know if it's theirs. */
type NowPlaying = { type: PlayType; id: string; podcastId: string | null; playing: boolean } | null;
const nowStore = (() => {
  let now: NowPlaying = null;
  const listeners = new Set<() => void>();
  return {
    get: () => now,
    set(next: NowPlaying) {
      now = next;
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
})();

/**
 * Whether what's loaded is this row's (`mine`), and playing. Unlike usePlayer, a row re-renders
 * only when its own answer changes, not on every play, pause or Up Next change, so long grids stay
 * cheap.
 */
export function useNowPlaying(mine: (now: NonNullable<NowPlaying>) => boolean): { current: boolean; playing: boolean } {
  const state = useSyncExternalStore(
    nowStore.subscribe,
    () => {
      const now = nowStore.get();
      return now && mine(now) ? (now.playing ? 2 : 1) : 0;
    },
    zero,
  );
  return { current: state > 0, playing: state === 2 };
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

/**
 * Current position in seconds. Pass `false` when this component isn't showing the current
 * item, so long lists don't re-render on every tick; it then reads 0.
 */
export function usePosition(enabled = true): number {
  return useSyncExternalStore(enabled ? positionStore.subscribe : ignore, enabled ? positionStore.get : zero, zero);
}

function readSkip(): SkipSettings {
  try {
    return parseSkip(JSON.parse(localStorage.getItem(SKIP_KEY) ?? "null"));
  } catch {
    return DEFAULT_SKIP;
  }
}

const refOf = (item: Playable): PlayRef => ({ itemType: item.type, itemId: item.id });

/** What plays: one of the <audio> elements, or the Chromecast while casting. */
type Media = HTMLAudioElement | CastMedia;

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Two players: `audio` is the one playing, the other loads the next song ahead of time.
  // Events from the spare one are ignored until it takes over. While casting, `audio` is the
  // Chromecast and there's no spare: songs follow each other on the TV with its own short gap.
  const players = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const audio = useRef<Media | null>(null);
  const castMedia = useRef<CastMedia | null>(null);
  const spare = () =>
    audio.current instanceof CastMedia ? null : players.current[0] === audio.current ? players.current[1] : players.current[0];
  /** The song id the spare player holds, ready to go. */
  const preloaded = useRef<string | null>(null);
  const listRef = useRef<UpNextDto>(EMPTY_UP_NEXT);
  /** Seconds of the current song heard, toward counting it as played. */
  const heardSec = useRef(0);
  const counted = useRef(false);
  const itemRef = useRef<Playable | null>(null);
  const fileIndex = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const positionRef = useRef(0);
  const speedRef = useRef(1);
  const lastSaved = useRef(0);
  const unsaved = useRef<ProgressItem | null>(null);

  // The elements keep their volume across sources, so it's set once and on every change.
  useEffect(() => {
    audio.current ??= players.current[0];
    const apply = () => {
      for (const el of [...players.current, castMedia.current]) if (el) el.volume = effectiveVolume(volumeStore.get());
    };
    apply();
    return volumeStore.subscribe(apply);
  }, []);
  const sleepRef = useRef<SleepTimer>({ mode: "off" });
  const adsRef = useRef<AdSpan[]>([]);
  /** Ads you chose to hear with Undo; not skipped again while this item stays loaded. */
  const adsAllowed = useRef(new Set<number>());
  const lastTick = useRef(0);
  const lastTickAt = useRef(0);
  /** The item the last listening tick was for; the first tick after a change counts nothing. */
  const lastListenKey = useRef("");
  // skipBy is memoized but needs the current ads and prefs, so it calls through this.
  const skipAdCrossedRef = useRef<(prev: number, pos: number, undoTo?: number) => void>(() => {});

  const [item, setItem] = useState<Playable | null>(null);
  const setPosition = positionStore.set;
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => nowStore.set(item && { type: item.type, id: item.id, podcastId: item.podcastId, playing }), [item, playing]);
  const [speed, setSpeedState] = useState(1);
  const [sleep, setSleepState] = useState<SleepTimer>({ mode: "off" });
  const [skip, setSkipState] = useState<SkipSettings>(DEFAULT_SKIP);
  const [expanded, setExpanded] = useState(false);
  const [adsInfo, setAdsInfo] = useState<EpisodeAdsDto | null>(null);
  const [upNext, setUpNextState] = useState<UpNextDto>(EMPTY_UP_NEXT);
  const [upNextLoaded, setUpNextLoaded] = useState(false);
  /**
   * Shows a changed list at once and saves it: "list" sends the whole list, "index" only where it's
   * at. A list that needs details this device doesn't have (a new episode) waits for the server's copy.
   */
  const setList = useCallback((l: UpNextDto, save: "list" | "index" | false) => {
    listRef.current = l;
    setUpNextState(l);
    if (save === "index") void api(apiPaths.upNext, { method: "PATCH", body: { index: l.index } }).catch(() => undefined);
    // A change you made (not just moving along the list) says so when it didn't save.
    if (save === "list") void api(apiPaths.upNext, { method: "PUT", body: toRefs(l) }).catch(() => toast.error("Couldn't save Up Next."));
  }, []);

  const [shuffle, setShuffleState] = useState(false);
  const [repeat, setRepeatState] = useState<RepeatMode>("off");
  const shuffleRef = useRef(false);
  const repeatRef = useRef<RepeatMode>("off");
  const setMusicPrefs = useCallback((prefs: { shuffle?: boolean; repeat?: RepeatMode }, persist: boolean) => {
    if (prefs.shuffle !== undefined) {
      shuffleRef.current = prefs.shuffle;
      setShuffleState(prefs.shuffle);
    }
    if (prefs.repeat !== undefined) {
      repeatRef.current = prefs.repeat;
      setRepeatState(prefs.repeat);
    }
    if (persist) void api(apiPaths.prefs, { method: "PUT", body: prefs }).catch(() => undefined);
  }, []);

  // ---------- Progress ----------

  const flush = useCallback(async () => {
    const pending = unsaved.current;
    try {
      if (pending) {
        await api("/api/progress", { method: "PUT", body: { items: [pending] }, keepalive: true });
        if (unsaved.current === pending) unsaved.current = null;
      }
      const report = listening().pending();
      if (report) {
        await api("/api/listening", { method: "PUT", body: report, keepalive: true });
        listening().sent(report);
      }
    } catch {
      // Kept in `unsaved`; the next save or coming back online retries it.
    }
  }, []);

  const save = useCallback(
    (finished = false) => {
      const it = itemRef.current;
      if (!it) return;
      // Songs keep no position; only their listening time goes up.
      if (it.type === "track") {
        lastSaved.current = Date.now();
        listening().persist();
        return flush();
      }
      const dur = it.durationSec || audio.current?.duration || 0;
      unsaved.current = {
        itemType: it.type,
        itemId: it.id,
        positionSec: finished ? dur : positionRef.current,
        durationSec: Number.isFinite(dur) ? dur : 0,
        finished,
        speed: speedRef.current,
        updatedAt: Date.now(),
      };
      lastSaved.current = Date.now();
      listening().persist();
      return flush();
    },
    [flush],
  );

  // ---------- Loading and seeking ----------

  const fileAt = (it: Playable, sec: number) => Math.max(0, it.files.findLastIndex((f) => f.startSec <= sec));

  const load = useCallback((it: Playable, at: number, autoplay: boolean) => {
    const el = audio.current;
    if (!el) return;
    const idx = fileAt(it, at);
    itemRef.current = it;
    fileIndex.current = idx;
    pendingSeek.current = at - (it.files[idx]?.startSec ?? 0);
    positionRef.current = at;
    lastTick.current = at;
    setPosition(at);
    setError(null);
    setLoading(true);
    el.src = it.files[idx]?.url ?? "";
    if (el instanceof CastMedia) {
      el.startAt = pendingSeek.current;
      el.autoplay = autoplay;
    }
    el.load();
    el.playbackRate = speedRef.current;
    if (autoplay) void el.play().catch(() => setPlaying(false));
  }, []);

  const seek = useCallback(
    (sec: number) => {
      const el = audio.current;
      const it = itemRef.current;
      if (!el || !it) return;
      const dur = it.durationSec || el.duration || 0;
      const t = Math.min(Math.max(0, sec), Math.max(0, dur - 0.5));
      const idx = fileAt(it, t);
      const paused = el.paused;
      if (idx === fileIndex.current && el.src && pendingSeek.current === null) {
        el.currentTime = t - (it.files[idx]?.startSec ?? 0);
        positionRef.current = t;
        setPosition(t);
      } else {
        load(it, t, !paused);
      }
      // Playing saves on its own every few seconds; a seek while paused would otherwise be lost
      // on reload or on another device.
      if (paused) void save();
    },
    [load, save],
  );

  const refreshUpNext = useCallback(async () => {
    try {
      setList(await api<UpNextDto>(apiPaths.upNext), false);
    } catch {
      // keep what we have
    } finally {
      setUpNextLoaded(true);
    }
  }, [setList]);

  /** Saves a list with an item this device has no details for yet, and shows the server's copy. */
  const putRefs = useCallback(
    async (l: UpNextInput) => setList(await api<UpNextDto>(apiPaths.upNext, { method: "PUT", body: l }), false),
    [setList],
  );

  const addToUpNext = useCallback(
    async (refs: QueueRef | QueueRef[], at: "next" | "last") => {
      const body = Array.isArray(refs) ? { items: refs, at } : { ...refs, at };
      setList(await api<UpNextDto>(apiPaths.upNext, { method: "POST", body }), false);
    },
    [setList],
  );

  /** Loads and plays `it`. `fromList` is for Up Next's own items, which leave the list as it is. */
  const play = useCallback(
    (it: Playable, startAt?: number, fromList = false) => {
      const el = audio.current;
      if (!el) return;
      const current = itemRef.current;
      if (current && current.type === it.type && current.id === it.id) {
        // After an error the element is stuck, so pressing play loads the item again.
        if (el.error) return load(current, startAt ?? positionRef.current, true);
        if (startAt !== undefined) seek(startAt);
        void el.play().catch(() => setPlaying(false));
        return;
      }
      if (current && !el.paused) save();
      speedRef.current = it.speed;
      setSpeedState(it.speed);
      setItem(it);
      setSleepState({ mode: "off" });
      sleepRef.current = { mode: "off" };
      heardSec.current = 0;
      counted.current = false;
      load(it, startAt ?? it.startAt, true);
      try {
        localStorage.setItem(NOW_PLAYING_KEY, JSON.stringify(refOf(it)));
      } catch {
        // private mode
      }
      if (fromList || it.type === "track") return;
      // A book, or an episode from its show, takes over: the songs leave Up Next and waiting episodes stay.
      const l = listRef.current;
      if (it.type === "book") setList(startSingle(l, null), "list");
      else void putRefs(startSingle(toRefs(l), { itemType: "episode", itemId: it.id, added: false })).catch(() => undefined);
    },
    [load, putRefs, save, seek, setList],
  );

  /** The spare player starts loading `track`, so it can take over the moment the current song ends. */
  const preload = useCallback((track: TrackDto) => {
    const el = spare();
    if (!el || preloaded.current === track.id) return;
    preloaded.current = track.id;
    el.preload = "auto";
    el.src = apiPaths.trackUrl(track.id);
    el.load();
  }, []);

  /**
   * Shows and saves `l`, and plays its item at `l.index`: from the spare player when it preloaded
   * that song, so it follows without a gap.
   */
  const go = useCallback(
    (l: UpNextDto, save: "list" | "index") => {
      const e = l.items[l.index];
      if (!e) return;
      setList(l, save);
      const it = entryToPlayable(e);
      const next = spare();
      if (e.itemType === "track" && preloaded.current === e.itemId && next) {
        // The gapless hand-over: the spare player already has the song loaded.
        const old = audio.current;
        audio.current = next;
        itemRef.current = it;
        fileIndex.current = 0;
        pendingSeek.current = null;
        positionRef.current = 0;
        lastTick.current = 0;
        setPosition(0);
        speedRef.current = 1;
        next.playbackRate = 1;
        void next.play().catch(() => setPlaying(false));
        if (old) {
          old.pause();
          old.removeAttribute("src");
          old.load();
        }
        preloaded.current = null;
        setItem(it);
        setSpeedState(1);
        heardSec.current = 0;
        counted.current = false;
        try {
          localStorage.setItem(NOW_PLAYING_KEY, JSON.stringify(refOf(it)));
        } catch {
          // private mode
        }
      } else {
        preloaded.current = null;
        play(it, e.itemType === "track" ? 0 : undefined, true);
      }
    },
    [play, setList],
  );

  const playAt = useCallback((index: number) => go({ ...listRef.current, index }, "index"), [go]);

  const playMusic = useCallback(
    (source: MusicSource, index: number, shuffleOn = false) => {
      if (!source.tracks.length) return;
      if (shuffleOn && !shuffleRef.current) setMusicPrefs({ shuffle: true }, true);
      const { kind, refId, title } = source;
      preloaded.current = null;
      go(startMusic(listRef.current, { kind, refId, title }, source.tracks.map(trackEntry), index, shuffleOn || shuffleRef.current), "list");
    },
    [go, setMusicPrefs],
  );

  const playRef = useCallback(
    async (ref: PlayRef, startAt?: number) => {
      try {
        play(await loadPlayable(ref), startAt);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load that.");
      }
    },
    [play],
  );

  /** Plays what `nextIndex` picked: the same song again, or another item. */
  const playNext = useCallback(
    (next: "again" | number | null) => {
      if (next === null) return;
      if (next !== "again") return playAt(next);
      heardSec.current = 0;
      counted.current = false;
      seek(0);
      void audio.current?.play().catch(() => setPlaying(false));
    },
    [playAt, seek],
  );

  const trackStep = useCallback(
    (dir: -1 | 1) => {
      const it = itemRef.current;
      const l = listRef.current;
      if (!it || it.type === "book") return;
      // Repeat is for songs; an episode just steps through the list.
      const repeat = it.type === "track" ? repeatRef.current : "off";
      if (dir === -1 && positionRef.current > 3) return seek(0);
      if (dir === 1 && repeat === "one") setMusicPrefs({ repeat: "all" }, true);
      const index = l.index < 0 ? null : dir === 1 ? nextIndex(l, repeat, false) : previousIndex(l, repeat);
      if (typeof index === "number") return playNext(index);
      if (it.type === "track") return dir === -1 ? seek(0) : undefined;
      // Nothing more in Up Next: an episode moves to the one beside it in its show's list.
      void api<{ id: string | null }>(apiPaths.episodeNeighbor(it.id, dir)).then(
        ({ id }) => (id ? playRef({ itemType: "episode", itemId: id }, undefined) : dir === -1 ? seek(0) : undefined),
        () => undefined,
      );
    },
    [playNext, playRef, seek, setMusicPrefs],
  );

  const toggleShuffle = useCallback(() => {
    const on = !shuffleRef.current;
    setMusicPrefs({ shuffle: on }, true);
    const l = listRef.current;
    if (l.source) setList(setShuffle(l, on), "list");
  }, [setList, setMusicPrefs]);

  const cycleRepeat = useCallback(() => setMusicPrefs({ repeat: nextRepeatMode(repeatRef.current) }, true), [setMusicPrefs]);

  const moveItem = useCallback((from: number, to: number) => setList(moveListItem(listRef.current, from, to), "list"), [setList]);

  const clearUpNext = useCallback(() => {
    const l = listRef.current;
    setList({ ...l, items: l.items.slice(0, l.index + 1) }, "list");
  }, [setList]);

  const restoreUpNext = useCallback((l: UpNextDto) => setList(l, "list"), [setList]);

  const toggle = useCallback(() => {
    const el = audio.current;
    const it = itemRef.current;
    if (!el || !it) return;
    if (el.error) load(it, positionRef.current, true);
    else if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }, [load]);

  const pause = useCallback(() => audio.current?.pause(), []);

  // Skipping forward into an ad block still auto-skips it; scrubbing and skipping back never do.
  const skipBy = useCallback(
    (delta: number) => {
      const from = positionRef.current;
      seek(from + delta);
      if (delta > 0) skipAdCrossedRef.current(from, from + delta, from + delta);
    },
    [seek],
  );

  const chapterStep = useCallback(
    (dir: -1 | 1) => {
      const it = itemRef.current;
      if (!it) return;
      const chapters = it.chapters;
      // Without chapters, an episode's previous and next move through Up Next and then its show; a book skips 30 s.
      if (chapters.length <= 1) return it.type === "book" ? skipBy(dir * 30) : trackStep(dir);
      const i = chapterAt(chapters, positionRef.current);
      if (dir === 1) {
        const next = chapters[i + 1];
        if (next) seek(next.startSec);
        return;
      }
      // Like a CD player: back goes to the start of this chapter unless you're already near it.
      const cur = chapters[i];
      if (cur && positionRef.current - cur.startSec > 3) seek(cur.startSec);
      else seek(chapters[Math.max(0, i - 1)]?.startSec ?? 0);
    },
    [seek, skipBy, trackStep],
  );

  const setSpeed = useCallback(
    (s: number) => {
      speedRef.current = s;
      setSpeedState(s);
      if (audio.current) audio.current.playbackRate = s;
      const it = itemRef.current;
      if (!it) return;
      itemRef.current = { ...it, speed: s };
      if (it.type === "episode" && it.podcastId) {
        void api(`/api/podcasts/${it.podcastId}`, { method: "PATCH", body: { speed: s } }).catch(() => undefined);
      } else {
        save();
      }
    },
    [save],
  );

  const setSleep = useCallback((s: SleepTimer) => {
    sleepRef.current = s;
    setSleepState(s);
  }, []);

  const setSkip = useCallback((s: SkipSettings) => {
    setSkipState(s);
    try {
      localStorage.setItem(SKIP_KEY, JSON.stringify(s));
    } catch {
      // private mode
    }
  }, []);

  /** Empties the player without saving anything. */
  const unload = useCallback(() => {
    const el = audio.current;
    // Cleared first so the pause event below doesn't save over what the caller saved.
    itemRef.current = null;
    setItem(null);
    setExpanded(false);
    preloaded.current = null;
    for (const p of [el, spare()]) {
      if (!p) continue;
      p.pause();
      p.removeAttribute("src");
      p.load();
    }
    try {
      localStorage.removeItem(NOW_PLAYING_KEY);
    } catch {
      // private mode
    }
  }, []);

  const stop = useCallback(() => {
    if (audio.current && !audio.current.paused) save();
    unload();
  }, [save, unload]);

  const removeAt = useCallback(
    (index: number) => {
      const was = listRef.current.index;
      const { list, play: next } = removeListItem(listRef.current, index);
      if (next !== null) return go(list, "list");
      setList(list, "list");
      // The item playing went and nothing comes after it.
      if (index === was) stop();
    },
    [go, setList, stop],
  );

  const isWaiting = useCallback(
    (ref: QueueRef) => upNext.items.some((e, i) => i > upNext.index && sameRef(e, ref)),
    [upNext],
  );

  const removeWaiting = useCallback(
    (ref: QueueRef) => {
      const l = listRef.current;
      const at = l.items.findIndex((e, i) => i > l.index && sameRef(e, ref));
      if (at >= 0) removeAt(at);
    },
    [removeAt],
  );

  const markCurrent = useCallback(
    async (finished: boolean) => {
      let saved: Promise<void> | undefined;
      if (finished) {
        // A finished item leaves the player, like reaching its end.
        saved = save(true);
        unload();
      } else {
        positionRef.current = 0;
        seek(0);
        saved = save(false);
      }
      // Pages showing played state (book, podcast, library) catch up once the save lands.
      await saved;
      router.refresh();
    },
    [save, seek, unload, router],
  );

  // ---------- Startup: settings, queue, and whatever was playing last ----------

  useEffect(() => {
    setSkipState(readSkip());
    // Up Next comes back from the server with its place, so next and previous work after a reload.
    void refreshUpNext();
    api<UserPrefs>(apiPaths.prefs)
      .then((p) => setMusicPrefs({ shuffle: p.shuffle, repeat: p.repeat }, false))
      .catch(() => undefined);
    let saved: PlayRef | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(NOW_PLAYING_KEY) ?? "null") as PlayRef | null;
    } catch {
      saved = null;
    }
    if (!saved) return;
    loadPlayable(saved)
      .then((it) => {
        if (itemRef.current) return; // something else started meanwhile
        speedRef.current = it.speed;
        setSpeedState(it.speed);
        setItem(it);
        load(it, it.startAt, false);
      })
      .catch(() => {
        try {
          localStorage.removeItem(NOW_PLAYING_KEY);
        } catch {
          // private mode
        }
      });
  }, [load, refreshUpNext, setMusicPrefs]);

  // Save when the page is hidden or closed, and retry unsaved progress once back online.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && audio.current && !audio.current.paused) save();
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
  }, [flush, save]);

  // Sleep timer by minutes.
  useEffect(() => {
    if (sleep.mode !== "timer") return;
    const t = setInterval(() => {
      if (Date.now() >= sleep.endsAt) {
        audio.current?.pause();
        setSleep({ mode: "off" });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [sleep, setSleep]);

  // ---------- Ads ----------

  // Ad times for the current episode. Re-asked while its scan is still running; any failure
  // just means no marks, never a playback problem.
  const itemKey = item ? `${item.type}:${item.id}` : null;
  useEffect(() => {
    adsRef.current = [];
    adsAllowed.current = new Set();
    setAdsInfo(null);
    const it = itemRef.current;
    if (!it || it.type !== "episode") return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fetchAds = async () => {
      try {
        const info = await api<EpisodeAdsDto>(apiPaths.episodeAds(it.id));
        if (!live) return;
        adsRef.current = info.ads;
        setAdsInfo(info);
        if (!info.enabled || info.status === "done" || info.status === "failed") return;
      } catch {
        if (!live) return;
      }
      timer = setTimeout(fetchAds, ADS_POLL_MS);
    };
    void fetchAds();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [itemKey]);

  // An episode's chapters, which may take a moment the first time (the server looks them up).
  // None, or a failure, just means a plain scrubber.
  useEffect(() => {
    const it = itemRef.current;
    if (!it || it.type !== "episode") return;
    let live = true;
    api<ChapterDto[]>(apiPaths.episodeChapters(it.id))
      .then((chapters) => {
        const cur = itemRef.current;
        if (!live || !chapters.length || !cur || cur.type !== "episode" || cur.id !== it.id) return;
        const fixed = { ...cur, chapters: fitChapters(chapters, cur.durationSec) };
        itemRef.current = fixed;
        setItem(fixed);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [itemKey]);

  /**
   * Auto-skip: jumps past an ad when playback runs into its start, never when you seek into one.
   * `elapsedSec` is wall time since the last tick: a background tab can space ticks out, so
   * normal play may move further than 3 s between them, while a seek moves far in no time.
   */
  const maybeSkipAd = (prev: number, pos: number, elapsedSec: number) => {
    if (playedThrough(prev, pos, elapsedSec, speedRef.current)) skipAdCrossed(prev, pos);
  };

  /**
   * In Auto mode, skips the break when going from `prev` to `pos` crossed an ad's start and
   * landed inside it. Undo returns to `undoTo` (the ad's start by default) and lets the break play.
   */
  const skipAdCrossed = (prev: number, pos: number, undoTo?: number) => {
    const spans = adsRef.current;
    const it = itemRef.current;
    if (!spans.length || !it || adModeFor(adPrefsStore.get(), it.podcastId) !== "auto") return;
    const brk = adToSkip(spans, prev, pos, adsAllowed.current, undoTo);
    if (!brk) return;
    seek(brk.endSec);
    toast(brk.indexes.length > 1 ? `Skipped ${brk.indexes.length} ads` : "Skipped ad", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          for (const idx of brk.indexes) adsAllowed.current.add(idx);
          seek(brk.undoTo);
        },
      },
    });
  };
  skipAdCrossedRef.current = skipAdCrossed;

  // ---------- Music ----------

  /** While a song plays: count it once heard long enough, and preload the next one near its end. */
  const musicTick = (it: Playable, pos: number, heard: number) => {
    if (heard > 0 && heard < 5) heardSec.current += heard;
    const dur = it.durationSec || audio.current?.duration || 0;
    const needed = dur > 0 ? Math.min(PLAY_COUNTS_AFTER_SEC, dur / 2) : PLAY_COUNTS_AFTER_SEC;
    if (!counted.current && heardSec.current >= needed) {
      counted.current = true;
      void api(apiPaths.trackPlays, { method: "POST", body: { trackId: it.id } }).catch(() => undefined);
    }
    if (!(dur > 0 && dur - pos < PRELOAD_SEC)) return;
    const next = nextIndex(listRef.current, repeatRef.current, true);
    const e = typeof next === "number" ? listRef.current.items[next] : undefined;
    if (e?.itemType === "track") preload(e.track);
  };

  // ---------- Lock screen, notification and headset controls ----------

  // Previous and next mean the song for music, the chapter otherwise.
  const step = (dir: -1 | 1) => (itemRef.current?.type === "track" ? trackStep(dir) : chapterStep(dir));
  const handlers = useRef({ toggle, skipBy, chapterStep: step, seek, skip });
  handlers.current = { toggle, skipBy, chapterStep: step, seek, skip };

  /**
   * Points the browser's media controls at the audio player. The video player takes them over
   * while it's open and hands them back through this when it closes.
   */
  const claimMediaSession = useCallback(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // unsupported action
      }
    };
    set("play", () => handlers.current.toggle());
    set("pause", () => handlers.current.toggle());
    set("seekbackward", (d) => handlers.current.skipBy(-(d.seekOffset ?? handlers.current.skip.back)));
    set("seekforward", (d) => handlers.current.skipBy(d.seekOffset ?? handlers.current.skip.forward));
    set("previoustrack", () => handlers.current.chapterStep(-1));
    set("nexttrack", () => handlers.current.chapterStep(1));
    set("seekto", (d) => d.seekTime !== undefined && handlers.current.seek(d.seekTime));
    const it = itemRef.current;
    ms.metadata = it
      ? new MediaMetadata({
          title: it.title,
          artist: it.subtitle ?? "",
          album: it.type === "book" ? it.title : (it.subtitle ?? ""),
          artwork: it.coverUrlLarge ? [{ src: it.coverUrlLarge, sizes: "600x600", type: "image/webp" }] : [],
        })
      : null;
  }, []);

  useEffect(() => claimMediaSession(), [claimMediaSession, item]);

  const lastPositionState = useRef(0);
  const updatePositionState = (pos: number, force = false) => {
    if (!("mediaSession" in navigator) || !itemRef.current) return;
    if (!force && Date.now() - lastPositionState.current < 5000) return;
    lastPositionState.current = Date.now();
    const dur = itemRef.current.durationSec || audio.current?.duration || 0;
    if (!Number.isFinite(dur) || dur <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        position: Math.min(pos, dur),
        playbackRate: speedRef.current,
      });
    } catch {
      // older browsers
    }
  };

  const isCurrent = useCallback((type: PlayType, id: string) => item?.type === type && item.id === id, [item]);
  const isPlayingFrom = useCallback(
    (kind: UpNextSource["kind"], refId: string | null) =>
      item?.type === "track" && upNext.source?.kind === kind && upNext.source.refId === refId,
    [item, upNext],
  );

  const value = useMemo<PlayerApi>(
    () => ({
      item,
      playing,
      loading,
      error,
      speed,
      sleep,
      skip,
      expanded,
      adsEnabled: adsInfo?.enabled ?? false,
      ads: adsInfo?.ads ?? [],
      upNext,
      upNextLoaded,
      isPlayingFrom,
      playMusic,
      playAt,
      removeAt,
      moveItem,
      clearUpNext,
      restoreUpNext,
      addToUpNext,
      isWaiting,
      removeWaiting,
      trackStep,
      shuffle,
      repeat,
      toggleShuffle,
      cycleRepeat,
      isCurrent,
      play,
      playRef,
      toggle,
      pause,
      seek,
      skipBy,
      chapterStep,
      setSpeed,
      setSleep,
      setSkip,
      claimMediaSession,
      setExpanded,
      markCurrent,
      stop,
    }),
    [
      item,
      playing,
      loading,
      error,
      speed,
      sleep,
      skip,
      expanded,
      adsInfo,
      upNext,
      upNextLoaded,
      isPlayingFrom,
      playMusic,
      playAt,
      removeAt,
      moveItem,
      clearUpNext,
      restoreUpNext,
      addToUpNext,
      isWaiting,
      removeWaiting,
      trackStep,
      shuffle,
      repeat,
      toggleShuffle,
      cycleRepeat,
      isCurrent,
      play,
      playRef,
      toggle,
      pause,
      seek,
      skipBy,
      chapterStep,
      setSpeed,
      setSleep,
      setSkip,
      claimMediaSession,
      markCurrent,
      stop,
    ],
  );

  // The media events, the same whether an <audio> element or the Chromecast sends them. Events
  // from anything but `audio.current` (the spare player preloading) are ignored.
  const onMedia: Record<MediaEventName, (el: Media) => void> = {
    loadedmetadata: (el) => {
      if (pendingSeek.current !== null) {
        el.currentTime = pendingSeek.current;
        pendingSeek.current = null;
      }
      el.playbackRate = speedRef.current;
      // Feeds often omit or misstate an episode's length; trust the file.
      const it = itemRef.current;
      if (it && it.type === "episode" && Number.isFinite(el.duration) && Math.abs(it.durationSec - el.duration) > 1) {
        const fixed = {
          ...it,
          durationSec: el.duration,
          files: [{ ...it.files[0]!, durationSec: el.duration }],
          chapters: fitChapters(it.chapters, el.duration),
        };
        itemRef.current = fixed;
        setItem(fixed);
      }
      setLoading(false);
    },
    waiting: () => setLoading(true),
    playing: () => setLoading(false),
    timeupdate: (el) => {
      const it = itemRef.current;
      if (!it || pendingSeek.current !== null) return;
      const pos = (it.files[fileIndex.current]?.startSec ?? 0) + el.currentTime;
      const prev = lastTick.current;
      const elapsedSec = (performance.now() - lastTickAt.current) / 1000;
      lastTick.current = pos;
      lastTickAt.current = performance.now();
      if (!el.paused) {
        maybeSkipAd(prev, pos, elapsedSec);
        const key = `${it.type}:${it.id}`;
        if (lastListenKey.current === key) {
          listening().add(it.type, it.id, elapsedSec, pos - prev, speedRef.current);
          if (it.type === "track") musicTick(it, pos, Math.min(elapsedSec, pos - prev));
        }
        lastListenKey.current = key;
      }
      positionRef.current = pos;
      setPosition(pos);
      updatePositionState(pos);
      if (!el.paused && Date.now() - lastSaved.current > SAVE_EVERY_MS) save();
      const s = sleepRef.current;
      if (s.mode === "chapter" && pos >= s.endSec - 0.3) {
        el.pause();
        setSleep({ mode: "off" });
      }
    },
    play: () => setPlaying(true),
    pause: () => {
      setPlaying(false);
      const it = itemRef.current;
      if (!it) return;
      // A pause right at the end is the finish, which onEnded saves.
      const dur = it.durationSec || 0;
      if (dur && positionRef.current >= dur - 1) return;
      save();
    },
    seeked: () => updatePositionState(positionRef.current, true),
    ended: () => {
      const it = itemRef.current;
      if (!it) return;
      const next = fileIndex.current + 1;
      if (next < it.files.length) {
        load(it, it.files[next]!.startSec, true);
        return;
      }
      if (it.type === "track") {
        void save();
        return playNext(nextIndex(listRef.current, repeatRef.current, true));
      }
      void save(true)?.then(() => router.refresh());
      // A finished book just stops: Up Next is for episodes and songs, never what follows a book.
      // Repeat is for songs, so an episode just moves on.
      if (it.type === "episode") playNext(nextIndex(listRef.current, "off", true));
    },
    error: (el) => {
      if (!itemRef.current || !el.getAttribute("src")) return;
      setLoading(false);
      setPlaying(false);
      if (el instanceof CastMedia) {
        // Ending the cast brings the item back here, where it can still play.
        toast.error(CAST_FAILED);
        stopCasting();
        return;
      }
      setError("Couldn't play this. Check your connection and try again.");
    },
  };
  const onMediaRef = useRef(onMedia);
  onMediaRef.current = onMedia;
  const fire = (name: MediaEventName, el: Media) => {
    if (el === audio.current) onMediaRef.current[name](el);
  };

  // Casting: a connected Chromecast takes over from the <audio> element where it is, playing if
  // it was playing; when casting ends, the item comes back here paused, where the TV left it.
  const castDevice = useCast().device;
  useEffect(() => {
    const it = itemRef.current;
    if (castDevice && !(audio.current instanceof CastMedia)) {
      if (!castMedia.current) {
        const cm = new CastMedia(() => {
          const now = itemRef.current;
          return now && { title: now.title, subtitle: now.subtitle, image: now.coverUrlLarge };
        });
        for (const name of MEDIA_EVENTS) cm.addEventListener(name, () => fire(name, cm));
        castMedia.current = cm;
      }
      const local = audio.current;
      const wasPlaying = !!local && !local.paused;
      preloaded.current = null;
      for (const p of players.current) p?.pause();
      audio.current = castMedia.current;
      castMedia.current.volume = effectiveVolume(volumeStore.get());
      if (it) load(it, positionRef.current, wasPlaying);
    } else if (!castDevice && audio.current instanceof CastMedia) {
      const at = positionRef.current;
      audio.current.release();
      audio.current = players.current[0];
      setPlaying(false);
      if (it) load(it, at, false);
    }
    // Only when casting starts or ends; `fire` reads the latest handlers through a ref.
  }, [castDevice, load]);

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {[0, 1].map((n) => (
        <audio
          key={n}
          ref={(el) => {
            players.current[n] = el;
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
    </PlayerContext.Provider>
  );
}
