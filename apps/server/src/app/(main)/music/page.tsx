import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { listAlbums, listArtists, musicSummary } from "@/server/music/queries";
import { requirePageUser } from "@/server/session";
import { MusicView, type MusicTab } from "@/web/music/music-view";

/** Your music: the songs you added, by album, artist or song. Everything else is under Browse. */
export default async function MusicPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  if (ctx.music.folders().length === 0) notFound();
  const tab = (await searchParams).tab;
  return (
    <MusicView
      summary={musicSummary(ctx, user.id)}
      albums={await listAlbums(ctx, user.id, "mine", "added")}
      artists={listArtists(ctx, user.id, "mine")}
      tab={tab === "artists" || tab === "songs" ? tab : ("albums" satisfies MusicTab)}
    />
  );
}
