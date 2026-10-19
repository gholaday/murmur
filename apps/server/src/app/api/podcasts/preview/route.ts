import { subscribeSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { previewPodcast } from "@/server/podcasts/search";

/** GET ?feedUrl= reads a feed without subscribing, for a look at a search result first. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const parsed = subscribeSchema.safeParse({ feedUrl: new URL(req.url).searchParams.get("feedUrl") ?? "" });
  if (!parsed.success) throw new HttpError(400, "That isn't a feed URL.");
  return json(await previewPodcast(ctx.sqlite, ctx.podcasts, user.id, parsed.data.feedUrl));
});
