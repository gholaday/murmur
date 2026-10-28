import type { WatchMatchResult } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { tmdbThumbUrl } from "@/server/watch/tmdb";

/** Searches TMDB for the Match sheet: `?kind=movie|show&q=&year=`. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const matcher = ctx.watch.matcher;
  if (!matcher) throw new HttpError(409, "Set TMDB_API_KEY on the server to match movies and shows.");
  const params = new URL(req.url).searchParams;
  const kind = params.get("kind");
  if (kind !== "movie" && kind !== "show") throw new HttpError(400, "Say whether it's a movie or a show.");
  const q = params.get("q")?.trim() ?? "";
  if (!q) throw new HttpError(400, "Type a title to search for.");
  const year = /^\d{4}$/.test(params.get("year") ?? "") ? params.get("year") : null;
  const results = await matcher.search(kind, q, year);
  return json(
    results.slice(0, 20).map(
      (r): WatchMatchResult => ({
        tmdbId: r.id,
        title: r.title,
        year: r.year ? String(r.year) : null,
        overview: r.overview,
        posterUrl: tmdbThumbUrl(r.posterPath),
      }),
    ),
  );
});
