import { subscribeSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { moreLikeFor } from "@/server/podcasts/directory";

/** GET ?feedUrl= PodcastMoreLike: shows like this one, for its More like tab, followed or not. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const parsed = subscribeSchema.safeParse({ feedUrl: new URL(req.url).searchParams.get("feedUrl") ?? "" });
  if (!parsed.success) throw new HttpError(400, "That isn't a feed URL.");
  return json(await moreLikeFor(ctx, user.id, parsed.data.feedUrl));
});
