import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { type AlbumSummary, type BookSummary, bookIssues } from "@murmur/shared/client";
import { BookCard } from "@/components/book-card";
import { Grid, PAD, useGridWidth } from "@/components/library";
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

type LibraryList = "attention" | "unmatched" | "albums";

const LIBRARY_LISTS: Record<LibraryList, { title: string; sub: string; empty: string }> = {
  attention: { title: "Needs attention", sub: "Books with no cover, no author or missing files", empty: "Nothing to fix here." },
  unmatched: { title: "Not matched", sub: "Books with no online match yet", empty: "Every book is matched." },
  albums: { title: "Not matched", sub: "Albums with no online match yet", empty: "Every album is matched." },
};

/** One of You > Library's lists for admins, opened from its row. */
export default function LibraryListScreen() {
  const params = useLocalSearchParams<{ list?: string }>();
  const list: LibraryList = params.list === "unmatched" || params.list === "albums" ? params.list : "attention";
  if (list === "attention") return <AttentionList />;
  return <UnmatchedList kind={list === "albums" ? "albums" : "books"} />;
}

function AttentionList() {
  const width = useGridWidth();
  const books = useBooks();
  const shown = (books.data ?? []).filter((b) => bookIssues(b).length > 0);
  return (
    <ListScreen list="attention" refresh={books.refetch} loading={books.isPending} empty={shown.length === 0}>
      <Grid>
        {shown.map((b) => (
          <BookCard key={b.id} book={b} width={width} sub={bookIssues(b).join(", ")} />
        ))}
      </Grid>
    </ListScreen>
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
    >
      {m.job ? (
        <MatchAllRows m={m} onSearch={search} />
      ) : (
        <Grid>
          {kind === "books"
            ? bookList.map((b) => <BookCard key={b.id} book={b} width={width} />)
            : albumList.map((a) => <AlbumCard key={a.id} album={a} width={width} />)}
        </Grid>
      )}
    </ListScreen>
  );
}

/**
 * The lists' screen: the back row, title and sub line, then `head`, `bar` (which sticks to the
 * top as the list scrolls) and the list. Its own scroll view, since the bar needs to be one of
 * the scroll view's direct children to stick.
 */
function ListScreen({
  list,
  refresh,
  loading,
  empty,
  head,
  bar,
  after,
  children,
}: {
  list: LibraryList;
  refresh: () => Promise<unknown>;
  loading: boolean;
  empty: boolean;
  head?: React.ReactNode;
  bar?: React.ReactNode;
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  const pull = usePullRefresh(refresh);
  const fade = useJustLoaded(!loading);
  const { title, sub, empty: emptyText } = LIBRARY_LISTS[list];
  const body = loading ? (
    <Skeleton>
      <CoverGridBones count={6} />
    </Skeleton>
  ) : empty ? (
    <Empty>{emptyText}</Empty>
  ) : (
    <FadeIn when={fade}>{children}</FadeIn>
  );
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: bottom }}
        refreshControl={pull}
        stickyHeaderIndices={bar && !loading ? [2] : undefined}
      >
        <View style={{ marginBottom: 12 }}>
          <BackRow />
          <PageTitle title={title} sub={sub} />
        </View>
        <View>{loading ? null : head}</View>
        {bar && !loading ? bar : <View />}
        {body}
      </ScrollView>
      <BottomMiniPlayer />
      {after}
    </View>
  );
}
