import { useMemo, useState } from "react";
import { FlatList, TextInput, View } from "react-native";
import { router } from "expo-router";
import { type MovieSummary, percentDone, type ShowSummary, sortWatch, type WatchCard, WATCH_SORTS } from "@murmur/shared/client";
import { CloseIcon, FilterIcon, SearchIcon } from "@/components/icons";
import { GAP, gridRows, PAD, Shelf, useGridWidth, useShelfWidth } from "@/components/library";
import { Empty, PageTitle, SectionTitle, useTopInset } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { CoverGridBones, Skeleton } from "@/components/skeleton";
import { Button, Chips, IconButton } from "@/components/ui";
import { type PosterItem, PosterCard, RescanButton, StillCard, useWatchSort, WatchSortSheet } from "@/components/watch";
import { useDownloads } from "@/lib/downloads";
import { useOnline } from "@/lib/query";
import { useSession } from "@/lib/session";
import { openMovie, openTvShow, useMovies, useShows, useWatchHome } from "@/lib/watch";
import { fonts, useTheme } from "@/theme";

type Tab = "home" | "movies" | "shows" | "watched";

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "movies", label: "Movies" },
  { id: "shows", label: "Shows" },
  { id: "watched", label: "Watched" },
];

type Row =
  | { kind: "stills"; key: string; title: string; cards: WatchCard[] }
  | { kind: "shelf"; key: string; title: string; items: PosterItem[] }
  | { kind: "grid"; key: string; items: PosterItem[] };

const movieItem = (m: MovieSummary): PosterItem => ({
  kind: "movie",
  id: m.id,
  title: m.title,
  year: m.year,
  posterHash: m.posterHash,
  color: m.color,
  watched: !!m.progress?.finished,
  percent: m.progress && !m.progress.finished ? percentDone(m.progress.positionSec, m.durationSec) : 0,
  addedAt: m.addedAt,
});

const showItem = (s: ShowSummary): PosterItem => ({
  kind: "show",
  id: s.id,
  title: s.title,
  year: s.year,
  posterHash: s.posterHash,
  color: s.color,
  watched: s.episodes > 0 && s.watched === s.episodes,
  addedAt: s.addedAt,
});

const open = (i: PosterItem) => (i.kind === "movie" ? openMovie(i.id) : openTvShow(i.id));

const RowGap = () => <View style={{ height: 18 }} />;

/** Movies and shows: Continue watching, Next episodes and what's new, then every movie, show and what you've watched. */
export default function Watch() {
  const t = useTheme();
  const top = useTopInset();
  const width = useGridWidth();
  const shelfWidth = useShelfWidth();
  const admin = !!useSession().user?.isAdmin;
  const [tab, setTab] = useState<Tab>("home");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const sort = useWatchSort();
  const home = useWatchHome();
  const movies = useMovies();
  const shows = useShows();
  const refresh = usePullRefresh(() => Promise.all([home.refetch(), movies.refetch(), shows.refetch()]));

  // Offline, only what's downloaded: movies, and shows with an episode saved.
  const online = useOnline();
  const downloads = useDownloads();
  const all = useMemo(() => {
    const saved = new Set(
      Object.values(downloads).flatMap((d) => (d.status !== "done" ? [] : d.type === "movie" ? [`movie-${d.id}`] : d.type === "show" ? [`show-${d.show.id}`] : [])),
    );
    const list = [...(movies.data ?? []).map(movieItem), ...(shows.data ?? []).map(showItem)].filter((i) => online || saved.has(`${i.kind}-${i.id}`));
    return sortWatch(list, sort, (i) => i);
  }, [movies.data, shows.data, online, downloads, sort]);
  const q = query.trim().toLowerCase();

  const rows = useMemo((): Row[] => {
    const grid = (list: PosterItem[]): Row[] => gridRows(list).map((r) => ({ kind: "grid", key: `${r[0]!.kind}-${r[0]!.id}`, items: r }));
    if (q) return grid((tab === "home" ? all : all.filter(inTab(tab))).filter((i) => i.title.toLowerCase().includes(q)));
    if (tab !== "home") return grid(all.filter(inTab(tab)));
    // Home's shelves are the server's; offline it's just the downloads.
    if (!online) return grid(all);
    const h = home.data;
    if (!h) return [];
    const byKey = new Map(all.map((i) => [`${i.kind}-${i.id}`, i]));
    const recent = h.recentlyAdded.flatMap((p) => byKey.get(`${p.kind}-${p.id}`) ?? []);
    const out: Row[] = [];
    if (h.continueWatching.length) out.push({ kind: "stills", key: "continue", title: "Continue watching", cards: h.continueWatching });
    if (h.nextEpisodes.length) out.push({ kind: "stills", key: "next", title: "Next episodes", cards: h.nextEpisodes });
    const recentMovies = recent.filter((i) => i.kind === "movie");
    const recentShows = recent.filter((i) => i.kind === "show");
    if (recentMovies.length) out.push({ kind: "shelf", key: "movies", title: "Recently added movies", items: recentMovies });
    if (recentShows.length) out.push({ kind: "shelf", key: "shows", title: "Recently added shows", items: recentShows });
    return out;
  }, [all, home.data, q, tab, online]);

  // No movies or shows folder on the server yet: just the title and a note.
  const noFolder = home.data?.enabled === false;
  const loading = movies.isPending || shows.isPending || (tab === "home" && home.isPending);
  const failed = movies.error ?? shows.error ?? (tab === "home" ? home.error : null);

  const header = (
    <View style={{ paddingTop: top, marginBottom: 18, gap: 14 }}>
      <PageTitle
        title="Watch"
        right={
          noFolder ? null : (
            <>
              {admin ? <RescanButton /> : null}
              <IconButton
                label={searching ? "Close search" : "Search"}
                onPress={() => {
                  setSearching((s) => !s);
                  setQuery("");
                }}
              >
                {searching ? <CloseIcon color={t.text} /> : <SearchIcon color={t.text} />}
              </IconButton>
              {/* Home's shelves are in the server's order; the other views have a sort. */}
              {tab !== "home" ? (
                <IconButton label={`Sort, ${WATCH_SORTS.find((s) => s.id === sort)?.label}`} onPress={() => setSortOpen(true)}>
                  <FilterIcon color={t.text} />
                </IconButton>
              ) : null}
            </>
          )
        }
      />
      {searching && !noFolder ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: t.surface }}>
          <SearchIcon size={20} color={t.muted} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Search movies and shows"
            placeholderTextColor={t.faint}
            selectionColor={t.accent}
            style={{ flex: 1, color: t.text, fontFamily: fonts.medium, fontSize: 15 }}
          />
        </View>
      ) : null}
      {noFolder ? null : <Chips gap={8} options={TABS} value={tab} onPick={setTab} />}
    </View>
  );

  const empty = noFolder ? (
    <View style={{ alignItems: "center" }}>
      <Empty title="Nothing to watch yet">
        {admin ? "Add a movies or shows folder and they show up here." : "Movies and shows show up here once a folder is added."}
      </Empty>
      {admin ? <Button label="Add a folder" onPress={() => router.push("/library")} style={{ marginTop: -36 }} /> : null}
    </View>
  ) : loading ? (
    <Skeleton>
      <CoverGridBones count={6} />
    </Skeleton>
  ) : failed ? (
    <Empty title="Couldn't load Watch">{failed.message}</Empty>
  ) : !online && all.length === 0 ? (
    <Empty title="Nothing downloaded" />
  ) : all.length === 0 ? (
    <Empty title="Nothing to watch yet">Movies and shows show up here once the scan finds them.</Empty>
  ) : q ? (
    <Empty>{`Nothing matches "${query.trim()}".`}</Empty>
  ) : tab === "watched" ? (
    <Empty title="Nothing watched yet">{"Movies you finish, and shows you've seen every episode of, go here."}</Empty>
  ) : tab === "home" ? (
    <Empty>Nothing here yet.</Empty>
  ) : (
    <Empty title={tab === "movies" ? "No movies yet" : "No shows yet"}>They show up here once the scan finds them.</Empty>
  );

  const gridView = q || tab !== "home";
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={noFolder ? [] : rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24, flexGrow: 1 }}
        refreshControl={refresh}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={gridView ? RowGap : undefined}
        windowSize={7}
        maxToRenderPerBatch={8}
        renderItem={({ item: row, index }) =>
          row.kind === "grid" ? (
            <View style={{ flexDirection: "row", columnGap: GAP }}>
              {row.items.map((i) => (
                <PosterCard key={`${i.kind}-${i.id}`} item={i} width={width} onPress={() => open(i)} />
              ))}
            </View>
          ) : (
            <View style={{ marginTop: index === 0 ? -12 : 0 }}>
              <SectionTitle title={row.title} />
              <Shelf>
                {row.kind === "stills"
                  ? row.cards.map((c) => <StillCard key={c.id} card={c} />)
                  : row.items.map((i) => <PosterCard key={i.id} item={i} width={shelfWidth} onPress={() => open(i)} />)}
              </Shelf>
            </View>
          )
        }
      />
      <WatchSortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
    </View>
  );
}

const inTab = (tab: Exclude<Tab, "home">) => (i: PosterItem) => (tab === "watched" ? i.watched : tab === "movies" ? i.kind === "movie" : i.kind === "show");
