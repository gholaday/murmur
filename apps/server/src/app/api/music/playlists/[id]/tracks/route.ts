import { playlistAddSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { addToPlaylist } from "@/server/music/playlists";

/** Adds songs to the end of the playlist. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const { trackIds } = await readJson(req, playlistAddSchema);
  return json(addToPlaylist(ctx, user.id, (await params).id, trackIds));
});
