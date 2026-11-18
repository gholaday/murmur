import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { browseFor } from "@/server/podcasts/directory";

/** PodcastBrowse: More like shelves for shows you follow, then the top shows. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return json(await browseFor(ctx, user.id));
});
