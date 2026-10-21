import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdSpan, HealthDto } from "@murmur/shared/client";
import { api } from "@/lib/api";
import { getJson, setJson } from "@/lib/storage";

// How this phone handles podcast ads, like the web's apps/server/src/web/player/ad-prefs.ts.
// Kept on the device, not synced.

export type AdMode = "off" | "show" | "auto";

/** `short` fits the player's Ads tile. */
export const AD_MODES: { id: AdMode; label: string; short: string; hint: string }[] = [
  { id: "off", label: "Off", short: "Off", hint: "Ads play as usual" },
  { id: "show", label: "Show", short: "Show", hint: "Mark ads on the seek bar" },
  { id: "auto", label: "Auto-skip", short: "Auto", hint: "Skip ads, with Undo" },
];

export interface AdPrefs {
  mode: AdMode;
  shows: Record<string, AdMode>;
}

const KEY = "murmur.ads";
const DEFAULT: AdPrefs = { mode: "show", shows: {} };
const isMode = (v: unknown): v is AdMode => v === "off" || v === "show" || v === "auto";

function read(): AdPrefs {
  const raw = getJson<Partial<AdPrefs>>(KEY);
  if (!raw) return DEFAULT;
  const shows = Object.fromEntries(Object.entries(raw.shows ?? {}).filter(([, m]) => isMode(m))) as Record<string, AdMode>;
  return { mode: isMode(raw.mode) ? raw.mode : DEFAULT.mode, shows };
}

let value: AdPrefs = read();
const listeners = new Set<() => void>();

export const adPrefsStore = {
  get: (): AdPrefs => value,
  set(next: AdPrefs) {
    value = next;
    setJson(KEY, next);
    listeners.forEach((l) => l());
  },
};

const DETECTION_KEY = "murmur.adDetection";

/**
 * Whether the server finds ads (its health says so), so ad options are worth showing. Offline
 * it's the server's last answer, so downloaded episodes keep their marks and Auto-skip;
 * undefined when the server has never been asked.
 */
export function useAdDetection(): boolean | undefined {
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<HealthDto>("/api/health") });
  const known = health.data ? health.data.adDetection === true : undefined;
  useEffect(() => {
    if (known !== undefined) setJson(DETECTION_KEY, known);
  }, [known]);
  return known ?? getJson<boolean>(DETECTION_KEY) ?? undefined;
}

export function useAdPrefs(): AdPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    adPrefsStore.get,
  );
}

/** The mode for a show on this device: its override, else the device's mode. */
export function adModeFor(prefs: AdPrefs, podcastId: string | null): AdMode {
  return (podcastId && prefs.shows[podcastId]) || prefs.mode;
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

/** Sets or clears (null) a show's override. */
export function setShowMode(prefs: AdPrefs, podcastId: string, mode: AdMode | null): AdPrefs {
  const shows = { ...prefs.shows };
  if (mode) shows[podcastId] = mode;
  else delete shows[podcastId];
  return { ...prefs, shows };
}
