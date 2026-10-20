"use client";

import { useSyncExternalStore } from "react";

/** Volume on this device: the slider's level, and whether it's muted (which keeps the level for unmuting). */
export interface Volume {
  level: number;
  muted: boolean;
}

const KEY = "murmur.volume";
const DEFAULT: Volume = { level: 1, muted: false };

function read(): Volume {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Volume> | null;
    if (!raw) return DEFAULT;
    const level = typeof raw.level === "number" && raw.level >= 0 && raw.level <= 1 ? raw.level : DEFAULT.level;
    return { level, muted: raw.muted === true };
  } catch {
    return DEFAULT;
  }
}

export const volumeStore = (() => {
  let value: Volume | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): Volume => (value ??= read()),
    set(next: Volume) {
      value = next;
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // private mode: kept for this visit only
      }
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
})();

const serverSnapshot = () => DEFAULT;

export function useVolume(): Volume {
  return useSyncExternalStore(volumeStore.subscribe, volumeStore.get, serverSnapshot);
}

/** What the audio element plays at. */
export const effectiveVolume = (v: Volume) => (v.muted ? 0 : v.level);
