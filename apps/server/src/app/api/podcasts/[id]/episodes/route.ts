import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, jsonWithEtag, route } from "@/server/http";
import { isSubscribed, listEpisodes, shortNotes } from "@/server/podcasts/queries";

/**
 * A show's episodes, newest first. `?short=1` cuts the notes for list rows (see
 * `descriptionCut`); `?limit=N` returns just the newest N, for a first page.
 */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const id = (await params).id;
  if (!isSubscribed(ctx.sqlite, id, user.id)) throw new HttpError(404, "Podcast not found.");
  const query = new URL(req.url).searchParams;
  const limitParam = query.get("limit");
  const limit = limitParam === null ? -1 : Number(limitParam);
  if (limitParam !== null && !(Number.isInteger(limit) && limit > 0)) throw new HttpError(400, "limit has to be a whole number above 0.");
  const episodes = listEpisodes(ctx.sqlite, id, user.id, limit);
  return jsonWithEtag(req, query.get("short") === "1" ? shortNotes(episodes) : episodes);
});
