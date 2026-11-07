import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, type GestureResponderEvent, Pressable, View } from "react-native";
import { hasKind, type SearchKind, type SearchResultsDto, type TrackDto } from "@murmur/shared/client";
import { BookCard } from "@/components/book-card";
import { EpisodeRow } from "@/components/episode-row";
import { ChevronIcon, CloseIcon } from "@/components/icons";
import { GAP, gridRows, openGroup, PAD, Shelf, useGridWidth, useShelfWidth } from "@/components/library";
import { AlbumCard, ArtistCard, SongRow, SongSheet } from "@/components/music";
import { Empty, PageTitle, SectionTitle, useTopInset } from "@/components/page";
import { ShowCard } from "@/components/podcasts";
import { useKeyboardHeight } from "@/components/sheet";
import { FadeIn, ListRowBone, Skeleton } from "@/components/skeleton";
import { TextTabs, useTabFade } from "@/components/text-tabs";
import { CountPill, IconButton, Text } from "@/components/ui";
import { PosterCard, StillCard } from "@/components/watch";
import { useTabPrefs } from "@/lib/data";
import { forgetSearch, rememberSearch, searchKind, searchText, useDebounced, useRecentSearches, useSearch } from "@/lib/search";
import { openMovie, openTvShow } from "@/lib/watch";
import { playMusic } from "@/player/engine";
import { useTheme } from "@/theme";

/** Episode and song rows on All; cards show the server's full group in a shelf. */
const ALL_ROWS = 4;

const KIND_LABELS: Record<SearchKind, string> = { all: "All", books: "Books", podcasts: "Podcasts", music: "Music", watch: "Watch" };

type Card =
  | { kind: "book"; item: SearchResultsDto["books"][number] }
  | { kind: "podcast"; item: SearchResultsDto["podcasts"][number] }
  | { kind: "artist"; item: SearchResultsDto["artists"][number] }
  | { kind: "album"; item: SearchResultsDto["albums"][number] }
  | { kind: "poster"; item: SearchResultsDto["watch"][number] };

type Row =
  | { type: "head"; key: string; title: string; tab: SearchKind }
  | { type: "shelf"; key: string; cards: Card[] }
  | { type: "grid"; key: string; cards: Card[] }
  | { type: "stills"; key: string; cards: SearchResultsDto["tvEpisodes"] }
  | { type: "name"; key: string; name: string; books: number; open: () => void }
  | { type: "episode"; key: string; episode: SearchResultsDto["episodes"][number] }
  | { type: "song"; key: string; track: TrackDto };

/**
 * Search everywhere. The field is the dock's pill; this is the results under it: tabs for each
 * kind that's shown, then groups of hits, each opening its own tab with See all. With the field
 * empty it lists recent searches. Offline it searches what's downloaded.
 */
export default function Search() {
  const t = useTheme();
  const top = useTopInset();
  const keyboard = useKeyboardHeight();
  const prefs = useTabPrefs();
  const text = searchText.useValue();
  const picked = searchKind.useValue();
  const q = useDebounced(text.trim());
  const allowed = (["books", "podcasts", "music", "watch"] as const).filter((k) => prefs[k]);
  const kind: SearchKind = picked !== "all" && allowed.includes(picked) ? picked : "all";
  const results = useSearch(q, kind);
  // Only the kinds that found something get a tab, and All only beside one of them. The tabs
  // follow All's answer, so they hold still while the next one loads.
  const everything = results.everything;
  const found = everything ? allowed.filter((k) => hasKind(everything, k)) : [];
  const shown: SearchKind[] = found.length ? ["all", ...found] : [];
  // A new search that leaves the picked kind with nothing goes back to All.
  useEffect(() => {
    if (everything && kind !== "all" && !hasKind(everything, kind)) searchKind.set("all");
  }, [everything, kind]);
  const tabFade = useTabFade(kind);
  const recent = useRecentSearches();
  const [song, setSong] = useState<TrackDto | null>(null);
  const rows = useRows(results.data, kind);

  // A tap on a result keeps the search for next time; a drag (scrolling, a shelf) doesn't.
  const touch = useRef({ x: 0, y: 0 });
  const tapped = (e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    if (Math.abs(pageX - touch.current.x) < 10 && Math.abs(pageY - touch.current.y) < 10) rememberSearch(q);
  };

  const header = (
    <View style={{ paddingTop: top, marginBottom: 8 }}>
      <PageTitle title="Search" />
      {shown.length ? (
        <TextTabs label="Search in" options={shown.map((k) => ({ id: k, label: KIND_LABELS[k] }))} value={kind} onPick={searchKind.set} />
      ) : null}
      {results.offline ? (
        <Text variant="small" style={{ marginTop: 14 }}>
          Showing downloaded only
        </Text>
      ) : null}
    </View>
  );

  const empty = !q ? (
    <RecentSearches recent={recent} />
  ) : results.pending ? (
    <Skeleton>
      <View style={{ marginTop: 16 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <ListRowBone key={i} thumb={44} />
        ))}
      </View>
    </Skeleton>
  ) : results.error ? (
    <Empty title="Couldn't search">{results.error.message}</Empty>
  ) : (
    <Empty>{`Nothing matches "${q}".`}</Empty>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={q ? rows : []}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 + keyboard }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={header}
        ListEmptyComponent={<FadeIn when={false} style={tabFade}>{empty}</FadeIn>}
        windowSize={7}
        maxToRenderPerBatch={8}
        renderItem={({ item }) => (
          <FadeIn when style={tabFade}>
            <View onTouchStart={(e) => (touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })} onTouchEnd={tapped}>
              <ResultRow row={item} q={q} songs={results.data?.songs ?? []} onSongMore={setSong} />
            </View>
          </FadeIn>
        )}
      />
      <SongSheet track={song} onClose={() => setSong(null)} />
    </View>
  );
}

/** Each group as rows: a heading, then its cards in a shelf (All) or a grid (its own tab), or its list rows. */
function useRows(data: SearchResultsDto | undefined, kind: SearchKind): Row[] {
  return useMemo(() => {
    if (!data) return [];
    const out: Row[] = [];
    const all = kind === "all";
    // All keeps list groups short; their tab has the rest.
    const rowCap = all ? ALL_ROWS : undefined;
    const group = (key: string, title: string, tab: SearchKind, count: number, body: () => Row[]) => {
      // On a kind's tab, All's answer can stand in until its own comes; only that kind's part shows.
      if (!count || (!all && tab !== kind)) return;
      out.push({ type: "head", key: `h:${key}`, title, tab }, ...body());
    };
    const cards = (key: string, list: Card[]): Row[] =>
      all ? [{ type: "shelf", key, cards: list }] : gridRows(list).map((r, i) => ({ type: "grid", key: `${key}:${i}`, cards: r }));

    group("books", "Books", "books", data.books.length, () => cards("books", data.books.map((item) => ({ kind: "book", item }))));
    group("authors", "Authors", "books", data.authors.length, () =>
      data.authors.map((a) => ({ type: "name", key: `a:${a.name}`, name: a.name, books: a.books, open: () => openGroup({ author: a.name }) })),
    );
    group("series", "Series", "books", data.series.length, () =>
      data.series.map((s) => ({ type: "name", key: `s:${s.name}`, name: s.name, books: s.books, open: () => openGroup({ series: s.name }) })),
    );
    group("podcasts", "Podcasts", "podcasts", data.podcasts.length, () => cards("podcasts", data.podcasts.map((item) => ({ kind: "podcast", item }))));
    group("episodes", "Episodes", "podcasts", data.episodes.length, () => data.episodes.slice(0, rowCap).map((episode) => ({ type: "episode", key: `e:${episode.id}`, episode })));
    group("artists", "Artists", "music", data.artists.length, () => cards("artists", data.artists.map((item) => ({ kind: "artist", item }))));
    group("albums", "Albums", "music", data.albums.length, () => cards("albums", data.albums.map((item) => ({ kind: "album", item }))));
    group("songs", "Songs", "music", data.songs.length, () => data.songs.slice(0, rowCap).map((track) => ({ type: "song", key: `t:${track.id}`, track })));
    group("watch", "Movies and shows", "watch", data.watch.length, () => cards("watch", data.watch.map((item) => ({ kind: "poster", item }))));
    group("tv", "TV episodes", "watch", data.tvEpisodes.length, () => [{ type: "stills", key: "tv", cards: data.tvEpisodes }]);
    return out;
  }, [data, kind]);
}

function ResultRow({ row, q, songs, onSongMore }: { row: Row; q: string; songs: TrackDto[]; onSongMore: (track: TrackDto) => void }) {
  const t = useTheme();
  const shelfWidth = useShelfWidth();
  const gridWidth = useGridWidth();
  const all = searchKind.useValue() === "all";
  switch (row.type) {
    case "head":
      return (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 12, minHeight: 28 }}>
          <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
            {row.title}
          </Text>
          {all ? (
            <Pressable accessibilityRole="button" hitSlop={10} onPress={() => searchKind.set(row.tab)}>
              <Text variant="small" style={{ color: t.accent, fontSize: 14 }}>
                See all
              </Text>
            </Pressable>
          ) : null}
        </View>
      );
    case "shelf":
      return (
        <Shelf>
          {row.cards.map((c) => (
            <ResultCard key={`${c.kind}:${c.item.id}`} card={c} width={shelfWidth} />
          ))}
        </Shelf>
      );
    case "grid":
      return (
        <View style={{ flexDirection: "row", columnGap: GAP, marginBottom: 18 }}>
          {row.cards.map((c) => (
            <ResultCard key={`${c.kind}:${c.item.id}`} card={c} width={gridWidth} />
          ))}
        </View>
      );
    case "stills":
      return (
        <Shelf>
          {row.cards.map((c) => (
            <StillCard key={c.id} card={c} />
          ))}
        </Shelf>
      );
    case "name":
      return (
        <Pressable
          accessibilityRole="link"
          onPress={row.open}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, borderBottomWidth: 1, borderBottomColor: t.line, opacity: pressed ? 0.7 : 1 })}
        >
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {row.name}
          </Text>
          <CountPill count={row.books} />
          <View style={{ flex: 1 }} />
          <ChevronIcon size={18} color={t.faint} />
        </Pressable>
      );
    case "episode":
      return <EpisodeRow episode={row.episode} showThumb />;
    case "song":
      return (
        <SongRow
          track={row.track}
          toggle={!row.track.inMusic}
          onPlay={(track) => playMusic({ kind: "songs", refId: null, title: `"${q}"`, tracks: songs }, songs.indexOf(track))}
          onMore={onSongMore}
        />
      );
  }
}

function ResultCard({ card, width }: { card: Card; width: number }) {
  switch (card.kind) {
    case "book":
      return <BookCard book={card.item} width={width} />;
    case "podcast":
      return <ShowCard show={card.item} width={width} />;
    case "artist":
      return <ArtistCard artist={card.item} width={width} />;
    case "album":
      return <AlbumCard album={card.item} width={width} />;
    case "poster": {
      const p = card.item;
      return <PosterCard item={p} width={width} onPress={() => (p.kind === "movie" ? openMovie(p.id) : openTvShow(p.id))} />;
    }
  }
}

/** The last few searches, newest first; a tap searches again, the X forgets one. */
function RecentSearches({ recent }: { recent: string[] }) {
  const t = useTheme();
  if (!recent.length) return null;
  return (
    <View>
      <SectionTitle title="Recent" />
      {recent.map((r) => (
        <View key={r} style={{ flexDirection: "row", alignItems: "center", minHeight: 52, borderBottomWidth: 1, borderBottomColor: t.line }}>
          <Pressable accessibilityRole="button" accessibilityHint="Searches again" onPress={() => searchText.set(r)} style={{ flex: 1, justifyContent: "center", alignSelf: "stretch" }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ color: t.text2 }}>
              {r}
            </Text>
          </Pressable>
          <IconButton label={`Forget ${r}`} onPress={() => forgetSearch(r)} style={{ marginRight: -10 }}>
            <CloseIcon size={18} color={t.muted} />
          </IconButton>
        </View>
      ))}
    </View>
  );
}
