import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { chartFor } from "@/server/podcasts/directory";

/** GET ?genre= the top 50 shows in one category, or overall without it. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const genre = new URL(req.url).searchParams.get("genre");
  return json(await chartFor(ctx, user.id, genre ? Number(genre) : null));
});
