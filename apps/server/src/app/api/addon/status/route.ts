import { addonStatusSchema } from "@murmur/shared";
import { requireAddon, saveAddonStatus } from "@/server/ads";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";

/** The add-on's heartbeat: whether it's working, paused or stuck, shown to admins in Settings. */
export const POST = route(async (req) => {
  requireAddon(req);
  const ctx = await getContext();
  saveAddonStatus(ctx.sqlite, await readJson(req, addonStatusSchema));
  return json({ ok: true });
});
