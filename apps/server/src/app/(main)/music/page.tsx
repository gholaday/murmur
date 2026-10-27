import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { listAlbums, listArtists } from "@/server/music/queries";
import { requirePageUser } from "@/server/session";
import { MusicView, type MusicTab } from "@/web/music/music-view";

export default async function MusicPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePageUser();
  const ctx = await getContext();
  if (ctx.music.folders().length === 0) notFound();
  const tab = (await searchParams).tab;
  return (
    <MusicView
      albums={await listAlbums(ctx, "added")}
      artists={listArtists(ctx)}
      tab={tab === "artists" || tab === "songs" ? tab : ("albums" satisfies MusicTab)}
    />
  );
}
