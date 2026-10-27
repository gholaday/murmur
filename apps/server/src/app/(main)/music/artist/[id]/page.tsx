import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { getArtist } from "@/server/music/queries";
import { requirePageUser } from "@/server/session";
import { ArtistView } from "@/web/music/album-view";

export default async function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const artist = await getArtist(await getContext(), (await params).id);
  if (!artist) notFound();
  return <ArtistView artist={artist} />;
}
