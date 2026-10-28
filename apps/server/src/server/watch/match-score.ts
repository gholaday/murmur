import { normalizeText, similarity } from "../metadata/score";

/** A TMDB search result, movie or show, cut down to what matching needs. */
export interface TmdbResult {
  id: number;
  title: string;
  originalTitle: string;
  year: number | null;
}

/** Results looked at: TMDB already ranks them, so a good match is near the top or not there. */
const LOOK_AT = 5;
const CLOSE = 0.8;

/** For comparing titles: plain words, no leading article. */
const titleKey = (s: string) => normalizeText(s).replace(/^(the|a|an) /, "");

/** A TMDB id written into a folder or file name, Plex's `{tmdb-603}` or Jellyfin's `[tmdbid-603]`. */
export function tmdbIdFromName(name: string): number | null {
  const m = /[{[]tmdb(?:id)?-(\d+)[}\]]/i.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * The result to take without asking, or null. With a year: a close title within a year, or
 * the folder's title holding TMDB's (or the other way round) in the same year, which covers
 * "Star Wars Episode V - The Empire Strikes Back" against "The Empire Strikes Back". Without a
 * year only an exact title counts, since remakes share names.
 */
export function pickMatch(local: { title: string; year: number | null }, results: TmdbResult[]): TmdbResult | null {
  const l = titleKey(local.title);
  if (!l) return null;
  for (const r of results.slice(0, LOOK_AT)) {
    const names = [titleKey(r.title), titleKey(r.originalTitle)].filter(Boolean);
    if (local.year === null) {
      if (names.includes(l)) return r;
      continue;
    }
    if (r.year === null) continue;
    const off = Math.abs(r.year - local.year);
    const close = Math.max(...names.map((t) => similarity(l, t))) >= CLOSE;
    const holds = names.some((t) => t.length >= 4 && (` ${l} `.includes(` ${t} `) || ` ${t} `.includes(` ${l} `)));
    if ((close && off <= 1) || (holds && off === 0)) return r;
  }
  return null;
}
