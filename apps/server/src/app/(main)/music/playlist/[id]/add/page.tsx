import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { HttpError } from "@/server/http";
import { getPlaylist } from "@/server/music/playlists";
import { requirePageUser } from "@/server/session";
import { AddSongsView } from "@/web/music/add-songs";

export default async function AddSongsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  try {
    return <AddSongsView playlist={getPlaylist(ctx, user.id, (await params).id)} />;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
}
