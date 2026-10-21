"use client";

import { useSyncExternalStore } from "react";
import { AD_PREFS_KEY, type AdPrefs, DEFAULT_AD_PREFS, parseAdPrefs } from "@murmur/shared/client";

// The modes and skip rules are shared with the Android app; this keeps the browser's copy.
export { AD_MODES, adBreak, adModeFor, adToSkip, playedThrough, setShowMode, type AdMode, type AdPrefs } from "@murmur/shared/client";

function read(): AdPrefs {
  try {
    return parseAdPrefs(JSON.parse(localStorage.getItem(AD_PREFS_KEY) ?? "null") as Partial<AdPrefs> | null);
  } catch {
    return DEFAULT_AD_PREFS;
  }
}

export const adPrefsStore = (() => {
  let value: AdPrefs | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): AdPrefs => (value ??= read()),
    set(next: AdPrefs) {
      value = next;
      try {
        localStorage.setItem(AD_PREFS_KEY, JSON.stringify(next));
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

const serverSnapshot = () => DEFAULT_AD_PREFS;

export function useAdPrefs(): AdPrefs {
  return useSyncExternalStore(adPrefsStore.subscribe, adPrefsStore.get, serverSnapshot);
}
