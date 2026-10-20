import type { AdSpan } from "@murmur/shared";

export interface CachedFileInfo {
  episodeId: string;
  size: number;
  /** Last played, or when it finished downloading if never played. */
  lastUsedAt: number;
}

/**
 * The order cached episodes are removed in when the cache is over its cap: never one in
 * `keep` (in someone's Up Next, in progress, or among its show's newest), then episodes
 * everyone finished or archived, then the least recently used.
 */
export function evictionOrder(files: CachedFileInfo[], keep: Set<string>, finishedByAll: Set<string>): CachedFileInfo[] {
  return files
    .filter((f) => !keep.has(f.episodeId))
    .sort((a, b) => {
      const fa = finishedByAll.has(a.episodeId) ? 0 : 1;
      const fb = finishedByAll.has(b.episodeId) ? 0 : 1;
      return fa - fb || a.lastUsedAt - b.lastUsedAt;
    });
}

/** A single ad longer than this is a misreading, not an ad. */
const MAX_AD_SEC = 300;

/**
 * Makes ad spans from the add-on safe to act on: drops impossible ones (ending before they
 * start, longer than 5 minutes, starting past the end), cuts ones that run past the end,
 * and joins copies of the same ad that overlap by more than 3 seconds.
 */
export function cleanAdSpans(spans: AdSpan[], durationSec: number | null): AdSpan[] {
  const out: AdSpan[] = [];
  const sorted = spans
    .map((s) => ({ ...s, endSec: durationSec ? Math.min(s.endSec, durationSec) : s.endSec }))
    .filter((s) => s.endSec > s.startSec && s.endSec - s.startSec <= MAX_AD_SEC && (!durationSec || s.startSec < durationSec))
    .sort((a, b) => a.startSec - b.startSec);
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.startSec < last.endSec - 3) last.endSec = Math.max(last.endSec, s.endSec);
    else out.push({ ...s });
  }
  return out;
}

/** File extension for a cached episode, from its type or else its URL. */
export function audioExtension(mimeType: string | null, url: string): string {
  const type = (mimeType ?? "").toLowerCase();
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "m4a";
  if (type.includes("ogg") || type.includes("opus")) return "ogg";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  const m = /\.(mp3|m4a|mp4|aac|ogg|opus)(?:[?#]|$)/i.exec(url);
  if (!m) return "mp3";
  const ext = m[1]!.toLowerCase();
  return ext === "mp4" || ext === "aac" ? "m4a" : ext === "opus" ? "ogg" : ext;
}
