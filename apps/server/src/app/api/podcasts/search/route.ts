import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { searchPodcasts } from "@/server/podcasts/search";

/** GET ?q= finds podcasts by name in the public directory, for the Add podcast sheet. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) throw new HttpError(400, "Type at least two letters.");
  if (q.length > 200) throw new HttpError(400, "That search is too long.");
  return json(await searchPodcasts(ctx.sqlite, user.id, q));
});
