import { episodeAds } from "@/server/ads";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { getEpisodeForUser } from "@/server/podcasts/queries";

/** Ad times for the player's seek bar and auto-skip. Never blocks playback: no ads is a fine answer. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const id = (await params).id;
  if (!getEpisodeForUser(ctx.sqlite, id, user.id)) throw new HttpError(404, "Episode not found.");
  return json(episodeAds(ctx.sqlite, id), { headers: { "Cache-Control": "no-store" } });
});
