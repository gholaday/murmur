"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  apiPaths,
  type BookDetail,
  type ChapterDto,
  type EpisodeWithShow,
  type ItemType,
  type ProgressItem,
  type QueueEntry,
  type QueueRef,
} from "@murmur/shared/client";
import { api } from "../api";

const SAVE_EVERY_MS = 10_000;
const NOW_PLAYING_KEY = "murmur.nowPlaying";
const SKIP_KEY = "murmur.skip";

export interface PlayableFile {
  url: string;
  startSec: number;
  durationSec: number;
}

/** Anything the player can play: a book (one or more files on one timeline) or an episode. */
export interface Playable {
  type: ItemType;
  id: string;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  coverUrlLarge: string | null;
  color: string | null;
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
    speed: b.progress?.speed ?? 1,
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
    speed: e.speed,
  };
}

async function loadPlayable(ref: QueueRef): Promise<Playable> {
  if (ref.itemType === "book") return bookToPlayable(await api<BookDetail>(`/api/books/${ref.itemId}`));
  return episodeToPlayable(await api<EpisodeWithShow>(`/api/episodes/${ref.itemId}`));
}

export type SleepTimer = { mode: "off" } | { mode: "timer"; endsAt: number } | { mode: "chapter"; endSec: number };

export interface SkipSettings {
  back: number;
  forward: number;
}

interface PlayerApi {
  item: Playable | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  speed: number;
  sleep: SleepTimer;
  skip: SkipSettings;
  expanded: boolean;
  queue: QueueEntry[];
  /** False until the queue has been fetched once, so an empty list isn't shown too early. */
  queueLoaded: boolean;
  isCurrent: (type: ItemType, id: string) => boolean;
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

export function chapterAt(chapters: ChapterDto[], position: number): number {
  return chapters.findLastIndex((c) => c.startSec <= position + 0.25);
}

function readSkip(): SkipSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SKIP_KEY) ?? "null") as SkipSettings | null;
    if (raw && raw.back > 0 && raw.forward > 0) return raw;
  } catch {
    // ignore
  }
  return { back: 10, forward: 30 };
}

const refOf = (item: Playable): QueueRef => ({ itemType: item.type, itemId: item.id });

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const audio = useRef<HTMLAudioElement>(null);
  const itemRef = useRef<Playable | null>(null);
  const fileIndex = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const positionRef = useRef(0);
  const speedRef = useRef(1);
  const lastSaved = useRef(0);
  const unsaved = useRef<ProgressItem | null>(null);
  const queueRef = useRef<QueueEntry[]>([]);
  const sleepRef = useRef<SleepTimer>({ mode: "off" });

  const [item, setItem] = useState<Playable | null>(null);
  const setPosition = positionStore.set;
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeedState] = useState(1);
  const [sleep, setSleepState] = useState<SleepTimer>({ mode: "off" });
  const [skip, setSkipState] = useState<SkipSettings>({ back: 10, forward: 30 });
  const [expanded, setExpanded] = useState(false);
  const [queue, setQueueState] = useState<QueueEntry[]>([]);
  const [queueLoaded, setQueueLoaded] = useState(false);

  const setQueue = useCallback((q: QueueEntry[]) => {
    queueRef.current = q;
    setQueueState(q);
  }, []);

  // ---------- Progress ----------

  const flush = useCallback(async () => {
    const pending = unsaved.current;
    if (!pending) return;
    try {
      await api("/api/progress", { method: "PUT", body: { items: [pending] }, keepalive: true });
      if (unsaved.current === pending) unsaved.current = null;
    } catch {
      // Kept in `unsaved`; the next save or coming back online retries it.
    }
  }, []);

  const save = useCallback(
    (finished = false) => {
      const it = itemRef.current;
      if (!it) return;
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
      if (idx === fileIndex.current && el.src && pendingSeek.current === null) {
        el.currentTime = t - (it.files[idx]?.startSec ?? 0);
        positionRef.current = t;
        setPosition(t);
      } else {
        load(it, t, !el.paused);
      }
    },
    [load],
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
      load(it, startAt ?? it.startAt, true);
      try {
        localStorage.setItem(NOW_PLAYING_KEY, JSON.stringify(refOf(it)));
      } catch {
        // private mode
      }
      removeFromQueue(refOf(it));
    },
    [load, removeFromQueue, save, seek],
  );

  const playRef = useCallback(
    async (ref: QueueRef, startAt?: number) => {
      try {
        play(await loadPlayable(ref), startAt);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load that.");
      }
    },
    [play],
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

  const skipBy = useCallback((delta: number) => seek(positionRef.current + delta), [seek]);

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
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
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
    let saved: QueueRef | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(NOW_PLAYING_KEY) ?? "null") as QueueRef | null;
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
  }, [load, refreshQueue]);

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

  // ---------- Lock screen, notification and headset controls ----------

  const handlers = useRef({ toggle, skipBy, chapterStep, seek, skip });
  handlers.current = { toggle, skipBy, chapterStep, seek, skip };

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

  const isCurrent = useCallback((type: ItemType, id: string) => item?.type === type && item.id === id, [item]);

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
      queue,
      queueLoaded,
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
      queue,
      queueLoaded,
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
        <audio
          ref={audio}
          preload="metadata"
          onLoadedMetadata={(e) => {
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
          onWaiting={() => setLoading(true)}
          onPlaying={() => setLoading(false)}
          onTimeUpdate={(e) => {
            const it = itemRef.current;
            if (!it || pendingSeek.current !== null) return;
            const pos = (it.files[fileIndex.current]?.startSec ?? 0) + e.currentTarget.currentTime;
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
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            const it = itemRef.current;
            if (!it) return;
            // A pause right at the end is the finish, which onEnded saves.
            const dur = it.durationSec || 0;
            if (dur && positionRef.current >= dur - 1) return;
            save();
          }}
          onSeeked={() => updatePositionState(positionRef.current, true)}
          onEnded={() => {
            const it = itemRef.current;
            if (!it) return;
            const next = fileIndex.current + 1;
            if (next < it.files.length) {
              load(it, it.files[next]!.startSec, true);
              return;
            }
            void save(true)?.then(() => router.refresh());
            void advance();
          }}
          onError={(e) => {
            if (!itemRef.current || !e.currentTarget.getAttribute("src")) return;
            setLoading(false);
            setPlaying(false);
            setError("Couldn't play this. Check your connection and try again.");
          }}
        />
    </PlayerContext.Provider>
  );
}
