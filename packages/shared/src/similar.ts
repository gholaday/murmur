// "More like this" for books and movies, shared by the server, the web and the app.

/** Something to rank: its genre keys with their weights, plus people to break ties on. */
export interface SimilarItem {
  id: string;
  title: string;
  keys: ReadonlyMap<string, number>;
  authors?: readonly string[];
  narrators?: readonly string[];
}

const LADDER_SEP = " > ";

/**
 * Audible genre ladders ("A > B > C") as keys: every prefix at least two levels deep, weighted
 * by depth (two levels weigh 1, three weigh 2, and so on). A root alone says too little to count.
 */
export function ladderKeys(paths: readonly string[]): Map<string, number> {
  const keys = new Map<string, number>();
  for (const path of paths) {
    const parts = path.split(LADDER_SEP).map((s) => s.trim()).filter(Boolean);
    for (let depth = 2; depth <= parts.length; depth++) keys.set(parts.slice(0, depth).join(LADDER_SEP), depth - 1);
  }
  return keys;
}

/** Flat genre names, as TMDB gives them, each weighing 1. */
export function flatKeys(names: readonly string[]): Map<string, number> {
  return new Map(names.map((n) => [n, 1]));
}

/**
 * "A, B; C" as a list of names to compare, so co-written books still match on one of their
 * authors. Spaces and dots are dropped, so "C.S. Lewis" and "C. S. Lewis" are the same person.
 */
export function splitPeople(names: string | null | undefined): string[] {
  return (names ?? "")
    .split(/[,;&]/)
    .map((s) => s.toLowerCase().replace(/[\s.]+/g, ""))
    .filter(Boolean);
}

const sharedCount = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  a && b ? a.filter((x) => b.includes(x)).length : 0;

/**
 * Items like `target`, best first. Each shared key scores its weight times how rare it is among
 * `items` (1 / log(1 + n)), so a key half the library has counts for little. Ties go to shared
 * authors, then narrators, then title. Items sharing nothing are left out, and so is `target`.
 */
export function rankSimilar<T extends SimilarItem>(target: SimilarItem, items: readonly T[]): T[] {
  const counts = new Map<string, number>();
  for (const item of items) for (const key of item.keys.keys()) counts.set(key, (counts.get(key) ?? 0) + 1);
  return items
    .filter((item) => item.id !== target.id)
    .map((item) => {
      let score = 0;
      for (const [key, weight] of target.keys) {
        if (item.keys.has(key)) score += weight / Math.log(1 + Math.max(counts.get(key) ?? 1, 1));
      }
      return { item, score, authors: sharedCount(target.authors, item.authors), narrators: sharedCount(target.narrators, item.narrators) };
    })
    .filter((s) => s.score > 0 || s.authors > 0 || s.narrators > 0)
    .sort(
      (a, b) =>
        (Math.abs(b.score - a.score) > 1e-9 ? b.score - a.score : 0) ||
        b.authors - a.authors ||
        b.narrators - a.narrators ||
        a.item.title.localeCompare(b.item.title),
    )
    .map((s) => s.item);
}
