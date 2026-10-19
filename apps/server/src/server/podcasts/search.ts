import type { PodcastPreview, PodcastSearchResult } from "@murmur/shared";
import type { Sqlite } from "../db";
import type { PodcastService } from "./service";
import { env } from "../env";
import { HttpError } from "../http";
import { createLogger, errorMessage } from "../log";
import { SHORT_NOTES } from "./queries";

const log = createLogger("podcast-search");
const TIMEOUT_MS = 8_000;
const CACHE_MS = 10 * 60_000;
const LIMIT = 25;

/** Directory answers without your subscriptions, so one cached answer serves every user. */
type Found = Omit<PodcastSearchResult, "subscribedId">;
const cache = new Map<string, { at: number; found: Found[] }>();

interface AppleResult {
  collectionName?: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  trackCount?: number;
}

/**
 * Finds podcasts by name with Apple's public podcast search. It needs no API key, so
 * search works on any server; results without an RSS feed (Apple-only shows) are dropped.
 */
async function searchApple(term: string): Promise<Found[]> {
  const key = term.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.found;

  const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=${LIMIT}&term=${encodeURIComponent(term)}`;
  let body: { results?: AppleResult[] };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": `Murmur/${env.version}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    body = (await res.json()) as { results?: AppleResult[] };
  } catch (err) {
    log.warn("search failed", { term, error: errorMessage(err) });
    throw new HttpError(502, "Podcast search isn't available right now. Try again, or paste the feed URL.");
  }

  const found: Found[] = [];
  const seen = new Set<string>();
  for (const r of body.results ?? []) {
    if (!r.feedUrl || !r.collectionName || seen.has(r.feedUrl)) continue;
    seen.add(r.feedUrl);
    found.push({
      title: r.collectionName,
      author: r.artistName ?? null,
      artworkUrl: r.artworkUrl600 ?? r.artworkUrl100 ?? null,
      thumbUrl: r.artworkUrl100 ?? r.artworkUrl600 ?? null,
      feedUrl: r.feedUrl,
      episodeCount: r.trackCount ?? null,
    });
  }
  cache.set(key, { at: Date.now(), found });
  // Keep the cache small; old searches are cheap to repeat.
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return found;
}

function followedFeeds(sqlite: Sqlite, userId: number) {
  return new Map(
    (
      sqlite
        .prepare("SELECT p.id, p.feed_url FROM podcasts p JOIN subscriptions s ON s.podcast_id = p.id AND s.user_id = ?")
        .all(userId) as Array<{ id: string; feed_url: string }>
    ).map((r) => [r.feed_url, r.id]),
  );
}

/** Search results, each marked with your podcast's id when you already follow it. */
export async function searchPodcasts(sqlite: Sqlite, userId: number, term: string): Promise<PodcastSearchResult[]> {
  const found = await searchApple(term);
  const followed = followedFeeds(sqlite, userId);
  return found.map((f) => ({ ...f, subscribedId: followed.get(f.feedUrl) ?? null }));
}

const PREVIEW_EPISODES = 100;

/** A feed read live for a look before subscribing, newest episodes first. */
export async function previewPodcast(
  sqlite: Sqlite,
  podcasts: PodcastService,
  userId: number,
  feedUrl: string,
): Promise<PodcastPreview> {
  const url = feedUrl.trim();
  const subscribedId = followedFeeds(sqlite, userId).get(url) ?? null;
  const feed = await podcasts.preview(url);
  const episodes = [...feed.episodes].sort((a, b) => b.publishedAt - a.publishedAt);
  return {
    feedUrl: url,
    title: feed.title,
    author: feed.author,
    description: feed.description,
    link: feed.link,
    artworkUrl: feed.imageUrl,
    episodeCount: episodes.length,
    latestPublishedAt: episodes[0]?.publishedAt ?? null,
    episodes: episodes.slice(0, PREVIEW_EPISODES).map((e) => ({
      guid: e.guid,
      title: e.title,
      // A preview row shows one line of notes and can't open more; up to 100 full notes
      // made a preview hundreds of KB.
      description: e.description?.slice(0, SHORT_NOTES) ?? null,
      publishedAt: e.publishedAt,
      durationSec: e.durationSec,
    })),
    subscribedId,
  };
}
