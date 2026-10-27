import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { getAlbum } from "@/server/music/queries";
import { requirePageUser } from "@/server/session";
import { AlbumView } from "@/web/music/album-view";

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const album = await getAlbum(await getContext(), user.id, (await params).id);
  if (!album) notFound();
  return <AlbumView album={album} isAdmin={user.isAdmin} />;
}
