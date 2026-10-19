import { describe, expect, it } from "vitest";
import { cleanTitle, nameSimilarity, scoreCandidate, type LocalBook, type UnscoredCandidate } from "./score";

const local: LocalBook = {
  title: "Project Hail Mary",
  author: "Andy Weir",
  narrator: "Ray Porter",
  series: null,
  seriesPosition: null,
  durationSec: 16 * 3600 + 10 * 60,
  asin: null,
};

const candidate = (over: Partial<UnscoredCandidate>): UnscoredCandidate => ({
  provider: "audible",
  providerId: "B08G9PRS1K",
  title: "Project Hail Mary",
  subtitle: null,
  author: "Andy Weir",
  narrator: "Ray Porter",
  series: null,
  seriesPosition: null,
  year: "2021",
  durationSec: 16 * 3600 + 10 * 60,
  language: "english",
  coverUrl: null,
  ...over,
});

describe("matching", () => {
  it("treats different spellings of the same name as equal", () => {
    expect(nameSimilarity("J.R.R. Tolkien", "J. R. R. Tolkien")).toBe(1);
    expect(nameSimilarity("Tolkien, J.R.R.", "JRR Tolkien")).toBe(1);
    expect(nameSimilarity("Douglas Preston, Lincoln Child", "Lincoln Child")).toBe(1);
  });

  it("cleans titles before comparing", () => {
    expect(cleanTitle("The Martian (Unabridged)")).toBe(cleanTitle("Martian"));
    expect(cleanTitle("Book 2 - The Two Towers")).toBe("two towers");
  });

  it("suggests an exact edition and rejects an abridged one", () => {
    expect(scoreCandidate(local, candidate({})).score).toBeGreaterThanOrEqual(90);
    const abridged = scoreCandidate(local, candidate({ durationSec: 6 * 3600 }));
    expect(abridged.score).toBeLessThan(90);
    expect(abridged.reasons.join(" ")).toContain("abridged");
  });

  it("caps a same-title book by another author", () => {
    expect(scoreCandidate(local, candidate({ author: "Someone Else" })).score).toBeLessThanOrEqual(60);
  });

  it("never pre-selects a candidate without a length", () => {
    expect(scoreCandidate(local, candidate({ provider: "google", durationSec: null, narrator: null })).score).toBeLessThanOrEqual(85);
  });

  it("trusts an ASIN from the files unless the length disagrees", () => {
    const withAsin = { ...local, title: "PHM", asin: "B08G9PRS1K" };
    expect(scoreCandidate(withAsin, candidate({})).score).toBeGreaterThanOrEqual(98);
    expect(scoreCandidate(withAsin, candidate({ durationSec: 5 * 3600 })).score).toBeLessThan(90);
  });
});
