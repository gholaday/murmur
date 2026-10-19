import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { episodesByIds } from "@/server/podcasts/queries";

/** One episode with its show's details, for resuming playback outside the show page. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const [episode] = await episodesByIds(ctx.sqlite, [(await params).id], user.id);
  if (!episode) throw new HttpError(404, "Episode not found.");
  return json(episode);
});
