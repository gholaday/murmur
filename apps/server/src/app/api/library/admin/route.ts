import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { libraryAdmin } from "@/server/library-admin";

/** You > Library: each kind's counts, scan and what needs a look. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireAdmin(ctx, req);
  return json(await libraryAdmin(ctx, user.id));
});
