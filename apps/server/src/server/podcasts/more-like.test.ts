import { describe, expect, it } from "vitest";
import type { DirectoryShow } from "./directory";
import { rankLike, subjectTerms, titleSubject } from "./more-like";

describe("titleSubject", () => {
  it("takes the longest part without the filler", () => {
    expect(titleSubject("Ascend - The Great Books Podcast")).toBe("great books");
    expect(titleSubject("Locked On Gators - Daily Podcast On Florida Gators Athletics")).toBe("florida gators athletics");
  });
  it("is null when that's just the title", () => {
    expect(titleSubject("Gators Breakdown")).toBeNull();
    expect(titleSubject("The Podcast")).toBeNull();
  });
});

describe("subjectTerms", () => {
  it("finds what the episodes keep coming back to, phrases first", () => {
    const terms = subjectTerms({
      title: "Gators Breakdown",
      description: null,
      episodeTitles: ["Gators beat Ole Miss", "Ole Miss preview: Gators offense", "Recruiting update", "Gators recruiting news"],
    });
    expect(terms).toEqual(["gators", "ole miss", "recruiting"]);
  });
  it("leaves out the title and its subject, and terms seen once", () => {
    const terms = subjectTerms({
      title: "Ascend - The Great Books Podcast",
      description: "Reading the great books together.",
      episodeTitles: ["Great Books: Homer's Odyssey", "The Odyssey, part 2", "Plato once"],
    });
    expect(terms).toEqual(["odyssey"]);
  });
});

const show = (feedUrl: string, genreIds: number[]): DirectoryShow => ({
  title: feedUrl,
  author: null,
  artworkUrl: null,
  thumbUrl: null,
  feedUrl,
  episodeCount: null,
  genreIds,
  explicit: false,
});

describe("rankLike", () => {
  const source = { feedUrl: "https://me/feed", genreIds: [1487, 1304] };
  const titles = (shows: DirectoryShow[]) => shows.map((s) => s.feedUrl);

  it("ranks shows several searches agree on, in the same category, first", () => {
    const a = show("https://a", [1487]);
    const b = show("https://b", [1487]);
    const ranked = rankLike(
      source,
      [
        { weight: 1, shows: [b, a] },
        { weight: 0.7, shows: [a] },
      ],
      [],
    );
    expect(titles(ranked)).toEqual(["https://a", "https://b"]);
  });

  it("leaves out the source, and needs searches to agree outside the category", () => {
    const self = show("http://me/feed/", [1487]);
    const shared = show("https://shared", [1304]);
    const other = show("https://other", [1303]);
    const once = rankLike(source, [{ weight: 1, shows: [self, shared, other] }], []);
    expect(titles(once)).toEqual([]);
    const twice = rankLike(
      source,
      [
        { weight: 1, shows: [shared, other] },
        { weight: 1, shows: [shared, other] },
      ],
      [],
    );
    expect(titles(twice)).toEqual(["https://shared"]);
  });

  it("tops up from the chart, below what the searches found", () => {
    const found = show("https://found", [1487]);
    const charted = show("https://charted", [1487]);
    expect(titles(rankLike(source, [{ weight: 0.7, shows: [found] }], [charted]))).toEqual(["https://found", "https://charted"]);
  });
});
