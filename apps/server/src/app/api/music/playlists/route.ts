import { playlistCreateSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { createPlaylist, listPlaylists } from "@/server/music/playlists";

/** Your playlists, the most recently changed first. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return json(listPlaylists(ctx, user.id));
});

/** A new playlist, optionally with songs in it already. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const { name, trackIds } = await readJson(req, playlistCreateSchema);
  return json(createPlaylist(ctx, user.id, name, trackIds));
});
