import { podcastSettingsSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, jsonWithEtag, readJson, route } from "@/server/http";
import { getPodcast, isSubscribed } from "@/server/podcasts/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const podcast = await getPodcast(ctx.sqlite, (await params).id, user.id);
  if (!podcast) throw new HttpError(404, "Podcast not found.");
  return jsonWithEtag(req, podcast);
});

/**
 * Speed is per listener. Auto-download applies to the show for everyone, since the
 * downloaded files are shared, so only an admin can change it.
 */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const id = (await params).id;
  if (!isSubscribed(ctx.sqlite, id, user.id)) throw new HttpError(404, "Podcast not found.");
  const { speed, ...shared } = await readJson(req, podcastSettingsSchema);
  if (shared.autoDownload !== undefined || shared.keepLatest !== undefined) {
    if (!user.isAdmin) throw new HttpError(403, "Only an admin can change auto-download.");
    ctx.podcasts.updateSettings(id, shared);
  }
  if (speed !== undefined) {
    ctx.sqlite.prepare("UPDATE subscriptions SET speed = ? WHERE user_id = ? AND podcast_id = ?").run(speed, user.id, id);
  }
  return json(await getPodcast(ctx.sqlite, id, user.id));
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  ctx.podcasts.unsubscribe(user.id, (await params).id);
  return json({ ok: true });
});
