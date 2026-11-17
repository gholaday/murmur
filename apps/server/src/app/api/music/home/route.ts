import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { hiddenFor, visibleMusicHome } from "@/server/hidden";
import { json, route } from "@/server/http";
import { musicHome } from "@/server/music/home";

/** The Home tab's shelves: Jump back in, On repeat, More like and New albums, leaving out what you hid. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return json(visibleMusicHome(await musicHome(ctx, user.id), hiddenFor(ctx, user.id)));
});
