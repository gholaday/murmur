import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, jsonWithEtag, route } from "@/server/http";
import { isSubscribed, listEpisodes } from "@/server/podcasts/queries";

export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const id = (await params).id;
  if (!isSubscribed(ctx.sqlite, id, user.id)) throw new HttpError(404, "Podcast not found.");
  return jsonWithEtag(req, listEpisodes(ctx.sqlite, id, user.id));
});
