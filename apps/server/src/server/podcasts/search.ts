import type { PodcastPreview, PodcastSearchResult } from "@murmur/shared";
import type { Sqlite } from "../db";
import type { PodcastService } from "./service";
import { HttpError } from "../http";
import { createLogger, errorMessage } from "../log";
import { artworkLink } from "./artwork";
import { asResult, followedFeeds, searchDirectory } from "./directory";
import { SHORT_NOTES } from "./queries";

const log = createLogger("podcast-search");

/**
 * Finds podcasts by name in the public directory, each marked with your podcast's id when you
 * already follow it. Explicit shows stay: you searched for them.
 */
export async function searchPodcasts(sqlite: Sqlite, userId: number, term: string): Promise<PodcastSearchResult[]> {
  const found = await searchDirectory(term).catch((err: unknown) => {
    log.warn("search failed", { term, error: errorMessage(err) });
    throw new HttpError(502, "Podcast search isn't available right now. Try again, or paste the feed link.");
  });
  const followed = followedFeeds(sqlite, userId);
  return found.map((s) => asResult(sqlite, followed, s));
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
    artworkUrl: artworkLink(sqlite, feed.imageUrl),
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
