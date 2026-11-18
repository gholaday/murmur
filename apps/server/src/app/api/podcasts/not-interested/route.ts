import { subscribeSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { setNotInterested } from "@/server/podcasts/directory";

/** Keeps a directory show out of your Browse suggestions and charts. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const { feedUrl } = await readJson(req, subscribeSchema);
  setNotInterested(ctx.sqlite, user.id, feedUrl, true);
  return json({ ok: true });
});

/** Lets it back. */
export const DELETE = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const { feedUrl } = await readJson(req, subscribeSchema);
  setNotInterested(ctx.sqlite, user.id, feedUrl, false);
  return json({ ok: true });
});
