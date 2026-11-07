import { getContext } from "@/server/context";
import { musicHome } from "@/server/music/home";
import { listPlaylists } from "@/server/music/playlists";
import { listAlbums, listArtists, musicSummary } from "@/server/music/queries";
import { requirePageUser } from "@/server/session";
import { MUSIC_TABS } from "@murmur/shared/client";
import { MusicView } from "@/web/music/music-view";

/** Your music: Home's shelves, the songs you added by album, artist or song, and your playlists. Everything else is under Browse. */
export default async function MusicPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  const tab = (await searchParams).tab;
  const playlists = listPlaylists(ctx, user.id);
  return (
    <MusicView
      summary={musicSummary(ctx, user.id)}
      home={await musicHome(ctx, user.id, playlists)}
      albums={await listAlbums(ctx, user.id, "mine", "added")}
      artists={listArtists(ctx, user.id, "mine")}
      playlists={playlists}
      tab={MUSIC_TABS.find((t) => t.id === tab)?.id ?? "home"}
    />
  );
}
