import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, jsonWithEtag, route } from "@/server/http";
import { isSubscribed, listEpisodes, shortNotes } from "@/server/podcasts/queries";

/** A show's episodes, newest first. `?short=1` cuts the notes for list rows (see `descriptionCut`). */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const id = (await params).id;
  if (!isSubscribed(ctx.sqlite, id, user.id)) throw new HttpError(404, "Podcast not found.");
  const episodes = listEpisodes(ctx.sqlite, id, user.id);
  return jsonWithEtag(req, new URL(req.url).searchParams.get("short") === "1" ? shortNotes(episodes) : episodes);
});
