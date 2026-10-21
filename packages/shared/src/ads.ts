import type { AdSpan } from "./index";

// How a device handles podcast ads, and the auto-skip rules, shared by the web player and the
// Android app. Each keeps the preferences in its own storage; they aren't synced.

export type AdMode = "off" | "show" | "auto";

/** `short` fits the player's Ads tile. */
export const AD_MODES: Array<{ id: AdMode; label: string; short: string; hint: string }> = [
  { id: "off", label: "Off", short: "Off", hint: "Ads play as usual" },
  { id: "show", label: "Show", short: "Show", hint: "Mark ads on the seek bar" },
  { id: "auto", label: "Auto-skip", short: "Auto", hint: "Skip ads, with Undo" },
];

/** How this device handles ads, with optional per-show overrides. */
export interface AdPrefs {
  mode: AdMode;
  shows: Record<string, AdMode>;
}

export const AD_PREFS_KEY = "murmur.ads";
export const DEFAULT_AD_PREFS: AdPrefs = { mode: "show", shows: {} };

const isMode = (v: unknown): v is AdMode => v === "off" || v === "show" || v === "auto";

/** Saved preferences as read back from storage, dropping anything that isn't a mode. */
export function parseAdPrefs(raw: Partial<AdPrefs> | null): AdPrefs {
  if (!raw) return DEFAULT_AD_PREFS;
  const shows = Object.fromEntries(Object.entries(raw.shows ?? {}).filter(([, m]) => isMode(m))) as Record<string, AdMode>;
  return { mode: isMode(raw.mode) ? raw.mode : DEFAULT_AD_PREFS.mode, shows };
}

/** The mode for a show on this device: its override, else the device's mode. */
export function adModeFor(prefs: AdPrefs, podcastId: string | null): AdMode {
  return (podcastId && prefs.shows[podcastId]) || prefs.mode;
}

/** Sets or clears (null) a show's override. */
export function setShowMode(prefs: AdPrefs, podcastId: string, mode: AdMode | null): AdPrefs {
  const shows = { ...prefs.shows };
  if (mode) shows[podcastId] = mode;
  else delete shows[podcastId];
  return { ...prefs, shows };
}

/**
 * The run of back-to-back ads that starts with `spans[i]` (gaps under 3 seconds count as back
 * to back), so skipping jumps the whole break instead of one ad at a time. Spans are sorted.
 */
export function adBreak(spans: AdSpan[], i: number): { endSec: number; indexes: number[] } {
  let endSec = spans[i]!.endSec;
  const indexes = [i];
  for (let j = i + 1; j < spans.length && spans[j]!.startSec - endSec < 3; j++) {
    endSec = Math.max(endSec, spans[j]!.endSec);
    indexes.push(j);
  }
  return { endSec, indexes };
}

/**
 * Whether a move from `prev` to `pos` between two position ticks was normal playback rather
 * than a seek: forward by about as much as the clock moved. Ticks can be spaced out (a
 * background tab, a phone with the screen off), so it isn't a fixed few seconds.
 */
export function playedThrough(prev: number, pos: number, elapsedSec: number, speed: number): boolean {
  return pos > prev && pos - prev <= Math.max(3, elapsedSec * speed + 2);
}

/**
 * The ad break to skip when a move forward from `prev` to `pos` crossed an ad's start and
 * landed inside it, or null. An ad at 0:00 is never crossed into, so starting there counts.
 * `allowed` holds the ads Undo let play. Undo goes back to `undoTo`, or the ad's start.
 */
export function adToSkip(
  spans: AdSpan[],
  prev: number,
  pos: number,
  allowed: ReadonlySet<number>,
  undoTo?: number,
): { endSec: number; indexes: number[]; undoTo: number } | null {
  if (pos <= prev) return null;
  const ranInto = (s: AdSpan) => prev < s.startSec || (s.startSec < 1 && prev < 1);
  const i = spans.findIndex((s, idx) => ranInto(s) && pos >= s.startSec && pos < s.endSec && !allowed.has(idx));
  if (i < 0) return null;
  return { ...adBreak(spans, i), undoTo: Math.max(spans[i]!.startSec, undoTo ?? 0) };
}
