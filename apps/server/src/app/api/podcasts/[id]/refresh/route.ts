import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { getPodcast, isSubscribed } from "@/server/podcasts/queries";

/** Checks the feed now and returns the updated podcast. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const id = (await params).id;
  if (!isSubscribed(ctx.sqlite, id, user.id)) throw new HttpError(404, "Podcast not found.");
  await ctx.podcasts.refresh(id);
  return json(await getPodcast(ctx.sqlite, id, user.id));
});
