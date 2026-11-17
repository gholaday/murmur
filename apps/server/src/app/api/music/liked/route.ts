import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { hiddenFor, visibleAlbums, visibleTracks } from "@/server/hidden";
import { json, route } from "@/server/http";
import { likedMusic } from "@/server/music/queries";

/** LikedMusicDto: liked albums, then liked songs, newest first, leaving out ones you hid. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const liked = await likedMusic(ctx, user.id);
  const hidden = hiddenFor(ctx, user.id);
  return json({ albums: visibleAlbums(liked.albums, hidden), tracks: visibleTracks(liked.tracks, hidden) });
});
