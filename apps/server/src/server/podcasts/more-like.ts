import type { DirectoryShow } from "./directory";

/**
 * How "More like <show>" finds its shows, as plain functions (the fetching is in directory.ts).
 * A show is described by what it talks about: a phrase from its title and the words its episode
 * titles keep coming back to. Each is searched in the directory, and a show found by several of
 * those searches, near their tops, in the same category, ranks highest. The category's chart only
 * tops up a shelf the searches can't fill.
 */

/** Words that say nothing about a show's subject. */
const STOP = new Set(
  (
    "the and for with from that this what when where which who whom whose why how are was were been being have has had " +
    "not but you your yours our ours their they them she her him his its it's into onto over under about after before " +
    "than then there here also just only more most much many some any all can could would should will shall may might " +
    "must one two three four five six seven eight nine ten first second third last next new old big best top get got " +
    "make made does did doing done out off very really ever every each other another such own same too again still " +
    "episode episodes ep eps podcast podcasts show shows part parts bonus special edition season series week weekly " +
    "daily today live interview interviews conversation conversations talk talks discussion chat feat ft featuring guest " +
    "guests intro introduction recap review reviews preview previews prediction predictions analysis update updates " +
    "news vs versus mr mrs ms dr prof official presents presented present hour minute minutes day days year years time " +
    "back now way good great something things thing people let lets why whats audio video full unabridged recording " +
    "trailer teaser rerun replay encore classic"
  ).split(" "),
);
// "great" is common in titles but it's the whole subject of "great books", so phrases may keep it.
const PHRASE_OK = new Set(["great", "new", "best", "top", "old", "big"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

/**
 * The phrase a title is about: its longest part between dashes, colons and bars, without the
 * filler. "Ascend - The Great Books Podcast" is about "great books". Null when that leaves
 * nothing, or only the title itself.
 */
export function titleSubject(title: string): string | null {
  const parts = title.split(/\s+[-–—:|]\s+|:\s+|\|/).map((p) =>
    words(p)
      .filter((w) => !STOP.has(w) || PHRASE_OK.has(w))
      .join(" "),
  );
  const best = parts.sort((a, b) => b.split(" ").length - a.split(" ").length)[0] ?? "";
  if (!best || best === words(title).join(" ")) return null;
  return best;
}

/**
 * The words and two-word phrases a show's episodes keep coming back to, best first: each counts
 * the episode titles it appears in, a phrase counts half again, and the description adds one.
 * A title word counts ("gators" for Gators Breakdown), but not the title or its subject, nor the
 * subject's words, since those are searched on their own.
 */
export function subjectTerms(show: { title: string; description: string | null; episodeTitles: string[] }, max = 3): string[] {
  const subject = titleSubject(show.title);
  const searched = new Set([words(show.title).join(" "), ...(subject ? [subject, ...subject.split(" ")] : [])]);
  const counts = new Map<string, number>();
  const count = (text: string, weight: number) => {
    const ws = words(text);
    const seen = new Set<string>();
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]!;
      if (!STOP.has(w) && !searched.has(w)) seen.add(w);
      const next = ws[i + 1];
      if (next && !STOP.has(w) && !STOP.has(next) && !searched.has(`${w} ${next}`)) seen.add(`${w} ${next}`);
    }
    for (const term of seen) counts.set(term, (counts.get(term) ?? 0) + weight);
  };
  for (const t of show.episodeTitles) count(t, 1);
  if (show.description) count(show.description, 1);

  const scored = [...counts]
    .filter(([, n]) => n >= 2)
    .map(([term, n]) => ({ term, score: term.includes(" ") ? n * 1.5 : n }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
  const out: string[] = [];
  for (const { term } of scored) {
    // A word that's already in a chosen phrase (or a phrase around a chosen word) adds nothing.
    if (out.some((o) => o.split(" ").includes(term) || term.split(" ").includes(o))) continue;
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

/** A directory search for a show, and how much it's trusted to say what the show is like. */
export interface SearchHits {
  weight: number;
  shows: DirectoryShow[];
}

const feedKey = (u: string) => u.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();

/**
 * Shows like `source`, best first. A show scores for each search that found it, more near the
 * top; it scores again for being in the source's category chart, and is weighed by how much its
 * categories match the source's. The source itself is left out.
 */
export function rankLike(source: { feedUrl: string; genreIds: number[] }, searches: SearchHits[], chart: DirectoryShow[]): DirectoryShow[] {
  const sourceKey = feedKey(source.feedUrl);
  const scores = new Map<string, { show: DirectoryShow; score: number; hits: number }>();
  const add = (show: DirectoryShow, points: number, hit: number) => {
    const key = feedKey(show.feedUrl);
    if (key === sourceKey) return;
    const entry = scores.get(key) ?? { show, score: 0, hits: 0 };
    entry.score += points;
    entry.hits += hit;
    scores.set(key, entry);
  };
  for (const s of searches) s.shows.forEach((show, rank) => add(show, s.weight / (1 + rank * 0.15), 1));
  chart.forEach((show, rank) => add(show, 0.4 * (1 - rank / Math.max(chart.length, 1)), 0));

  const [main] = source.genreIds;
  const fit = (show: DirectoryShow) => {
    if (main === undefined) return 1;
    if (show.genreIds.includes(main)) return 1.6;
    if (show.genreIds.some((g) => source.genreIds.includes(g))) return 1.2;
    return 0.4;
  };
  return (
    [...scores.values()]
      // One search's stray hit in another category is a word that means something else there
      // ("offense" in basketball for a football show), and the title and its subject often find the
      // same stray. Outside the main category it takes two searches agreeing to keep a show, and
      // with no category in common, three.
      .filter((e) => main === undefined || fit(e.show) > 1.2 || e.hits >= (fit(e.show) > 0.4 ? 2 : 3))
      .map((e) => ({ show: e.show, score: e.score * fit(e.show) }))
      .sort((a, b) => b.score - a.score)
      .map((e) => e.show)
  );
}
