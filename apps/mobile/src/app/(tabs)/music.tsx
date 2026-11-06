import { useCallback, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { router } from "expo-router";
import {
  albumInMusic,
  albumInMusicLabel,
  ALBUM_SORTS,
  albumsByArtist,
  type AlbumSummary,
  type ArtistSummary,
  type JumpBackItem,
  plural,
  type PlaylistSummary,
  sortAlbums,
  type TrackDto,
} from "@murmur/shared/client";
import { BrowseIcon, FilterIcon, MusicIcon } from "@/components/icons";
import { GAP, gridRows, Group, PAD, Shelf, useGridWidth, useShelfWidth } from "@/components/library";
import { AlbumCard, AlbumSortSheet, ArtistCard, openArtist, PlayButton, ShuffleButton, SongRow, SongSheet, useAlbumSort } from "@/components/music";
import { Empty, PageTitle, SectionTitle, useTopInset } from "@/components/page";
import { NamePlaylistSheet, NewPlaylistTile, openPlaylist, PlaylistCard } from "@/components/playlists";
import { usePullRefresh } from "@/components/pull-refresh";
import { Bone, CoverGridBones, ListRowBone, SectionBone, Skeleton } from "@/components/skeleton";
import Animated from "react-native-reanimated";
import { TextTabs, useTabFade } from "@/components/text-tabs";
import { Button, CardLink, IconButton, Text } from "@/components/ui";
import { createPlaylist, setInMusic, useAlbums, useArtists, useMusicHome, useMusicSummary, usePlaylists, useTracks } from "@/lib/data";
import { useSession } from "@/lib/session";
import { playMusic } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

type View_ = "home" | "albums" | "artists" | "songs" | "playlists";

const VIEWS: { id: View_; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "playlists", label: "Playlists" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
  { id: "songs", label: "Songs" },
];

type Item =
  | { kind: "albums"; key: string; albums: AlbumSummary[] }
  // Null is the New playlist tile, first in the grid.
  | { kind: "playlists"; key: string; playlists: (PlaylistSummary | null)[] }
  | { kind: "artist"; key: string; artist: ArtistSummary; albums: AlbumSummary[] }
  | { kind: "song"; key: string; track: TrackDto }
  // Home's shelves.
  | { kind: "shelfTitle"; key: string; title: string }
  | { kind: "jump"; key: string; items: JumpBackItem[] }
  | { kind: "repeat"; key: string; track: TrackDto }
  | { kind: "albumShelf"; key: string; albums: AlbumSummary[] }
  | { kind: "artistShelf"; key: string; artists: ArtistSummary[] };

const playSongs = (tracks: TrackDto[], index: number, shuffle = false) =>
  playMusic({ kind: "songs", refId: null, title: "Your songs", tracks }, index, shuffle);

/** How many On repeat songs Home lists. */
const ON_REPEAT_ROWS = 5;

// Defined once: an inline component here would be a new type each render.
const RowGap = () => <View style={{ height: 18 }} />;

/** Your music: the albums, artists and songs you've added. Everything else is under Browse. */
export default function Music() {
  const t = useTheme();
  const top = useTopInset();
  const width = useGridWidth();
  const shelfWidth = useShelfWidth();
  const [picked, setPicked] = useState<View_>("home");
  const [sortOpen, setSortOpen] = useState(false);
  const [song, setSong] = useState<TrackDto | null>(null);
  const [naming, setNaming] = useState(false);
  const sort = useAlbumSort();
  const summary = useMusicSummary();
  const playlists = usePlaylists();
  const mine = summary.data?.mine;
  // No music folder on the server yet: just the title and a note.
  const noFolder = summary.data?.enabled === false;
  // The first-visit screen is for someone with no songs and no playlists either.
  const nothingYet = noFolder || (mine?.tracks === 0 && !playlists.data?.length);
  const albums = useAlbums("mine");
  const home = useMusicHome();
  // A server from before Home has none: no chip, and Albums first.
  const noHome = home.data === null;
  const view: View_ = noHome && picked === "home" ? "albums" : picked;
  const tabFade = useTabFade(view);
  const views = noHome ? VIEWS.filter((v) => v.id !== "home") : VIEWS;
  // Home lists the first few; a tap queues the whole list from that song.
  const repeatAll = useMemo(() => home.data?.onRepeat ?? [], [home.data]);
  const onRepeat = useMemo(() => repeatAll.slice(0, ON_REPEAT_ROWS), [repeatAll]);
  // Artists and songs load the first time their chip is picked.
  const [seen, setSeen] = useState<Set<View_>>(() => new Set(["albums"]));
  const artists = useArtists("mine", seen.has("artists"));
  const tracks = useTracks("mine", seen.has("songs"));
  // Everything else: for "Add all" when you have nothing yet.
  const allAlbums = useAlbums("all", nothingYet);

  // Your own songs play the whole list from that one. One function for every row keeps the rows' memo.
  const playOwn = useCallback(
    (track: TrackDto) => {
      if (tracks.data) playSongs(tracks.data, tracks.data.indexOf(track));
    },
    [tracks.data],
  );
  const playRepeat = useCallback(
    (track: TrackDto) => playMusic({ kind: "songs", refId: null, title: "On repeat", tracks: repeatAll }, repeatAll.indexOf(track)),
    [repeatAll],
  );

  const current = view === "home" ? home : view === "albums" ? albums : view === "artists" ? artists : view === "songs" ? tracks : playlists;
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
      if (newAlbums.length) out.push({ kind: "shelfTitle", key: "t:new", title: "New albums" }, { kind: "albumShelf", key: "new", albums: newAlbums });
      return out;
    }
    if (view === "albums") {
      for (const row of gridRows(sortAlbums(albums.data ?? [], sort))) out.push({ kind: "albums", key: row[0]!.id, albums: row });
    } else if (view === "artists") {
      // Each artist's albums come from the album list already loaded.
      const byArtist = albumsByArtist(albums.data ?? []);
      for (const a of artists.data ?? []) out.push({ kind: "artist", key: a.id, artist: a, albums: byArtist.get(a.id) ?? [] });
    } else {
      for (const s of tracks.data ?? []) out.push({ kind: "song", key: s.id, track: s });
    }
    return out;
  }, [view, albums.data, artists.data, tracks.data, playlists.data, home.data, onRepeat, sort]);

  const pick = (next: View_) => {
    setPicked(next);
    setSeen((s) => (s.has(next) ? s : new Set(s).add(next)));
  };

  const header = (
    <View style={{ paddingTop: top, marginBottom: 18, gap: 14 }}>
      <PageTitle
        title="Music"
        right={
          // Only albums have a sort; artists and songs are A to Z.
          !nothingYet && view === "albums" ? (
            <IconButton label={`Sort albums, ${ALBUM_SORTS.find((s) => s.id === sort)?.label}`} onPress={() => setSortOpen(true)}>
              <FilterIcon color={t.text} />
            </IconButton>
          ) : null
        }
      />
      {nothingYet ? null : <TextTabs options={views} value={view} onPick={pick} style={{ marginTop: -14 }} />}
      {nothingYet ? null : <BrowseRow notAdded={(summary.data?.albums ?? 0) - (mine?.albums ?? 0)} fresh={summary.data?.newAlbums ?? 0} />}
      {view === "songs" && tracks.data?.length ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <PlayButton label="Play all" from={{ kind: "songs", refId: null }} onPress={() => playSongs(tracks.data, -1)} />
          <ShuffleButton from={{ kind: "songs", refId: null }} onPlay={() => playSongs(tracks.data, -1, true)} />
        </View>
      ) : null}
    </View>
  );

  const empty = noFolder ? (
    <NoMusic />
  ) : nothingYet ? (
    <StartHere total={summary.data?.albums ?? 0} all={allAlbums.data} />
  ) : current.isPending ? (
    <Skeleton>
      {view === "home" ? (
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
      ) : view === "artists" ? (
        [0, 1].map((i) => (
          <View key={i}>
            <SectionBone />
            <CoverGridBones count={3} />
          </View>
        ))
      ) : (
        [0, 1, 2, 3, 4].map((i) => <ListRowBone key={i} thumb={44} />)
      )}
    </Skeleton>
  ) : current.isError ? (
    <Empty title="Couldn't load your music">{current.error.message}</Empty>
  ) : view === "playlists" ? (
    <Empty>Make a playlist, then add songs to it from the menu on any song.</Empty>
  ) : view === "home" ? (
    <Empty>Play something and it shows up here.</Empty>
  ) : (
    <Empty>Nothing here yet.</Empty>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={nothingYet ? [] : items}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24, flexGrow: 1 }}
        refreshControl={refresh}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
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
          {
          item.kind === "albums" ? (
            <View style={{ flexDirection: "row", columnGap: GAP }}>
              {item.albums.map((a) => (
                // Albums with only some songs added say how many, instead of the artist.
                <AlbumCard key={a.id} album={a} width={width} sub={albumInMusic(a) === "some" ? albumInMusicLabel(a) : undefined} />
              ))}
            </View>
          ) : item.kind === "playlists" ? (
            <View style={{ flexDirection: "row", columnGap: GAP }}>
              {item.playlists.map((p) =>
                p ? <PlaylistCard key={p.id} playlist={p} width={width} /> : <NewPlaylistTile key="new" width={width} onPress={() => setNaming(true)} />,
              )}
            </View>
          ) : item.kind === "artist" ? (
            // Like the Books tab's authors: the name opens the artist, then a row of their albums.
            <Group title={item.artist.name} count={item.artist.albumCount} onOpen={() => openArtist(item.artist.id)}>
              {item.albums.map((a) => (
                <AlbumCard key={a.id} album={a} width={shelfWidth} sub={a.year} />
              ))}
            </Group>
          ) : item.kind === "shelfTitle" ? (
            <View style={{ marginTop: index === 0 ? -12 : 0 }}>
              <SectionTitle title={item.title} />
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
                <AlbumCard key={a.id} album={a} width={shelfWidth} badge />
              ))}
            </Shelf>
          ) : item.kind === "artistShelf" ? (
            <Shelf>
              {item.artists.map((a) => (
                <ArtistCard key={a.id} artist={a} width={shelfWidth} />
              ))}
            </Shelf>
          ) : item.kind === "repeat" ? (
            <SongRow track={item.track} onPlay={playRepeat} onMore={setSong} />
          ) : (
            // Your own songs play the whole list from that one.
            <SongRow track={item.track} onPlay={playOwn} onMore={setSong} />
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
        onSubmit={async (name) => openPlaylist((await createPlaylist(name)).id)}
      />
    </View>
  );
}

/** The way into Browse: everything you haven't added, and how much of it is new. */
function BrowseRow({ notAdded, fresh }: { notAdded: number; fresh: number }) {
  const t = useTheme();
  return (
    <CardLink
      icon={<BrowseIcon size={22} color={t.accent} />}
      title="Browse"
      sub={notAdded > 0 ? `${plural(notAdded, "album")} you haven't added` : "Everything's in your music"}
      label={fresh ? `Browse, ${fresh} new` : "Browse"}
      onPress={() => router.push("/browse")}
      badge={
        fresh > 0 ? (
          <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: "center", backgroundColor: t.accent }}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 11, color: t.onAccent }}>{`${fresh} new`}</Text>
          </View>
        ) : null
      }
    />
  );
}

/** The music icon, a title and a line, centred, with any buttons below. */
function MusicNote({ title, children, actions }: { title: string; children: string; actions?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 12, paddingVertical: 40 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: t.surface }}>
        <MusicIcon size={34} color={t.accent} />
      </View>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 20, color: t.text, textAlign: "center" }}>{title}</Text>
      <Text variant="body" style={{ textAlign: "center", maxWidth: 290, color: t.muted }}>
        {children}
      </Text>
      {actions ? <View style={{ alignSelf: "stretch", gap: 10, marginTop: 8, paddingHorizontal: 24 }}>{actions}</View> : null}
    </View>
  );
}

/** No music folder set up yet. */
function NoMusic() {
  const admin = !!useSession().user?.isAdmin;
  return (
    <MusicNote title="No music yet">
      {admin ? "Mount your music at /music, and your albums show up here." : "Albums show up here once they're added."}
    </MusicNote>
  );
}

/** Nothing added yet: go and pick, or take everything. */
function StartHere({ total, all }: { total: number; all: AlbumSummary[] | undefined }) {
  const [busy, setBusy] = useState(false);
  return (
    <MusicNote
      title="Pick the music you want"
      actions={
        <>
          <Button label="Browse" onPress={() => router.push("/browse")} />
          {total > 0 ? (
            <Button
              label={total === 1 ? "Add the album" : `Add all ${total} albums`}
              kind="secondary"
              busy={busy}
              disabled={!all}
              onPress={() => {
                if (!all) return;
                setBusy(true);
                void setInMusic({ albums: all }, true).finally(() => setBusy(false));
              }}
            />
          ) : null}
        </>
      }
    >
      Add the albums and songs you like and they show up here. The rest stays out of the way.
    </MusicNote>
  );
}
