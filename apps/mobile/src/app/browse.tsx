import { useMemo, useState } from "react";
import { FlatList, TextInput, View } from "react-native";
import { albumInMusic, albumMatches, ALBUM_SORTS, type AlbumSummary, isNewAlbum, plural, sortAlbums } from "@murmur/shared/client";
import { CloseIcon, FilterIcon, SearchIcon } from "@/components/icons";
import { GAP, PAD, useGridWidth } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { AlbumCard, AlbumSortSheet, useAlbumSort } from "@/components/music";
import { BackRow, Empty, PageTitle, useBottomPad, useTopInset } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { CoverGridBones, Skeleton } from "@/components/skeleton";
import { Chip, IconButton } from "@/components/ui";
import { useAlbums, useMusicSummary } from "@/lib/data";
import { fonts, useTheme } from "@/theme";

type Filter = "all" | "not" | "new";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "not", label: "Not added" },
  { id: "new", label: "New" },
];

const RowGap = () => <View style={{ height: 18 }} />;

/** Every album, with a + on each cover to add it to your music. Opened from the Music tab. */
export default function Browse() {
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  const width = useGridWidth(2);
  const summary = useMusicSummary().data;
  const albums = useAlbums("all");
  const sort = useAlbumSort();
  const [filter, setFilter] = useState<Filter>("all");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const refresh = usePullRefresh(albums.refetch);
  const q = query.trim().toLowerCase();

  const rows = useMemo(() => {
    const list = sortAlbums(albums.data ?? [], sort).filter(
      (a) => albumMatches(a, q) && (filter === "all" || (filter === "new" ? isNewAlbum(a) : albumInMusic(a) !== "all")),
    );
    const out: AlbumSummary[][] = [];
    for (let i = 0; i < list.length; i += 2) out.push(list.slice(i, i + 2));
    return out;
  }, [albums.data, sort, filter, q]);

  const header = (
    <View style={{ paddingTop: top, marginBottom: 18, gap: 12 }}>
      <BackRow
        right={
          <View style={{ flexDirection: "row" }}>
            <IconButton
              label={searching ? "Close search" : "Search"}
              onPress={() => {
                setSearching((s) => !s);
                setQuery("");
              }}
            >
              {searching ? <CloseIcon color={t.text} /> : <SearchIcon color={t.text} />}
            </IconButton>
            <IconButton label={`Sort albums, ${ALBUM_SORTS.find((s) => s.id === sort)?.label}`} onPress={() => setSortOpen(true)}>
              <FilterIcon color={t.text} />
            </IconButton>
          </View>
        }
      />
      <PageTitle title="Browse" sub={summary ? `${plural(summary.albums, "album")}, ${summary.mine.albums} in your music` : null} />
      {searching ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: t.surface }}>
          <SearchIcon size={20} color={t.muted} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Album or artist"
            placeholderTextColor={t.faint}
            selectionColor={t.accent}
            style={{ flex: 1, color: t.text, fontFamily: fonts.medium, fontSize: 15 }}
          />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} selected={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r[0]!.id}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: bottom }}
        refreshControl={refresh}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={
          albums.isPending ? (
            <Skeleton>
              <CoverGridBones count={4} columns={2} />
            </Skeleton>
          ) : albums.isError ? (
            <Empty title="Couldn't load the albums">{albums.error.message}</Empty>
          ) : (
            <Empty>{q ? `Nothing matches "${query.trim()}".` : filter === "new" ? "No new albums lately." : "You've added everything."}</Empty>
          )
        }
        ItemSeparatorComponent={RowGap}
        windowSize={7}
        maxToRenderPerBatch={8}
        renderItem={({ item }) => (
          <View style={{ flexDirection: "row", columnGap: GAP }}>
            {item.map((a) => (
              <AlbumCard key={a.id} album={a} width={width} badge sub={isNewAlbum(a) ? `${a.artist}, new` : a.artist} />
            ))}
          </View>
        )}
      />
      <BottomMiniPlayer />
      <AlbumSortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
    </View>
  );
}
