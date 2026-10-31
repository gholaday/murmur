import type { MatchCandidate } from "@murmur/shared";
import { stripNoise } from "../library/parse";

// Deterministic scoring for Match: the same book and candidate always get the same score,
// and every point can be explained. Weights follow docs/spec/metadata.md ("How matching stays consistent").

/** Lowercase, accents folded, "&" as "and", punctuation dropped, spaces collapsed. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Title for comparing: no "(Unabridged)", series numbers, leading articles or ": A Novel". */
export function cleanTitle(s: string): string {
  return normalizeText(
    stripNoise(s)
      .replace(/^\s*(book|vol\.?|volume|part)\s*\d+(\.\d+)?\s*[-–:.]\s*/i, "")
      .replace(/[:\-–]\s*a novel\s*$/i, "")
      .replace(/\(\s*(book|vol\.?|volume)\s*\d+[^)]*\)/gi, ""),
  ).replace(/^(the|a|an) /, "");
}

/**
 * Person names compared loosely: "J.R.R. Tolkien" = "J. R. R. Tolkien" = "Tolkien, J.R.R.".
 */
export function normalizeName(s: string): string {
  let name = s.trim();
  const comma = /^([^\s,]+),\s*([^,]+)$/.exec(name);
  if (comma) name = `${comma[2]} ${comma[1]}`;
  // Join runs of single-letter initials: "j r r tolkien" -> "jrr tolkien".
  const out: string[] = [];
  let initials = "";
  for (const word of normalizeText(name).split(" ")) {
    if (word.length === 1) {
      initials += word;
      continue;
    }
    if (initials) out.push(initials);
    initials = "";
    out.push(word);
  }
  if (initials) out.push(initials);
  return out.join(" ");
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const t = s.replace(/ /g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** 0..1 similarity of two already-normalized strings (Dice on bigrams, or token overlap if higher). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const sizeA = [...A.values()].reduce((x, y) => x + y, 0);
  const sizeB = [...B.values()].reduce((x, y) => x + y, 0);
  const dice = sizeA + sizeB ? (2 * inter) / (sizeA + sizeB) : 0;
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const tokens = shared / Math.max(ta.size, tb.size);
  return Math.max(dice, tokens);
}

/** Best match between any local author and any candidate author. */
export function nameSimilarity(local: string, candidate: string): number {
  const split = (s: string) =>
    s
      .split(/\s*(?:,|&|;|\band\b)\s*/i)
      .map(normalizeName)
      .filter((n) => n.length > 1);
  // "Tolkien, J.R.R." is one reversed name; "Douglas Preston, Lincoln Child" is two people.
  const parts = (s: string) => (/^[^\s,]+,\s*[^,&]+$/.test(s.trim()) ? [normalizeName(s)] : split(s));
  let best = 0;
  for (const a of parts(local)) for (const b of parts(candidate)) best = Math.max(best, similarity(a, b));
  return best;
}

export interface LocalBook {
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  seriesPosition: number | null;
  durationSec: number;
  asin: string | null;
}

export type UnscoredCandidate = Omit<MatchCandidate, "score" | "reasons">;

const WEIGHTS = { title: 30, author: 25, duration: 25, narrator: 10, series: 7, language: 3 };

function fmtDuration(sec: number) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/** Duration agreement: within 2% is full marks, 15% or more apart is none. */
export function durationScore(localSec: number, candidateSec: number): number {
  const diff = Math.abs(localSec - candidateSec) / localSec;
  if (diff <= 0.02) return 1;
  if (diff >= 0.15) return 0;
  return 1 - (diff - 0.02) / 0.13;
}

export function scoreCandidate(local: LocalBook, c: UnscoredCandidate): MatchCandidate {
  const reasons: string[] = [];
  let earned = 0;
  let possible = 0;
  const add = (weight: number, value: number) => {
    earned += weight * value;
    possible += weight;
  };

  const localTitle = cleanTitle(local.title);
  const titleSim = Math.max(
    similarity(localTitle, cleanTitle(c.title)),
    c.subtitle ? similarity(localTitle, cleanTitle(`${c.title} ${c.subtitle}`)) : 0,
  );
  add(WEIGHTS.title, titleSim);
  reasons.push(titleSim >= 0.95 ? "Title matches" : `Title ${Math.round(titleSim * 100)}% similar`);

  let authorSim: number | null = null;
  if (local.author && c.author) {
    authorSim = nameSimilarity(local.author, c.author);
    add(WEIGHTS.author, authorSim);
    reasons.push(authorSim >= 0.9 ? "Author matches" : `Author differs (${c.author})`);
  }

  let durationKnown = false;
  if (local.durationSec > 0 && c.durationSec) {
    durationKnown = true;
    const d = durationScore(local.durationSec, c.durationSec);
    add(WEIGHTS.duration, d);
    const pct = Math.round((Math.abs(local.durationSec - c.durationSec) / local.durationSec) * 100);
    reasons.push(
      d === 1
        ? `Length matches (${fmtDuration(c.durationSec)})`
        : `Length ${fmtDuration(c.durationSec)}, ${pct}% off${c.durationSec < local.durationSec * 0.85 ? ", likely abridged" : ""}`,
    );
  } else {
    reasons.push("Length unknown, so the edition can't be confirmed");
  }

  if (local.narrator && c.narrator) {
    const n = nameSimilarity(local.narrator, c.narrator);
    add(WEIGHTS.narrator, n);
    reasons.push(n >= 0.9 ? "Narrator matches" : `Different narrator (${c.narrator})`);
  }

  if (local.series && c.series) {
    const s = similarity(normalizeText(local.series), normalizeText(c.series));
    const posOk = local.seriesPosition === null || c.seriesPosition === null || local.seriesPosition === c.seriesPosition;
    add(WEIGHTS.series, s * (posOk ? 1 : 0.4));
    if (s >= 0.8) reasons.push(posOk ? "Series matches" : `Different book in the series (#${c.seriesPosition})`);
  }

  if (c.language) {
    const english = /^en(glish)?$/i.test(c.language);
    add(WEIGHTS.language, english ? 1 : 0);
    if (!english) reasons.push(`In ${c.language}`);
  }

  let score = possible ? Math.round((earned / possible) * 100) : 0;
  // A wrong title or author can't be outweighed by everything else agreeing.
  if (titleSim < 0.5 || (authorSim !== null && authorSim < 0.5)) score = Math.min(score, 60);
  // Without a length we can't tell unabridged from abridged, so never pre-select it.
  if (!durationKnown) score = Math.min(score, 85);
  // An exact ASIN is an ID match, not a guess, unless the length says it's a different edition.
  if (local.asin && c.provider === "audible" && c.providerId === local.asin) {
    const lengthOff = durationKnown && durationScore(local.durationSec, c.durationSec!) < 0.5;
    if (!lengthOff) {
      score = Math.max(score, 98);
      reasons.unshift("ASIN from your files");
    }
  }
  return { ...c, score, reasons };
}
