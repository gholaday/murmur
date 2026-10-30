import { expect, it } from "vitest";
import { audioMimeType, parseDuration, parseFeed, parseOpml } from "./feed";

it("parses itunes:duration in every format feeds use", () => {
  expect(parseDuration("1:02:03")).toBe(3723);
  expect(parseDuration("62:03")).toBe(3723);
  expect(parseDuration("3723")).toBe(3723);
  expect(parseDuration("abc")).toBeNull();
});

it("reads channel and episode fields, skipping items without audio", () => {
  const feed = parseFeed(`<?xml version="1.0"?>
    <rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel>
        <title>Show &amp; Tell</title>
        <itunes:author>Host</itunes:author>
        <itunes:image href="https://example.com/show.jpg"/>
        <item>
          <title>Episode 1</title>
          <guid isPermaLink="false">abc-1</guid>
          <pubDate>Mon, 12 Oct 2026 23:05:00 +0000</pubDate>
          <itunes:duration>45:00</itunes:duration>
          <content:encoded><![CDATA[<p>Hello <b>world</b></p>]]></content:encoded>
          <enclosure url="https://example.com/1.mp3" length="1234" type="audio/mpeg"/>
        </item>
        <item><title>Blog post, no enclosure</title></item>
      </channel>
    </rss>`);
  expect(feed).toMatchObject({ title: "Show & Tell", author: "Host", imageUrl: "https://example.com/show.jpg" });
  expect(feed.episodes).toEqual([
    {
      guid: "abc-1",
      title: "Episode 1",
      description: "Hello world",
      publishedAt: Date.parse("2026-10-12T23:05:00Z"),
      durationSec: 2700,
      audioUrl: "https://example.com/1.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: 1234,
      imageUrl: null,
      season: null,
      episodeNumber: null,
      chaptersUrl: null,
      chapters: null,
    },
  ]);
});

it("reads an episode's chapters file address and its Podlove chapters", () => {
  const feed = parseFeed(`<?xml version="1.0"?>
    <rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:psc="http://podlove.org/simple-chapters">
      <channel><title>Show</title>
        <item>
          <title>One</title>
          <enclosure url="https://example.com/1.mp3" type="audio/mpeg"/>
          <podcast:chapters url="https://example.com/1.json" type="application/json+chapters"/>
          <psc:chapters version="1.2">
            <psc:chapter start="00:00:00" title="Intro"/>
            <psc:chapter start="00:10:00" title="Main"/>
          </psc:chapters>
        </item>
        <item>
          <title>Two</title>
          <enclosure url="https://example.com/2.mp3" type="audio/mpeg"/>
          <podcast:chapters url="https://example.com/2.html" type="text/html"/>
          <psc:chapters><psc:chapter start="0" title="Just one"/></psc:chapters>
        </item>
      </channel>
    </rss>`);
  expect(feed.episodes[0]).toMatchObject({
    chaptersUrl: "https://example.com/1.json",
    chapters: JSON.stringify([
      { startSec: 0, title: "Intro" },
      { startSec: 600, title: "Main" },
    ]),
  });
  expect(feed.episodes[1]).toMatchObject({ chaptersUrl: null, chapters: null });
});

it("finds feeds nested in OPML folders", () => {
  const feeds = parseOpml(`<opml version="2.0"><body>
    <outline text="Folder"><outline text="A" xmlUrl="https://a.example/feed"/></outline>
    <outline text="B" xmlUrl="https://b.example/feed"/>
  </body></opml>`);
  expect(feeds.map((f) => f.feedUrl)).toEqual(["https://a.example/feed", "https://b.example/feed"]);
});

it("keeps only audio types from an enclosure, so a feed can't choose how its file is served", () => {
  expect(audioMimeType("audio/mpeg")).toBe("audio/mpeg");
  expect(audioMimeType("Audio/MP4; codecs=mp4a")).toBe("audio/mp4");
  expect(audioMimeType("text/html")).toBeNull();
  expect(audioMimeType(null)).toBeNull();
});

it("drops enclosure and image addresses that aren't http(s)", () => {
  const feed = parseFeed(`<rss><channel><title>T</title>
    <item><title>a</title><enclosure url="javascript:alert(1)" type="audio/mpeg"/></item>
    <item><title>b</title><enclosure url="https://x.test/b.mp3" type="text/html"/><itunes:image href="data:image/png;base64,AA"/></item>
  </channel></rss>`);
  expect(feed.episodes).toHaveLength(1);
  expect(feed.episodes[0]).toMatchObject({ audioUrl: "https://x.test/b.mp3", mimeType: null, imageUrl: null });
});

it("refuses a feed whose own entities are big enough to balloon", () => {
  const big = "A".repeat(5000);
  const xml = `<!DOCTYPE rss [<!ENTITY e "${big}">]><rss><channel><title>&e;&e;</title></channel></rss>`;
  expect(() => parseFeed(xml)).toThrow();
  const small = `<!DOCTYPE rss [<!ENTITY e "ok">]><rss><channel><title>&e;</title></channel></rss>`;
  expect(parseFeed(small).title).toBe("ok");
});

it("counts only a feed's own entities against the limit, not ordinary ones", () => {
  const items = Array.from({ length: 600 }, (_, i) => `<item><title>Q&amp;A ${i} &#8217;</title><enclosure url="https://x.test/${i}.mp3"/></item>`);
  expect(parseFeed(`<rss><channel><title>T</title>${items.join("")}</channel></rss>`).episodes).toHaveLength(600);
  const many = `<!DOCTYPE rss [<!ENTITY e "ok">]><rss><channel><title>${"&e;".repeat(1001)}</title></channel></rss>`;
  expect(() => parseFeed(many)).toThrow();
});
