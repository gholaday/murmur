import { useCallback, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  ALBUM_SORTS,
  albumsByArtist,
  type AlbumSummary,
  type ArtistSummary,
  type JumpBackItem,
  LIKED_SONGS,
  MUSIC_TABS,
  type MusicTab,
  type PlaylistSummary,
  sortAlbums,
  type TrackDto,
} from "@murmur/shared/client";
import { FilterIcon, MusicIcon } from "@/components/icons";
import { GAP, gridRows, Group, PAD, Shelf, useGridWidth, useShelfWidth } from "@/components/library";
import { AlbumCard, AlbumSortSheet, ArtistCard, openArtist, PlayButton, ShuffleButton, SongRow, SongSheet, useAlbumSort } from "@/components/music";
import { Empty, LibraryTitle, SectionTitle, useTopInset } from "@/components/page";
import { NamePlaylistSheet, NewPlaylistTile, openPlaylist, PlaylistCard } from "@/components/playlists";
import { usePullRefresh } from "@/components/pull-refresh";
import { Bone, CoverGridBones, ListRowBone, SectionBone, Skeleton } from "@/components/skeleton";
import { TextTabs, useTabFade } from "@/components/text-tabs";
import { IconButton, Text } from "@/components/ui";
import { createPlaylist, useAlbums, useArtists, useLikedMusic, useMusicHome, useMusicSummary, usePlaylists } from "@/lib/data";
import { useCanHideAndLike } from "@/lib/hidden";
import { useSectionJumps } from "@/lib/library";
import { useIsAdmin } from "@/lib/session";
import { playMusic } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

type Item =
  | { kind: "albums"; key: string; albums: AlbumSummary[] }
  // Null is the New playlist tile, first in the grid.
  | { kind: "playlists"; key: string; playlists: (PlaylistSummary | null)[] }
  | { kind: "artist"; key: string; artist: ArtistSummary; albums: AlbumSummary[] }
  // Home's and Liked's shelves.
  | { kind: "shelfTitle"; key: string; title: string; count?: number }
  | { kind: "jump"; key: string; items: JumpBackItem[] }
  | { kind: "repeat"; key: string; track: TrackDto }
  | { kind: "albumShelf"; key: string; albums: AlbumSummary[] }
  | { kind: "artistShelf"; key: string; artists: ArtistSummary[] }
  // Liked songs: Play and Shuffle, then the songs.
  | { kind: "likedPlay"; key: string }
  | { kind: "liked"; key: string; track: TrackDto };

const playLiked = (tracks: TrackDto[], index: number, shuffle = false) =>
  playMusic({ ...LIKED_SONGS, tracks }, index, shuffle);

/** How many On repeat songs Home lists. */
const ON_REPEAT_ROWS = 5;

// Defined once: an inline component here would be a new type each render.
const RowGap = () => <View style={{ height: 18 }} />;

/** Library's Music section: Home's shelves, what you liked, your playlists, then every album and artist. */
export function MusicSection() {
  const t = useTheme();
  const top = useTopInset();
  const width = useGridWidth();
  const shelfWidth = useShelfWidth();
  const [picked, setPicked] = useState<MusicTab>("home");
  const [sortOpen, setSortOpen] = useState(false);
  const [song, setSong] = useState<TrackDto | null>(null);
  const [naming, setNaming] = useState(false);
  const sort = useAlbumSort();
  const summary = useMusicSummary();
  const playlists = usePlaylists();
  // No music folder on the server yet: just the title and a note.
  const noFolder = summary.data?.enabled === false;
  const albums = useAlbums();
  const home = useMusicHome();
  // A server from before Home has no Home tab, and one from before likes no Liked tab; the first one left opens.
  const noHome = home.data === null;
  const canLike = useCanHideAndLike();
  const views = MUSIC_TABS.filter((v) => !(noHome && v.id === "home") && !(!canLike && v.id === "liked"));
  const view: MusicTab = views.some((v) => v.id === picked) ? picked : views[0]!.id;
  // A new tab, or a tap on Music in the title row, fades the content in.
  const jumps = useSectionJumps("music");
  const tabFade = useTabFade(`${view}:${jumps}`, jumps > 0);
  // Home lists the first few; a tap queues the whole list from that song.
  const repeatAll = useMemo(() => home.data?.onRepeat ?? [], [home.data]);
  const onRepeat = useMemo(() => repeatAll.slice(0, ON_REPEAT_ROWS), [repeatAll]);
  // Liked and Artists load the first time their tab is picked.
  const [seen, setSeen] = useState<Set<MusicTab>>(() => new Set([view]));
  const liked = useLikedMusic(seen.has("liked"));
  const artists = useArtists(seen.has("artists"));
  const likedSongs = useMemo(() => liked.data?.tracks ?? [], [liked.data]);

  // One function for every row keeps the rows' memo.
  const playRepeat = useCallback(
    (track: TrackDto) => playMusic({ kind: "songs", refId: null, title: "On repeat", tracks: repeatAll }, repeatAll.indexOf(track)),
    [repeatAll],
  );
  const playLikedSong = useCallback((track: TrackDto) => playLiked(likedSongs, likedSongs.indexOf(track)), [likedSongs]);

  const current = view === "home" ? home : view === "liked" ? liked : view === "albums" ? albums : view === "artists" ? artists : playlists;
  const refresh = usePullRefresh(() => Promise.all([summary.refetch(), current.refetch()]));

  const items = useMemo((): Item[] => {
    const out: Item[] = [];
    if (view === "playlists") {
      // New playlist leads the grid.
      const tiles = playlists.data ? [null, ...playlists.data] : [];
      for (const row of gridRows(tiles)) out.push({ kind: "playlists", key: row[0]?.id ?? "new", playlists: row });
      return out;
    }
    if (view === "home") {
      // Each shelf is left out when it has nothing.
      const h = home.data;
      if (!h) return out;
      // A field the server didn't send reads as an empty shelf.
      const jumpBackIn = h.jumpBackIn ?? [];
      const newAlbums = h.newAlbums ?? [];
      if (jumpBackIn.length) out.push({ kind: "shelfTitle", key: "t:jump", title: "Jump back in" }, { kind: "jump", key: "jump", items: jumpBackIn });
      if (onRepeat.length) {
        out.push({ kind: "shelfTitle", key: "t:repeat", title: "On repeat" });
        for (const s of onRepeat) out.push({ kind: "repeat", key: `repeat:${s.id}`, track: s });
      }
      if (h.moreLikeAlbum?.items.length) {
        out.push({ kind: "shelfTitle", key: "t:likeAlbum", title: h.moreLikeAlbum.title }, { kind: "albumShelf", key: "likeAlbum", albums: h.moreLikeAlbum.items });
      }
      if (h.moreLikeArtist?.items.length) {
        out.push({ kind: "shelfTitle", key: "t:likeArtist", title: h.moreLikeArtist.title }, { kind: "artistShelf", key: "likeArtist", artists: h.moreLikeArtist.items });
      }
      if (newAlbums.length) {
        out.push({ kind: "shelfTitle", key: "t:new", title: "New albums", count: newAlbums.length }, { kind: "albumShelf", key: "new", albums: newAlbums });
      }
      return out;
    }
    if (view === "liked") {
      const l = liked.data;
      if (!l) return out;
      if (l.albums.length) {
        out.push({ kind: "shelfTitle", key: "t:likedAlbums", title: "Albums", count: l.albums.length }, { kind: "albumShelf", key: "likedAlbums", albums: l.albums });
      }
      if (l.tracks.length) {
        out.push({ kind: "shelfTitle", key: "t:likedSongs", title: "Songs", count: l.tracks.length }, { kind: "likedPlay", key: "likedPlay" });
        for (const s of l.tracks) out.push({ kind: "liked", key: `liked:${s.id}`, track: s });
      }
      return out;
    }
    if (view === "albums") {
      for (const row of gridRows(sortAlbums(albums.data ?? [], sort))) out.push({ kind: "albums", key: row[0]!.id, albums: row });
    } else {
      // Each artist's albums come from the album list already loaded.
      const byArtist = albumsByArtist(albums.data ?? []);
      for (const a of artists.data ?? []) out.push({ kind: "artist", key: a.id, artist: a, albums: byArtist.get(a.id) ?? [] });
    }
    return out;
  }, [view, albums.data, artists.data, liked.data, playlists.data, home.data, onRepeat, sort]);

  const pick = (next: MusicTab) => {
    setPicked(next);
    setSeen((s) => (s.has(next) ? s : new Set(s).add(next)));
  };

  // The title row and tabs stay put above the list.
  const header = (
    <View style={{ paddingTop: top, paddingHorizontal: PAD }}>
      <LibraryTitle
        current="music"
        right={
          // Only albums have a sort; artists are A to Z.
          !noFolder && view === "albums" ? (
            <IconButton label={`Sort albums, ${ALBUM_SORTS.find((s) => s.id === sort)?.label}`} onPress={() => setSortOpen(true)}>
              <FilterIcon color={t.text} />
            </IconButton>
          ) : null
        }
      />
      {noFolder ? null : <TextTabs options={views} value={view} onPick={pick} />}
    </View>
  );

  const empty = noFolder ? (
    <NoMusic />
  ) : current.isPending ? (
    <Skeleton>
      {view === "home" || view === "liked" ? (
        <View style={{ marginTop: -28 }}>
          <SectionBone />
          <View style={{ flexDirection: "row", columnGap: GAP }}>
            {[0, 1, 2].map((i) => (
              <Bone key={i} width={shelfWidth} height={shelfWidth} radius={10} />
            ))}
          </View>
          <SectionBone />
          {[0, 1, 2].map((i) => (
            <ListRowBone key={i} thumb={44} />
          ))}
        </View>
      ) : view === "albums" || view === "playlists" ? (
        <CoverGridBones count={6} />
      ) : (
        [0, 1].map((i) => (
          <View key={i}>
            <SectionBone />
            <CoverGridBones count={3} />
          </View>
        ))
      )}
    </Skeleton>
  ) : current.isError ? (
    <Empty title="Couldn't load your music">{current.error.message}</Empty>
  ) : view === "playlists" ? (
    <Empty>Make a playlist, then add songs to it from the menu on any song.</Empty>
  ) : view === "home" ? (
    <Empty>Play something and it shows up here.</Empty>
  ) : view === "liked" ? (
    <Empty title="No likes yet">Tap the heart on any song or album to find it here.</Empty>
  ) : (
    <Empty>Nothing here yet.</Empty>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {header}
      <FlatList
        data={noFolder ? [] : items}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: 18, paddingBottom: 24, flexGrow: 1 }}
        refreshControl={refresh}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Animated.View style={tabFade}>{empty}</Animated.View>}
        // With no playlists, the grid is just the New playlist tile, with the note under it.
        ListFooterComponent={
          view === "playlists" && playlists.data?.length === 0 ? <Empty>Make a playlist, then add songs to it from the menu on any song.</Empty> : undefined
        }
        ItemSeparatorComponent={view === "albums" || view === "playlists" ? RowGap : undefined}
        windowSize={7}
        maxToRenderPerBatch={8}
        renderItem={({ item, index }) => (
          <Animated.View style={tabFade}>
            {item.kind === "albums" ? (
              <View style={{ flexDirection: "row", columnGap: GAP }}>
                {item.albums.map((a) => (
                  <AlbumCard key={a.id} album={a} width={width} />
                ))}
              </View>
            ) : item.kind === "playlists" ? (
              <View style={{ flexDirection: "row", columnGap: GAP }}>
                {item.playlists.map((p) =>
                  p ? <PlaylistCard key={p.id} playlist={p} width={width} /> : <NewPlaylistTile key="new" width={width} onPress={() => setNaming(true)} />,
                )}
              </View>
            ) : item.kind === "artist" ? (
              // Like the Books section's authors: the name opens the artist, then a row of their albums.
              <Group title={item.artist.name} count={item.artist.albumCount} onOpen={() => openArtist(item.artist.id)}>
                {item.albums.map((a) => (
                  <AlbumCard key={a.id} album={a} width={shelfWidth} sub={a.year} />
                ))}
              </Group>
            ) : item.kind === "shelfTitle" ? (
              <View style={{ marginTop: index === 0 ? -12 : 0 }}>
                <SectionTitle title={item.title} count={item.count} />
              </View>
            ) : item.kind === "jump" ? (
              <Shelf>
                {item.items.map((i) =>
                  i.kind === "album" ? (
                    <AlbumCard key={`a-${i.album.id}`} album={i.album} width={shelfWidth} />
                  ) : (
                    <PlaylistCard key={`p-${i.playlist.id}`} playlist={i.playlist} width={shelfWidth} />
                  ),
                )}
              </Shelf>
            ) : item.kind === "albumShelf" ? (
              <Shelf>
                {item.albums.map((a) => (
                  <AlbumCard key={a.id} album={a} width={shelfWidth} />
                ))}
              </Shelf>
            ) : item.kind === "artistShelf" ? (
              <Shelf>
                {item.artists.map((a) => (
                  <ArtistCard key={a.id} artist={a} width={shelfWidth} />
                ))}
              </Shelf>
            ) : item.kind === "likedPlay" ? (
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 6 }}>
                <PlayButton from={LIKED_SONGS} onPress={() => playLiked(likedSongs, -1)} />
                <ShuffleButton from={LIKED_SONGS} onPlay={() => playLiked(likedSongs, -1, true)} />
              </View>
            ) : item.kind === "liked" ? (
              <SongRow track={item.track} onPlay={playLikedSong} onMore={setSong} />
            ) : (
              <SongRow track={item.track} onPlay={playRepeat} onMore={setSong} />
            )}
          </Animated.View>
        )}
      />
      <AlbumSortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
      <SongSheet track={song} onClose={() => setSong(null)} />
      <NamePlaylistSheet
        open={naming}
        onClose={() => setNaming(false)}
        title="New playlist"
        action="Make playlist"
        busyLabel="Making…"
        onSubmit={async (name) => openPlaylist((await createPlaylist(name)).id)}
      />
    </View>
  );
}

/** No music folder on the server yet: the music icon, a title and a line, centred. */
function NoMusic() {
  const t = useTheme();
  const admin = useIsAdmin();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 12, paddingVertical: 40 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: t.surface }}>
        <MusicIcon size={34} color={t.accent} />
      </View>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 20, color: t.text, textAlign: "center" }}>No music yet</Text>
      <Text variant="body" style={{ textAlign: "center", maxWidth: 290, color: t.muted }}>
        {admin ? "Mount your music at /music, and your albums show up here." : "Albums show up here once they're added."}
      </Text>
    </View>
  );
}
