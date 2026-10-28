import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { neighborEpisode } from "@/server/podcasts/queries";

/** The episode below this one in its show's list (`?dir=1`, older) or above it (`?dir=-1`, newer), for previous and next. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const dir = new URL(req.url).searchParams.get("dir");
  if (dir !== "1" && dir !== "-1") throw new HttpError(400, "dir has to be 1 or -1.");
  return json({ id: neighborEpisode(ctx.sqlite, (await params).id, user.id, dir === "1" ? 1 : -1) });
});
