import { subscribeSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, jsonWithEtag, readJson, route } from "@/server/http";
import { getPodcast, listPodcasts } from "@/server/podcasts/queries";

export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, await listPodcasts(ctx.sqlite, user.id));
});

/** Subscribe by RSS URL. The feed is fetched and validated before anything is saved. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const { feedUrl } = await readJson(req, subscribeSchema);
  const { podcastId, created } = await ctx.podcasts.subscribe(user.id, feedUrl);
  return json(await getPodcast(ctx.sqlite, podcastId, user.id), { status: created ? 201 : 200 });
});
