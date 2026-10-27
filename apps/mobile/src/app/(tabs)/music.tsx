import { useMemo, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import {
  albumInMusic,
  albumInMusicLabel,
  albumMatches,
  ALBUM_SORTS,
  albumsByArtist,
  type AlbumSummary,
  artistMatches,
  type ArtistSummary,
  plural,
  songMatches,
  sortAlbums,
  type TrackDto,
} from "@murmur/shared/client";
import { BrowseIcon, ChevronIcon, CloseIcon, FilterIcon, MusicIcon, SearchIcon } from "@/components/icons";
import { GAP, Group, PAD, useGridWidth } from "@/components/library";
import { Eyebrow } from "@/components/listening";
import { AlbumAddRow, AlbumCard, AlbumSortSheet, openArtist, SongRow, useAlbumSort } from "@/components/music";
import { Empty, PageTitle, useTopInset } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { CoverGridBones, ListRowBone, SectionBone, Skeleton } from "@/components/skeleton";
import { Button, Chip, IconButton, Text } from "@/components/ui";
import { setInMusic, useAlbums, useArtists, useMusicSummary, useTracks } from "@/lib/data";
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
  | { kind: "song"; key: string; track: TrackDto; toggle?: boolean }
  | { kind: "head"; key: string; title: string }
  | { kind: "addAlbum"; key: string; album: AlbumSummary };

// Defined once: an inline component here would be a new type each render.
const RowGap = () => <View style={{ height: 18 }} />;

/**
 * Your music: the albums, artists and songs you've added. Everything else is under Browse, and a
 * search also shows matches from there that you could add.
 */
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
  const mine = summary.data?.mine;
  const nothingYet = mine?.tracks === 0;
  const q = query.trim().toLowerCase();
  const albums = useAlbums("mine");
  // Artists and songs load the first time their chip is picked.
  const [seen, setSeen] = useState<Set<View_>>(() => new Set(["albums"]));
  const artists = useArtists("mine", seen.has("artists"));
  const tracks = useTracks("mine", seen.has("songs"));
  // Everything else: for "Add all" when you have nothing yet, and "More to add" while searching.
  const allAlbums = useAlbums("all", nothingYet || !!q);
  const allTracks = useTracks("all", !!q);

  const current = view === "albums" ? albums : view === "artists" ? artists : tracks;
  const refresh = usePullRefresh(() => Promise.all([summary.refetch(), current.refetch()]));

  const items = useMemo((): Item[] => {
    const out: Item[] = [];
    if (view === "albums") {
      const list = sortAlbums(albums.data ?? [], sort).filter((a) => albumMatches(a, q));
      for (let i = 0; i < list.length; i += 2) out.push({ kind: "albums", key: list[i]!.id, albums: list.slice(i, i + 2) });
    } else if (view === "artists") {
      // Each artist's albums come from the album list already loaded.
      const byArtist = albumsByArtist(albums.data ?? []);
      for (const a of (artists.data ?? []).filter((x) => artistMatches(x, q))) out.push({ kind: "artist", key: a.id, artist: a, albums: byArtist.get(a.id) ?? [] });
    } else {
      for (const s of (tracks.data ?? []).filter((x) => songMatches(x, q))) out.push({ kind: "song", key: s.id, track: s });
    }
    if (!q) return out;

    // Searching: what you could add, after your own matches.
    const more: Item[] = [
      ...(allAlbums.data ?? []).filter((a) => albumInMusic(a) !== "all" && albumMatches(a, q)).map((a): Item => ({ kind: "addAlbum", key: `add:${a.id}`, album: a })),
      ...(allTracks.data ?? []).filter((s) => !s.inMusic && songMatches(s, q)).map((s): Item => ({ kind: "song", key: `add:${s.id}`, track: s, toggle: true })),
    ];
    if (!more.length) return out;
    return [...(out.length ? [{ kind: "head", key: "head:mine", title: "In your music" } as Item] : []), ...out, { kind: "head", key: "head:more", title: "More to add" }, ...more];
  }, [view, albums.data, artists.data, tracks.data, allAlbums.data, allTracks.data, q, sort]);

  const pick = (next: View_) => {
    setView(next);
    setSeen((s) => (s.has(next) ? s : new Set(s).add(next)));
  };

  const header = (
    <View style={{ paddingTop: top, marginBottom: 18, gap: 14 }}>
      <PageTitle
        title="Music"
        count={nothingYet ? undefined : mine?.albums}
        right={
          nothingYet ? null : (
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
          )
        }
      />
      {searching ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: t.surface }}>
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
      {nothingYet || q ? null : <BrowseRow notAdded={(summary.data?.albums ?? 0) - (mine?.albums ?? 0)} fresh={summary.data?.newAlbums ?? 0} />}
      {nothingYet ? null : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {VIEWS.map((v) => (
            <Chip key={v.id} label={v.label} selected={view === v.id} onPress={() => pick(v.id)} />
          ))}
        </View>
      )}
    </View>
  );

  const empty = nothingYet ? (
    <StartHere total={summary.data?.albums ?? 0} all={allAlbums.data} />
  ) : current.isPending ? (
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
    <Empty>Nothing here yet.</Empty>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={nothingYet && !q ? [] : items}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24, flexGrow: 1 }}
        refreshControl={refresh}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={view === "albums" && !q ? RowGap : undefined}
        windowSize={7}
        maxToRenderPerBatch={8}
        renderItem={({ item }) =>
          item.kind === "albums" ? (
            <View style={{ flexDirection: "row", columnGap: GAP, marginBottom: q ? 18 : 0 }}>
              {item.albums.map((a) => (
                // Albums with only some songs added say how many, instead of the artist.
                <AlbumCard key={a.id} album={a} width={width} sub={albumInMusic(a) === "some" ? albumInMusicLabel(a) : undefined} />
              ))}
            </View>
          ) : item.kind === "artist" ? (
            // Like the Books tab's authors: the name opens the artist, then a row of their albums.
            <Group title={item.artist.name} count={item.artist.albumCount} onOpen={() => openArtist(item.artist.id)}>
              {item.albums.map((a) => (
                <AlbumCard key={a.id} album={a} width={shelfWidth} sub={a.year} />
              ))}
            </Group>
          ) : item.kind === "head" ? (
            <View style={{ marginTop: 20, marginBottom: 4 }}>
              <Eyebrow>{item.title}</Eyebrow>
            </View>
          ) : item.kind === "addAlbum" ? (
            <AlbumAddRow album={item.album} />
          ) : (
            <SongRow track={item.track} toggle={item.toggle} />
          )
        }
      />
      <AlbumSortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
    </View>
  );
}

/** The way into Browse: everything you haven't added, and how much of it is new. */
function BrowseRow({ notAdded, fresh }: { notAdded: number; fresh: number }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fresh ? `Browse, ${fresh} new` : "Browse"}
      onPress={() => router.push("/browse")}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 14, backgroundColor: t.surface, opacity: pressed ? 0.75 : 1 })}
    >
      <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: t.surface2 }}>
        <BrowseIcon size={22} color={t.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">Browse</Text>
        <Text variant="small" numberOfLines={1}>
          {notAdded > 0 ? `${plural(notAdded, "album")} you haven't added` : "Everything is in your music"}
        </Text>
      </View>
      {fresh > 0 ? (
        <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: "center", backgroundColor: t.accent }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 11, color: t.onAccent }}>{`${fresh} new`}</Text>
        </View>
      ) : null}
      <ChevronIcon size={20} color={t.faint} />
    </Pressable>
  );
}

/** Nothing added yet: go and pick, or take everything. */
function StartHere({ total, all }: { total: number; all: AlbumSummary[] | undefined }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 12, paddingVertical: 40 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: t.surface }}>
        <MusicIcon size={34} color={t.accent} />
      </View>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 20, color: t.text, textAlign: "center" }}>Pick the music you want</Text>
      <Text variant="body" style={{ textAlign: "center", maxWidth: 290, color: t.muted }}>
        Add the albums and songs you like and they show up here. The rest stays out of the way.
      </Text>
      <View style={{ alignSelf: "stretch", gap: 10, marginTop: 8, paddingHorizontal: 24 }}>
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
      </View>
    </View>
  );
}
