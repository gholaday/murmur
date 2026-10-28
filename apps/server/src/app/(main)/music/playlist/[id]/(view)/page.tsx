import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { HttpError } from "@/server/http";
import { getPlaylist } from "@/server/music/playlists";
import { requirePageUser } from "@/server/session";
import { PlaylistView } from "@/web/music/playlist-view";

export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  try {
    const playlist = getPlaylist(ctx, user.id, (await params).id);
    return <PlaylistView key={playlist.updatedAt} playlist={playlist} />;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
}
