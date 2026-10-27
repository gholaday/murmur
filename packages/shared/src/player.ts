import { apiPaths } from "./api-paths";
import { clock, duration, timeLeft } from "./format";
import type { ChapterDto, QueueEntry, QueueRef } from "./index";

// Player rules shared by the web player and the app's, so both behave the same.

// ---------- Speed ----------

export const MIN_SPEED = 0.5;
/** The app's player (expo-audio) can't go faster, so the web player stops there too. */
export const MAX_SPEED = 2;
/** The − and + buttons jump by this. */
export const SPEED_STEP = 0.25;

/** Within the limits, to two decimals. Also brings speeds saved under an older, higher limit back in range. */
export const clampSpeed = (v: number) => Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, v)) * 100) / 100;

/** 1×, 1.25×, 1.5×: no trailing zeros. */
export const speedText = (v: number) => `${Number(v.toFixed(2))}×`;

// ---------- Sleep timer ----------

export const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60, 90];

export type SleepTimer = { mode: "off" } | { mode: "timer"; endsAt: number } | { mode: "chapter"; endSec: number };

/** The sleep button's label: the time left, "Chapter end", or "Sleep" when it's off. */
export function sleepLabel(sleep: SleepTimer, now: number): string {
  if (sleep.mode === "timer") return clock(Math.max(0, (sleep.endsAt - now) / 1000));
  if (sleep.mode === "chapter") return "Chapter end";
  return "Sleep";
}

// ---------- Chapters ----------

/** The chapter playing at `position`, or -1 before the first. A hair early, so a seek to a chapter's start lands in it. */
export function chapterAt(chapters: ChapterDto[], position: number): number {
  return chapters.findLastIndex((c) => c.startSec <= position + 0.25);
}

// ---------- Skip buttons ----------

export interface SkipSettings {
  back: number;
  forward: number;
}

export const DEFAULT_SKIP: SkipSettings = { back: 10, forward: 30 };
export const SKIP_BACK_OPTIONS = [5, 10, 15, 30];
export const SKIP_FORWARD_OPTIONS = [10, 15, 30, 45, 60];

/** Saved skip settings, or the defaults when there are none or they don't make sense. */
export function parseSkip(raw: unknown): SkipSettings {
  const s = raw as Partial<SkipSettings> | null;
  if (s && typeof s.back === "number" && typeof s.forward === "number" && s.back > 0 && s.forward > 0) {
    return { back: s.back, forward: s.forward };
  }
  return DEFAULT_SKIP;
}

// ---------- Saving ----------

/** Device storage keys. */
export const NOW_PLAYING_KEY = "murmur.nowPlaying";
export const SKIP_KEY = "murmur.skip";
export const HAPTICS_KEY = "murmur.haptics";
/** How often the position is saved while playing. */
export const SAVE_EVERY_MS = 10_000;
/** How often ad times are re-fetched while the current episode is still being scanned. */
export const ADS_POLL_MS = 60_000;

// ---------- Up Next ----------

export const queueRef = (e: QueueEntry): QueueRef => ({ itemType: e.itemType, itemId: e.itemId });

/** What an Up Next row shows. `kind` is the author or show, which sits above the title. */
export function queueEntryView(e: QueueEntry) {
  if (e.itemType === "book") {
    const b = e.book;
    const pos = b.progress && !b.progress.finished ? b.progress.positionSec : 0;
    return {
      kind: b.author ?? "Audiobook",
      title: b.title,
      length: pos > 5 ? timeLeft(b.durationSec, pos) : duration(b.durationSec),
      cover: b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 200) : null,
      color: b.coverColor,
      remaining: Math.max(0, b.durationSec - pos),
    };
  }
  if (e.itemType === "track") {
    const t = e.track;
    return {
      kind: t.artist,
      title: t.title,
      length: duration(t.durationSec),
      cover: t.coverHash ? apiPaths.albumCoverUrl(t.albumId, t.coverHash, 200) : null,
      color: null,
      remaining: t.durationSec,
    };
  }
  const ep = e.episode;
  const dur = ep.durationSec ?? 0;
  const pos = ep.progress && !ep.progress.finished ? ep.progress.positionSec : 0;
  return {
    kind: ep.podcastTitle,
    title: ep.title,
    length: pos > 5 && dur ? timeLeft(dur, pos) : duration(dur),
    cover: ep.podcastCoverHash ? apiPaths.podcastCoverUrl(ep.podcastId, ep.podcastCoverHash, 200) : null,
    color: ep.podcastCoverColor,
    remaining: Math.max(0, dur - pos),
  };
}
