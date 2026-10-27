import { useMemo, useState } from "react";
import { FlatList, TextInput, View } from "react-native";
import {
  albumMatches,
  ALBUM_SORTS,
  albumsByArtist,
  type AlbumSummary,
  artistMatches,
  type ArtistSummary,
  songMatches,
  sortAlbums,
  type TrackDto,
} from "@murmur/shared/client";
import { CloseIcon, FilterIcon, SearchIcon } from "@/components/icons";
import { GAP, Group, PAD, useGridWidth } from "@/components/library";
import { AlbumCard, AlbumSortSheet, openArtist, SongRow, useAlbumSort } from "@/components/music";
import { Empty, PageTitle, useTopInset } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { CoverGridBones, ListRowBone, SectionBone, Skeleton } from "@/components/skeleton";
import { Chip, IconButton } from "@/components/ui";
import { useAlbums, useArtists, useMusicSummary, useTracks } from "@/lib/data";
import { fonts, useTheme } from "@/theme";

type View_ = "albums" | "artists" | "songs";

const VIEWS: { id: View_; label: string; placeholder: string }[] = [
  { id: "albums", label: "Albums", placeholder: "Album or artist" },
  { id: "artists", label: "Artists", placeholder: "Artist" },
  { id: "songs", label: "Songs", placeholder: "Song, artist or album" },
];

type Item =
  | { kind: "albums"; key: string; albums: AlbumSummary[] }
  | { kind: "artist"; key: string; artist: ArtistSummary; albums: AlbumSummary[] }
  | { kind: "song"; key: string; track: TrackDto };

// Defined once: an inline component here would be a new type each render.
const RowGap = () => <View style={{ height: 18 }} />;

/** Albums, artists and songs from the server's music folders. Search filters on the phone. */
export default function Music() {
  const t = useTheme();
  const top = useTopInset();
  const width = useGridWidth(2);
  const shelfWidth = useGridWidth();
  const [view, setView] = useState<View_>("albums");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const sort = useAlbumSort();
  const summary = useMusicSummary();
  const albums = useAlbums();
  // Artists and songs load the first time their chip is picked.
  const [seen, setSeen] = useState<Set<View_>>(() => new Set(["albums"]));
  const artists = useArtists(seen.has("artists"));
  const tracks = useTracks(seen.has("songs"));
  const q = query.trim().toLowerCase();

  const current = view === "albums" ? albums : view === "artists" ? artists : tracks;
  const refresh = usePullRefresh(() => Promise.all([summary.refetch(), current.refetch()]));

  const items = useMemo((): Item[] => {
    if (view === "albums") {
      const list = sortAlbums(albums.data ?? [], sort).filter((a) => albumMatches(a, q));
      const rows: Item[] = [];
      for (let i = 0; i < list.length; i += 2) rows.push({ kind: "albums", key: list[i]!.id, albums: list.slice(i, i + 2) });
      return rows;
    }
    if (view === "artists") {
      // Each artist's own albums come from the album list already loaded.
      const byArtist = albumsByArtist(albums.data ?? []);
      return (artists.data ?? [])
        .filter((a) => artistMatches(a, q))
        .map((a) => ({ kind: "artist", key: a.id, artist: a, albums: byArtist.get(a.id) ?? [] }));
    }
    return (tracks.data ?? []).filter((s) => songMatches(s, q)).map((s) => ({ kind: "song", key: s.id, track: s }));
  }, [view, albums.data, artists.data, tracks.data, q, sort]);

  const pick = (next: View_) => {
    setView(next);
    setSeen((s) => (s.has(next) ? s : new Set(s).add(next)));
  };

  const header = (
    <View style={{ paddingTop: top, marginBottom: 18 }}>
      <PageTitle
        title="Music"
        count={summary.data?.albums}
        right={
          <>
            <IconButton
              label={searching ? "Close search" : "Search"}
              onPress={() => {
                setSearching((s) => !s);
                setQuery("");
              }}
            >
              {searching ? <CloseIcon color={t.text} /> : <SearchIcon color={t.text} />}
            </IconButton>
            {/* Only albums have a sort; artists and songs are A to Z. */}
            {view === "albums" ? (
              <IconButton label={`Sort albums, ${ALBUM_SORTS.find((s) => s.id === sort)?.label}`} onPress={() => setSortOpen(true)}>
                <FilterIcon color={t.text} />
              </IconButton>
            ) : null}
          </>
        }
      />
      {searching ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: t.surface, marginBottom: 12 }}>
          <SearchIcon size={20} color={t.muted} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder={VIEWS.find((v) => v.id === view)!.placeholder}
            placeholderTextColor={t.faint}
            selectionColor={t.accent}
            style={{ flex: 1, color: t.text, fontFamily: fonts.medium, fontSize: 15 }}
          />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {VIEWS.map((v) => (
          <Chip key={v.id} label={v.label} selected={view === v.id} onPress={() => pick(v.id)} />
        ))}
      </View>
    </View>
  );

  const empty = current.isPending ? (
    <Skeleton>
      {view === "albums" ? (
        <CoverGridBones count={4} columns={2} />
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
  ) : q ? (
    <Empty>{`Nothing matches "${query.trim()}".`}</Empty>
  ) : (
    <Empty>No music yet.</Empty>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }}
        refreshControl={refresh}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={view === "albums" ? RowGap : undefined}
        windowSize={7}
        maxToRenderPerBatch={8}
        renderItem={({ item }) =>
          item.kind === "albums" ? (
            <View style={{ flexDirection: "row", columnGap: GAP }}>
              {item.albums.map((a) => (
                <AlbumCard key={a.id} album={a} width={width} />
              ))}
            </View>
          ) : item.kind === "artist" ? (
            // Like the Books tab's authors: the name opens the artist, then a row of their albums.
            <Group title={item.artist.name} count={item.artist.albumCount} onOpen={() => openArtist(item.artist.id)}>
              {item.albums.map((a) => (
                <AlbumCard key={a.id} album={a} width={shelfWidth} sub={a.year} />
              ))}
            </Group>
          ) : (
            <SongRow track={item.track} />
          )
        }
      />
      <AlbumSortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
    </View>
  );
}
