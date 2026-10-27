import { playNextOrderSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { orderPlayNext } from "@/server/play-next";

/** Sets the order of your Play next shelf. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  orderPlayNext(ctx, user.id, (await readJson(req, playNextOrderSchema)).bookIds);
  return json({ ok: true });
});
