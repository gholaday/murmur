import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { musicHome } from "@/server/music/home";

/** The Home chip's shelves: Jump back in, On repeat and New albums. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return json(await musicHome(ctx, user.id));
});
