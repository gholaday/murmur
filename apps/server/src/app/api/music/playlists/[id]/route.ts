import { playlistUpdateSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { deletePlaylist, getPlaylist, updatePlaylist } from "@/server/music/playlists";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return json(getPlaylist(ctx, user.id, (await params).id));
});

/** Rename, or send the songs in their new order (reorder and remove are both this). */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return json(updatePlaylist(ctx, user.id, (await params).id, await readJson(req, playlistUpdateSchema)));
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  deletePlaylist(ctx, user.id, (await params).id);
  return json({ ok: true });
});
