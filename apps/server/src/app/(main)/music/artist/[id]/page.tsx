import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { hiddenFor, visibleArtist } from "@/server/hidden";
import { getArtist } from "@/server/music/queries";
import { requirePageUser } from "@/server/session";
import { ArtistView } from "@/web/music/album-view";

export default async function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  const artist = await getArtist(ctx, user.id, (await params).id);
  if (!artist) notFound();
  return <ArtistView artist={visibleArtist(artist, hiddenFor(ctx, user.id))} />;
}
