import { useState } from "react";
import { FlatList, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { type AlbumSummary, type BookSummary, bookIssues, LIBRARY_LISTS, type LibraryList } from "@murmur/shared/client";
import { BookCard } from "@/components/book-card";
import { GAP, gridRows, PAD, useGridWidth } from "@/components/library";
import { BookEditSheet } from "@/components/book-edit";
import { AlbumMatchSheet } from "@/components/match";
import { MatchAllBar, MatchAllProgress, MatchAllRows, MatchAllStart, useMatchAll } from "@/components/match-all";
import { BottomMiniPlayer } from "@/components/mini-player";
import { AlbumCard } from "@/components/music";
import { BackRow, Empty, PageTitle, useBottomPad, useTopInset } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { CoverGridBones, FadeIn, Skeleton, useJustLoaded } from "@/components/skeleton";
import { useAlbums, useBooks } from "@/lib/data";
import { useTheme } from "@/theme";

const LIST_TEXT: Record<LibraryList, { title: string; sub: string; empty: string }> = {
  attention: { title: "Needs attention", sub: "Books with no cover, no author or missing files", empty: "Nothing to fix here." },
  unmatched: { title: "Not matched", sub: "Books with no online match yet", empty: "Every book is matched." },
  albums: { title: "Not matched", sub: "Albums with no online match yet", empty: "Every album is matched." },
};

/** One of You > Library's lists for admins, opened from its row. */
export default function LibraryListScreen() {
  const params = useLocalSearchParams<{ list?: string }>();
  const list: LibraryList = LIBRARY_LISTS.find((l) => l === params.list) ?? "attention";
  if (list === "attention") return <AttentionList />;
  return <UnmatchedList kind={list === "albums" ? "albums" : "books"} />;
}

/** One item of a list, mounted only near the screen. */
type Cell = { key: string; node: React.ReactNode };

/** Cards in rows of a grid. */
function gridCells<T extends { id: string }>(list: T[], card: (item: T) => React.ReactNode): Cell[] {
  return gridRows(list).map((row) => ({
    key: row[0]!.id,
    node: <View style={{ flexDirection: "row", columnGap: GAP, marginBottom: 18 }}>{row.map(card)}</View>,
  }));
}

function AttentionList() {
  const width = useGridWidth();
  const books = useBooks();
  const shown = (books.data ?? []).filter((b) => bookIssues(b).length > 0);
  return (
    <ListScreen
      list="attention"
      refresh={books.refetch}
      loading={books.isPending}
      empty={shown.length === 0}
      cells={gridCells(shown, (b) => <BookCard key={b.id} book={b} width={width} sub={bookIssues(b).join(", ")} />)}
    />
  );
}

/** Unmatched books or albums, with Match all over them; once a run starts its results take their place. */
function UnmatchedList({ kind }: { kind: "books" | "albums" }) {
  const width = useGridWidth();
  const books = useBooks();
  const albums = useAlbums("all", kind === "albums");
  const m = useMatchAll(kind);
  // The book stays set while its Edit slides away; `matching` opens and closes it.
  const [book, setBook] = useState<BookSummary | null>(null);
  const [matching, setMatching] = useState(false);
  const [album, setAlbum] = useState<AlbumSummary | null>(null);
  const bookList = kind === "books" ? (books.data ?? []).filter((b) => !b.matched) : [];
  const albumList = kind === "albums" ? (albums.data ?? []).filter((a) => !a.matched) : [];
  const query = kind === "books" ? books : albums;
  // Books whose files are gone can't be matched.
  const matchable = kind === "books" ? bookList.filter((b) => b.missingSince === null).length : albumList.length;
  const count = kind === "books" ? bookList.length : albumList.length;

  // A result's Search opens Match for it; it may have left the list since the run, so look in all of them.
  const search = (id: string) => {
    if (kind === "books") {
      setBook(books.data?.find((b) => b.id === id) ?? null);
      setMatching(true);
    }
    else setAlbum(albums.data?.find((a) => a.id === id) ?? null);
  };

  return (
    <ListScreen
      list={kind === "books" ? "unmatched" : "albums"}
      refresh={query.refetch}
      loading={query.isPending || !m.loaded}
      empty={!m.job && count === 0}
      head={
        <>
          <MatchAllStart m={m} unmatched={matchable} />
          <MatchAllProgress m={m} />
        </>
      }
      bar={m.job ? <MatchAllBar m={m} /> : null}
      after={
        <>
          {book ? <BookEditSheet bookId={book.id} title={book.title} tab={matching ? "match" : null} onClose={() => setMatching(false)} /> : null}
          <AlbumMatchSheet album={album} onClose={() => setAlbum(null)} />
        </>
      }
      cells={
        m.job
          ? [{ key: "results", node: <MatchAllRows m={m} onSearch={search} /> }]
          : kind === "books"
            ? gridCells(bookList, (b) => <BookCard key={b.id} book={b} width={width} />)
            : gridCells(albumList, (a) => <AlbumCard key={a.id} album={a} width={width} />)
      }
    />
  );
}

/**
 * The lists' screen: the back row, title and sub line, then `head`, `bar` (which sticks to the
 * top as the list scrolls) and the cells. The bar is the list's first cell, since only cells can stick.
 */
function ListScreen({
  list,
  refresh,
  loading,
  empty,
  head,
  bar,
  after,
  cells,
}: {
  list: LibraryList;
  refresh: () => Promise<unknown>;
  loading: boolean;
  empty: boolean;
  head?: React.ReactNode;
  bar?: React.ReactNode;
  after?: React.ReactNode;
  cells: Cell[];
}) {
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  const pull = usePullRefresh(refresh);
  const fade = useJustLoaded(!loading);
  const { title, sub, empty: emptyText } = LIST_TEXT[list];
  const data: Cell[] = loading
    ? [{ key: "loading", node: <Skeleton><CoverGridBones count={6} /></Skeleton> }]
    : empty
      ? [{ key: "empty", node: <Empty>{emptyText}</Empty> }]
      : [...(bar ? [{ key: "bar", node: bar }] : []), ...cells];
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={data}
        keyExtractor={(c) => c.key}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: bottom }}
        refreshControl={pull}
        // Index 0 is the header.
        stickyHeaderIndices={bar && !loading ? [1] : undefined}
        ListHeaderComponent={
          <View>
            <View style={{ marginBottom: 12 }}>
              <BackRow />
              <PageTitle title={title} sub={sub} />
            </View>
            {loading ? null : head}
          </View>
        }
        windowSize={7}
        maxToRenderPerBatch={8}
        renderItem={({ item }) => (item.key === "bar" ? <>{item.node}</> : <FadeIn when={fade}>{item.node}</FadeIn>)}
      />
      <BottomMiniPlayer />
      {after}
    </View>
  );
}
