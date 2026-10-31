import { expect, it } from "vitest";
import { isPrivateFeed } from "./private-feed";

it("knows a private feed by a key in its URL, its host, or itunes:block", () => {
  expect(isPrivateFeed("https://www.patreon.com/rss/somecreator?auth=abc123")).toBe(true);
  expect(isPrivateFeed("https://feeds.example.com/show.xml?token=abc")).toBe(true);
  expect(isPrivateFeed("https://me:secret@feeds.example.com/show.xml")).toBe(true);
  expect(isPrivateFeed("https://shows.supportingcast.fm/feeds/abc")).toBe(true);
  expect(isPrivateFeed("https://api.substack.com/feed/podcast/123/private/abc.rss")).toBe(true);
  expect(isPrivateFeed("https://feeds.example.com/show.xml", true)).toBe(true);

  expect(isPrivateFeed("https://feeds.simplecast.com/abc123")).toBe(false);
  expect(isPrivateFeed("https://feeds.example.com/show.xml?format=mp3")).toBe(false);
  expect(isPrivateFeed("not a url")).toBe(false);
});
