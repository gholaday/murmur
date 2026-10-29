import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { AD_PREFS_KEY, type AdPrefs, type HealthDto, parseAdPrefs } from "@murmur/shared/client";
import { api } from "@/lib/api";
import { getJson, setJson } from "@/lib/storage";

// The modes and skip rules are shared with the web player; this keeps the phone's copy.
export { AD_MODES, adBreak, adModeFor, adToSkip, playedThrough, setShowMode, type AdMode, type AdPrefs } from "@murmur/shared/client";

let value: AdPrefs = parseAdPrefs(getJson<Partial<AdPrefs>>(AD_PREFS_KEY));
const listeners = new Set<() => void>();

export const adPrefsStore = {
  get: (): AdPrefs => value,
  set(next: AdPrefs) {
    value = next;
    setJson(AD_PREFS_KEY, next);
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
  // The last answer is read from storage once, not on every render of the player.
  const [stored] = useState(() => getJson<boolean>(DETECTION_KEY) ?? undefined);
  useEffect(() => {
    if (known !== undefined) setJson(DETECTION_KEY, known);
  }, [known]);
  return known ?? stored;
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
