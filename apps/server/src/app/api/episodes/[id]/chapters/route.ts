import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { getEpisodeForUser } from "@/server/podcasts/queries";

/**
 * An episode's chapters, looked up the first time they're asked for (the feed, its chapters
 * file, or the audio's tags). Never blocks playback: no chapters is a fine answer.
 */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const id = (await params).id;
  if (!getEpisodeForUser(ctx.sqlite, id, user.id)) throw new HttpError(404, "Episode not found.");
  return json(await ctx.chapters.get(id));
});
