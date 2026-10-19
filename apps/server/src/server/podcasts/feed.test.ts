import { expect, it } from "vitest";
import { parseDuration, parseFeed, parseOpml } from "./feed";

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
    },
  ]);
});

it("finds feeds nested in OPML folders", () => {
  const feeds = parseOpml(`<opml version="2.0"><body>
    <outline text="Folder"><outline text="A" xmlUrl="https://a.example/feed"/></outline>
    <outline text="B" xmlUrl="https://b.example/feed"/>
  </body></opml>`);
  expect(feeds.map((f) => f.feedUrl)).toEqual(["https://a.example/feed", "https://b.example/feed"]);
});
