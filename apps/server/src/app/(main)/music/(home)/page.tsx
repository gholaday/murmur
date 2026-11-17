import { getContext } from "@/server/context";
import { hiddenFor, visibleAlbums, visibleArtists, visibleMusicHome, visibleTracks } from "@/server/hidden";
import { musicHome } from "@/server/music/home";
import { listPlaylists } from "@/server/music/playlists";
import { likedMusic, listAlbums, listArtists, musicSummary } from "@/server/music/queries";
import { requirePageUser } from "@/server/session";
import { MUSIC_TABS } from "@murmur/shared/client";
import { MusicView } from "@/web/music/music-view";

/** Library's Music section: Home's shelves, Liked, playlists, and every album and artist, less what you hid. */
export default async function MusicPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  const tab = (await searchParams).tab;
  const playlists = listPlaylists(ctx, user.id);
  const hidden = hiddenFor(ctx, user.id);
  const liked = await likedMusic(ctx, user.id);
  return (
    <MusicView
      summary={musicSummary(ctx)}
      home={visibleMusicHome(await musicHome(ctx, user.id, playlists), hidden)}
      albums={visibleAlbums(await listAlbums(ctx, user.id, "added"), hidden)}
      artists={visibleArtists(listArtists(ctx), hidden)}
      playlists={playlists}
      liked={{ albums: visibleAlbums(liked.albums, hidden), tracks: visibleTracks(liked.tracks, hidden) }}
      tab={MUSIC_TABS.find((t) => t.id === tab)?.id ?? "home"}
    />
  );
}
