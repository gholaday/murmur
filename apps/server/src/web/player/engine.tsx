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
  type PlayContextDto,
  type PlayType,
  type TrackDto,
  albumCover,
  PLAY_COUNTS_AFTER_SEC,
  shuffled as shuffleList,
  type ListeningStore,
  ListeningTracker,
  type ProgressItem,
  type QueueEntry,
  type QueueRef,
  ADS_POLL_MS,
  chapterAt,
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
type PlayRef = { itemType: PlayType; itemId: string };

async function loadPlayable(ref: PlayRef): Promise<Playable> {
  if (ref.itemType === "book") return bookToPlayable(await api<BookDetail>(`/api/books/${ref.itemId}`));
  if (ref.itemType === "track") return trackToPlayable(await api<TrackDto>(apiPaths.track(ref.itemId)));
  return episodeToPlayable(await api<EpisodeWithShow>(`/api/episodes/${ref.itemId}`));
}

/** Where music plays from, as the album, artist and Songs pages hand it to the player. */
export interface MusicSource {
  kind: PlayContextDto["kind"];
  refId: string | null;
  title: string;
  tracks: TrackDto[];
}

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
  queue: QueueEntry[];
  /** False until the queue has been fetched once, so an empty list isn't shown too early. */
  queueLoaded: boolean;
  /** The album, artist or song list music is playing from; Up Next shows the rest of it. */
  musicContext: PlayContextDto | null;
  isCurrent: (type: PlayType, id: string) => boolean;
  /** Plays `source` from its song at `index`, or shuffled (starting with that song when one is given). */
  playMusic: (source: MusicSource, index: number, shuffle?: boolean) => void;
  /** Jumps to another song in the current context. */
  playContextAt: (index: number) => void;
  /** Previous and next song: back restarts the song unless it's just begun. */
  trackStep: (dir: -1 | 1) => void;
  /** A song to play right after the current one: into the playing album or list, else the front of Up Next. */
  playNext: (track: TrackDto) => Promise<void>;
  /** Plays an item, resuming where you left off unless `startAt` is given. */
  play: (item: Playable, startAt?: number) => void;
  playRef: (ref: QueueRef, startAt?: number) => Promise<void>;
  toggle: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  skipBy: (delta: number) => void;
  chapterStep: (dir: -1 | 1) => void;
  setSpeed: (speed: number) => void;
  setSleep: (sleep: SleepTimer) => void;
  setSkip: (skip: SkipSettings) => void;
  setExpanded: (open: boolean) => void;
  /** Marks the current item finished (or not) and saves it. */
  markCurrent: (finished: boolean) => void;
  stop: () => void;
  queueAdd: (ref: QueueRef, at: "next" | "last") => Promise<void>;
  queueReplace: (refs: QueueRef[]) => Promise<void>;
  refreshQueue: () => Promise<void>;
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

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Two players: `audio` is the one playing, the other loads the next song ahead of time.
  // Events from the spare one are ignored until it takes over.
  const players = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const spare = () => (players.current[0] === audio.current ? players.current[1] : players.current[0]);
  /** The song id the spare player holds, ready to go. */
  const preloaded = useRef<string | null>(null);
  const contextRef = useRef<PlayContextDto | null>(null);
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
      for (const el of players.current) if (el) el.volume = effectiveVolume(volumeStore.get());
    };
    apply();
    return volumeStore.subscribe(apply);
  }, []);
  const queueRef = useRef<QueueEntry[]>([]);
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
  const [speed, setSpeedState] = useState(1);
  const [sleep, setSleepState] = useState<SleepTimer>({ mode: "off" });
  const [skip, setSkipState] = useState<SkipSettings>(DEFAULT_SKIP);
  const [expanded, setExpanded] = useState(false);
  const [queue, setQueueState] = useState<QueueEntry[]>([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [adsInfo, setAdsInfo] = useState<EpisodeAdsDto | null>(null);
  const [musicContext, setMusicContextState] = useState<PlayContextDto | null>(null);
  const setMusicContext = useCallback((c: PlayContextDto | null) => {
    contextRef.current = c;
    setMusicContextState(c);
  }, []);

  const setQueue = useCallback((q: QueueEntry[]) => {
    queueRef.current = q;
    setQueueState(q);
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

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await api<QueueEntry[]>("/api/queue"));
    } catch {
      // keep what we have
    } finally {
      setQueueLoaded(true);
    }
  }, [setQueue]);

  const queueReplace = useCallback(
    async (refs: QueueRef[]) => {
      setQueue(await api<QueueEntry[]>("/api/queue", { method: "PUT", body: { items: refs } }));
    },
    [setQueue],
  );

  const queueAdd = useCallback(
    async (ref: QueueRef, at: "next" | "last") => {
      setQueue(await api<QueueEntry[]>("/api/queue", { method: "POST", body: { ...ref, at } }));
    },
    [setQueue],
  );

  const removeFromQueue = useCallback(
    (ref: QueueRef) => {
      const q = queueRef.current;
      if (!q.some((e) => e.itemType === ref.itemType && e.itemId === ref.itemId)) return;
      void queueReplace(
        q.filter((e) => !(e.itemType === ref.itemType && e.itemId === ref.itemId)).map((e) => ({
          itemType: e.itemType,
          itemId: e.itemId,
        })),
      ).catch(() => undefined);
    },
    [queueReplace],
  );

  const play = useCallback(
    (it: Playable, startAt?: number) => {
      const el = audio.current;
      if (!el) return;
      const current = itemRef.current;
      if (current && current.type === it.type && current.id === it.id) {
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
      if (it.type === "track") return;
      removeFromQueue({ itemType: it.type, itemId: it.id });
      // A book or episode takes over from music, so its "rest of the album" leaves Up Next.
      if (contextRef.current) {
        setMusicContext(null);
        void api(apiPaths.playContext, { method: "DELETE" }).catch(() => undefined);
      }
    },
    [load, removeFromQueue, save, seek, setMusicContext],
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

  /** Plays song `index` of the current context, from a player that preloaded it when there is one. */
  const playContextAt = useCallback(
    (index: number) => {
      const c = contextRef.current;
      const track = c?.tracks[index];
      if (!c || !track) return;
      const it = trackToPlayable(track);
      const next = spare();
      if (preloaded.current === track.id && next) {
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
        play(it, 0);
      }
      setMusicContext({ ...c, index });
      void api(apiPaths.playContext, { method: "PATCH", body: { index } }).catch(() => undefined);
    },
    [play, setMusicContext],
  );

  const playMusic = useCallback(
    (source: MusicSource, index: number, shuffle = false) => {
      if (!source.tracks.length) return;
      const first = source.tracks[index];
      const tracks = shuffle ? shuffleList(source.tracks, index >= 0 ? first : undefined) : source.tracks;
      const at = shuffle ? 0 : Math.max(0, index);
      const c: PlayContextDto = { kind: source.kind, refId: source.refId, title: source.title, tracks, index: at, shuffled: shuffle };
      setMusicContext(c);
      preloaded.current = null;
      playContextAt(at);
      void api(apiPaths.playContext, {
        method: "PUT",
        body: { kind: c.kind, refId: c.refId, title: c.title, trackIds: tracks.map((t) => t.id), index: at, shuffled: shuffle },
      }).catch(() => undefined);
    },
    [playContextAt, setMusicContext],
  );

  const trackStep = useCallback(
    (dir: -1 | 1) => {
      const c = contextRef.current;
      const it = itemRef.current;
      if (!c || !it || it.type !== "track") return;
      if (dir === -1 && positionRef.current > 3) return seek(0);
      const index = c.index + dir;
      if (index >= 0 && index < c.tracks.length) playContextAt(index);
      else if (dir === -1) seek(0);
    },
    [playContextAt, seek],
  );

  const playRef = useCallback(
    async (ref: QueueRef, startAt?: number) => {
      try {
        play(await loadPlayable(ref), startAt);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load that.");
        return;
      }
      if (ref.itemType !== "track") return;
      // A song from Up Next plays on its own: it leaves the queue, and any album it interrupts ends.
      removeFromQueue(ref);
      if (contextRef.current) {
        setMusicContext(null);
        void api(apiPaths.playContext, { method: "DELETE" }).catch(() => undefined);
      }
    },
    [play, removeFromQueue, setMusicContext],
  );

  /**
   * "Play next" for a song: while an album or list plays, it goes in right after the current
   * song, so it shows in the rest of the album. Otherwise it goes to the front of Up Next.
   */
  const playNext = useCallback(
    async (track: TrackDto) => {
      const c = contextRef.current;
      if (!c || itemRef.current?.type !== "track") return queueAdd({ itemType: "track", itemId: track.id }, "next");
      const current = c.tracks[c.index];
      if (current?.id === track.id) return;
      // Taken out wherever it already was, then put back right after the current song.
      const before = c.tracks.slice(0, c.index).filter((t) => t.id !== track.id);
      const after = c.tracks.slice(c.index + 1).filter((t) => t.id !== track.id);
      const index = before.length;
      const tracks = [...before, current!, track, ...after];
      const next: PlayContextDto = { ...c, tracks, index };
      setMusicContext(next);
      preloaded.current = null;
      await api(apiPaths.playContext, {
        method: "PUT",
        body: { kind: next.kind, refId: next.refId, title: next.title, trackIds: tracks.map((t) => t.id), index, shuffled: next.shuffled },
      });
    },
    [queueAdd, setMusicContext],
  );

  /** Plays the next thing in Up Next, if anything. */
  const advance = useCallback(async () => {
    const next = queueRef.current[0];
    if (next) await playRef({ itemType: next.itemType, itemId: next.itemId }, undefined);
  }, [playRef]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el || !itemRef.current) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }, []);

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
      if (chapters.length === 0) return skipBy(dir * 30);
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
    [seek, skipBy],
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

  const markCurrent = useCallback(
    (finished: boolean) => {
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
      void saved?.then(() => router.refresh());
    },
    [save, seek, unload, router],
  );

  // ---------- Startup: settings, queue, and whatever was playing last ----------

  useEffect(() => {
    setSkipState(readSkip());
    void refreshQueue();
    let saved: PlayRef | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(NOW_PLAYING_KEY) ?? "null") as PlayRef | null;
    } catch {
      saved = null;
    }
    if (!saved) return;
    const songId = saved.itemType === "track" ? saved.itemId : null;
    // A song comes back with the album or list it was playing from, so next and Up Next work.
    if (songId) {
      api<PlayContextDto | null>(apiPaths.playContext)
        .then((c) => {
          if (c && !contextRef.current) {
            const at = c.tracks.findIndex((t) => t.id === songId);
            if (at >= 0) setMusicContext({ ...c, index: at });
          }
        })
        .catch(() => undefined);
    }
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
  }, [load, refreshQueue, setMusicContext]);

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
    const c = contextRef.current;
    const next = c?.tracks[c.index + 1];
    if (next && dur > 0 && dur - pos < PRELOAD_SEC) preload(next);
  };

  // ---------- Lock screen, notification and headset controls ----------

  // Previous and next mean the song for music, the chapter otherwise.
  const step = (dir: -1 | 1) => (itemRef.current?.type === "track" ? trackStep(dir) : chapterStep(dir));
  const handlers = useRef({ toggle, skipBy, chapterStep: step, seek, skip });
  handlers.current = { toggle, skipBy, chapterStep: step, seek, skip };

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = item
      ? new MediaMetadata({
          title: item.title,
          artist: item.subtitle ?? "",
          album: item.type === "book" ? item.title : (item.subtitle ?? ""),
          artwork: item.coverUrlLarge ? [{ src: item.coverUrlLarge, sizes: "600x600", type: "image/webp" }] : [],
        })
      : null;
  }, [item]);

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
      queue,
      queueLoaded,
      musicContext,
      playMusic,
      playContextAt,
      trackStep,
      playNext,
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
      setExpanded,
      markCurrent,
      stop,
      queueAdd,
      queueReplace,
      refreshQueue,
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
      queue,
      queueLoaded,
      musicContext,
      playMusic,
      playContextAt,
      trackStep,
      playNext,
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
      markCurrent,
      stop,
      queueAdd,
      queueReplace,
      refreshQueue,
    ],
  );

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
          onLoadedMetadata={(e) => {
            if (e.currentTarget !== audio.current) return; // the spare player preloading
            const el = e.currentTarget;
            if (pendingSeek.current !== null) {
              el.currentTime = pendingSeek.current;
              pendingSeek.current = null;
            }
            el.playbackRate = speedRef.current;
            // Feeds often omit or misstate an episode's length; trust the file.
            const it = itemRef.current;
            if (it && it.type === "episode" && Number.isFinite(el.duration) && Math.abs(it.durationSec - el.duration) > 1) {
              const fixed = { ...it, durationSec: el.duration, files: [{ ...it.files[0]!, durationSec: el.duration }] };
              itemRef.current = fixed;
              setItem(fixed);
            }
            setLoading(false);
          }}
          onWaiting={(e) => e.currentTarget === audio.current && setLoading(true)}
          onPlaying={(e) => e.currentTarget === audio.current && setLoading(false)}
          onTimeUpdate={(e) => {
            if (e.currentTarget !== audio.current) return;
            const it = itemRef.current;
            if (!it || pendingSeek.current !== null) return;
            const pos = (it.files[fileIndex.current]?.startSec ?? 0) + e.currentTarget.currentTime;
            const prev = lastTick.current;
            const elapsedSec = (performance.now() - lastTickAt.current) / 1000;
            lastTick.current = pos;
            lastTickAt.current = performance.now();
            if (!e.currentTarget.paused) {
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
            if (!e.currentTarget.paused && Date.now() - lastSaved.current > SAVE_EVERY_MS) save();
            const s = sleepRef.current;
            if (s.mode === "chapter" && pos >= s.endSec - 0.3) {
              e.currentTarget.pause();
              setSleep({ mode: "off" });
            }
          }}
          onPlay={(e) => e.currentTarget === audio.current && setPlaying(true)}
          onPause={(e) => {
            if (e.currentTarget !== audio.current) return;
            setPlaying(false);
            const it = itemRef.current;
            if (!it) return;
            // A pause right at the end is the finish, which onEnded saves.
            const dur = it.durationSec || 0;
            if (dur && positionRef.current >= dur - 1) return;
            save();
          }}
          onSeeked={(e) => e.currentTarget === audio.current && updatePositionState(positionRef.current, true)}
          onEnded={(e) => {
            if (e.currentTarget !== audio.current) return;
            const it = itemRef.current;
            if (!it) return;
            const next = fileIndex.current + 1;
            if (next < it.files.length) {
              load(it, it.files[next]!.startSec, true);
              return;
            }
            if (it.type === "track") {
              // On to the next song in the album or list, then to Up Next once it's done.
              void save();
              const c = contextRef.current;
              if (c && c.index + 1 < c.tracks.length) return playContextAt(c.index + 1);
              void advance();
              return;
            }
            void save(true)?.then(() => router.refresh());
            void advance();
          }}
          onError={(e) => {
            if (e.currentTarget !== audio.current) return;
            if (!itemRef.current || !e.currentTarget.getAttribute("src")) return;
            setLoading(false);
            setPlaying(false);
            setError("Couldn't play this. Check your connection and try again.");
          }}
        />
      ))}
    </PlayerContext.Provider>
  );
}
