import { feedLinkIn } from "@murmur/shared";
import { describe, expect, it } from "vitest";
import { chartIds, dailyOrder, keepFor, sameFeed, toShow } from "./directory";

describe("chartIds", () => {
  it("reads the Apple ids in order, and a single entry", () => {
    const entry = (id: string) => ({ id: { label: "x", attributes: { "im:id": id } } });
    expect(chartIds({ feed: { entry: [entry("12"), entry("7"), { id: {} }] } })).toEqual(["12", "7"]);
    expect(chartIds({ feed: { entry: entry("5") } })).toEqual(["5"]);
    expect(chartIds({ feed: {} })).toEqual([]);
  });
});

describe("toShow", () => {
  it("needs a feed, drops the Podcasts genre and reads explicit", () => {
    expect(toShow({ collectionName: "Apple only" })).toBeNull();
    const s = toShow({ collectionName: "A", feedUrl: "https://a/feed", genreIds: ["1526", "26", "1489"], collectionExplicitness: "explicit" })!;
    expect(s.genreIds).toEqual([1526, 1489]);
    expect(s.explicit).toBe(true);
    expect(toShow({ collectionName: "B", feedUrl: "https://b", contentAdvisoryRating: "Clean" })!.explicit).toBe(false);
  });
});

describe("keepFor", () => {
  const show = (feedUrl: string, explicit = false) => toShow({ collectionName: "S", feedUrl, collectionExplicitness: explicit ? "explicit" : "notExplicit" })!;
  it("drops Not interested, and explicit unless allowed", () => {
    const no = new Set(["https://no"]);
    expect(keepFor(show("https://no"), no, true)).toBe(false);
    expect(keepFor(show("https://x", true), no, false)).toBe(false);
    expect(keepFor(show("https://x", true), no, true)).toBe(true);
    expect(keepFor(show("https://x"), no, false)).toBe(true);
  });
});

describe("dailyOrder", () => {
  it("keeps every item, repeats for a seed and changes with it", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const a = dailyOrder(items, 20_000);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(dailyOrder(items, 20_000)).toEqual(a);
    expect(dailyOrder(items, 20_001)).not.toEqual(a);
  });
});

describe("sameFeed", () => {
  it("matches across http, a last slash and the host's case", () => {
    expect(sameFeed("http://Feeds.example.com/show/", "https://feeds.example.com/show")).toBe(true);
    expect(sameFeed("https://feeds.example.com/show", "https://feeds.example.com/other")).toBe(false);
  });
});

describe("feedLinkIn", () => {
  it("tells a link from a search, and makes it https", () => {
    expect(feedLinkIn(" https://feeds.captivate.fm/ascend/ ")).toBe("https://feeds.captivate.fm/ascend/");
    expect(feedLinkIn("feeds.megaphone.fm/GLT4787413333")).toBe("https://feeds.megaphone.fm/GLT4787413333");
    expect(feedLinkIn("www.example.com/rss")).toBe("https://www.example.com/rss");
    expect(feedLinkIn("feed://x.com/a")).toBe("https://x.com/a");
    for (const s of ["great books", "Mr. Rogers", "99% Invisible", "history.", "AC/DC"]) expect(feedLinkIn(s)).toBeNull();
  });
});
