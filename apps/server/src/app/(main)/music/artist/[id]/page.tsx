import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { getArtist } from "@/server/music/queries";
import { requirePageUser } from "@/server/session";
import { ArtistView } from "@/web/music/album-view";

export default async function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const artist = await getArtist(await getContext(), user.id, (await params).id);
  if (!artist) notFound();
  return <ArtistView artist={artist} isAdmin={user.isAdmin} />;
}
