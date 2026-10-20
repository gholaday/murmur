import type { EpisodeCacheStatusDto } from "@murmur/shared";
import { adsStatus } from "../ads";
import type { AppContext } from "../context";
import { getServerSettings } from "../settings";

export function cacheStatus(ctx: AppContext): EpisodeCacheStatusDto {
  return { ...ctx.episodeCache.status(), settings: getServerSettings(ctx.sqlite), ads: adsStatus(ctx.sqlite) };
}
