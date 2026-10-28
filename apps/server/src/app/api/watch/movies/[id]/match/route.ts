import { watchMatchSchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, readJson, route } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Match: puts the picked TMDB title's details and pictures on this movie. */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  if (!ctx.watch.matcher) throw new HttpError(409, "Set TMDB_API_KEY on the server to match movies and shows.");
  const { tmdbId } = await readJson(req, watchMatchSchema);
  await ctx.watch.matcher.matchTo("movie", (await params).id, tmdbId);
  return json({ ok: true });
});
