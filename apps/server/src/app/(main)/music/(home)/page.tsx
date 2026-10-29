import { getContext } from "@/server/context";
import { listPlaylists } from "@/server/music/playlists";
import { listAlbums, listArtists, musicSummary } from "@/server/music/queries";
import { requirePageUser } from "@/server/session";
import { MusicView, type MusicTab } from "@/web/music/music-view";

const TABS: MusicTab[] = ["albums", "artists", "songs", "playlists"];

/** Your music: the songs you added, by album, artist or song, and your playlists. Everything else is under Browse. */
export default async function MusicPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  const tab = (await searchParams).tab;
  return (
    <MusicView
      summary={musicSummary(ctx, user.id)}
      albums={await listAlbums(ctx, user.id, "mine", "added")}
      artists={listArtists(ctx, user.id, "mine")}
      playlists={listPlaylists(ctx, user.id)}
      tab={TABS.find((t) => t === tab) ?? "albums"}
      isAdmin={user.isAdmin}
    />
  );
}
