import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import {
  apiPaths,
  type BookSort,
  type BookSummary,
  bySeriesOrder,
  continueListening,
  groupBy,
  SHELF_SIZE,
  SHELF_TITLES,
  shelfBooks,
  matchesBook,
  seriesLabel,
  sortBooks,
  timeLeft,
} from "@murmur/shared/client";
import { BookCard, progressPct } from "@/components/book-card";
import { Cover } from "@/components/cover";
import { CloseIcon, FilterIcon, SearchIcon } from "@/components/icons";
import { Empty, PageTitle, SectionTitle, useTopInset } from "@/components/page";
import { Sheet, SheetItem } from "@/components/sheet";
import { CoverGridBones, FadeIn, SectionBone, Skeleton, useJustLoaded } from "@/components/skeleton";
import { Grid, Group, openGroup, openShelf, PAD, shelfSub, todayKey, useGridWidth } from "@/components/library";
import { Bar, Chip, IconButton, Text } from "@/components/ui";
import { useBooks } from "@/lib/data";
import { useDownloads } from "@/lib/downloads";
import { getJson, setJson } from "@/lib/storage";
import { fonts, useTheme } from "@/theme";

type Tab = "books" | "authors" | "series" | "finished" | "downloaded";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "books", label: "Books" },
  { id: "authors", label: "Authors" },
  { id: "series", label: "Series" },
  { id: "finished", label: "Finished" },
  { id: "downloaded", label: "Downloaded" },
];

const SORTS: Array<{ id: BookSort; label: string }> = [
  { id: "added", label: "Recently added" },
  { id: "listened", label: "Recently listened" },
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
];

const SORT_KEY = "murmur.librarySort";
/** Shelves under Continue listening on the Books tab, in order. */
const HOME_SHELVES = ["next", "added", "unstarted"] as const;
const GAP = 14;
export default function Library() {
  const t = useTheme();
  const top = useTopInset();
  const cardWidth = useGridWidth();
  const books = useBooks();
  const downloads = useDownloads();
  const [tab, setTab] = useState<Tab>("books");
  const [sort, setSortState] = useState<BookSort>(() => getJson<BookSort>(SORT_KEY) ?? "added");
  const [sortOpen, setSortOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const fade = useJustLoaded(!books.isPending);

  const list = useMemo(() => books.data ?? [], [books.data]);
  const sorted = useMemo(() => sortBooks(list, sort), [list, sort]);
  const continuing = useMemo(() => continueListening(list), [list]);
  const day = todayKey();
  const shelves = useMemo(() => HOME_SHELVES.map((id) => ({ id, books: shelfBooks(id, list, day) })), [list, day]);
  const q = query.trim().toLowerCase();

  const setSort = (s: BookSort) => {
    setSortState(s);
    setJson(SORT_KEY, s);
    setSortOpen(false);
  };

  const header = (
    <View style={{ paddingTop: top }}>
      <PageTitle
        title="Library"
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
            <IconButton label="Sort" onPress={() => setSortOpen(true)}>
              <FilterIcon color={t.text} />
            </IconButton>
          </>
        }
      />
      {searching ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            height: 48,
            paddingHorizontal: 14,
            borderRadius: 14,
            backgroundColor: t.surface,
            marginBottom: 12,
          }}
        >
          <SearchIcon size={20} color={t.muted} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Title, author, narrator or series"
            placeholderTextColor={t.faint}
            selectionColor={t.accent}
            style={{ flex: 1, color: t.text, fontFamily: fonts.medium, fontSize: 15 }}
          />
        </View>
      ) : null}
      {!q ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -PAD }}>
          <View style={{ width: PAD - 8 }} />
          {TABS.map((x) => (
            <Chip key={x.id} label={x.label} selected={tab === x.id} onPress={() => setTab(x.id)} />
          ))}
          <View style={{ width: PAD - 8 }} />
        </ScrollView>
      ) : null}
    </View>
  );

  const refresh = <RefreshControl refreshing={books.isRefetching} onRefresh={() => void books.refetch()} tintColor={t.accent} colors={[t.accent]} />;

  if (books.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingHorizontal: PAD }}>
        {header}
        <Skeleton>
          <SectionBone />
          <CoverGridBones />
        </Skeleton>
      </View>
    );
  }

  let body: React.ReactNode;
  if (books.isError && list.length === 0) {
    body = <Empty title="Couldn't load your library">{books.error.message}</Empty>;
  } else if (list.length === 0) {
    body = <Empty title="No books yet" />;
  } else if (q) {
    const found = sorted.filter((b) => matchesBook(b, q));
    body = found.length ? (
      <View style={{ marginTop: 8 }}>
        <Grid>
          {found.map((b) => (
            <BookCard key={b.id} book={b} width={cardWidth} sub={seriesLabel(b.series, b.seriesPosition) ?? b.author} />
          ))}
        </Grid>
      </View>
    ) : (
      <Empty>No results.</Empty>
    );
  } else if (tab === "books") {
    // Long libraries scroll in a virtualised list of rows of three.
    const rows: BookSummary[][] = [];
    for (let i = 0; i < sorted.length; i += 3) rows.push(sorted.slice(i, i + 3));
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <FlatList
          data={rows}
          keyExtractor={(r) => r[0]!.id}
          contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }}
          refreshControl={refresh}
          ListHeaderComponent={
            <>
              {header}
              <FadeIn when={fade}>
                {continuing.length ? (
                  <Group title={SHELF_TITLES.continue} count={continuing.length} onOpen={() => openShelf("continue")}>
                    {continuing.slice(0, SHELF_SIZE).map((b) => (
                      <ContinueCard key={b.id} book={b} />
                    ))}
                  </Group>
                ) : null}
                {shelves.map(({ id, books: shelf }) =>
                  shelf.length ? (
                    <Group key={id} title={SHELF_TITLES[id]} count={shelf.length} onOpen={() => openShelf(id)}>
                      {shelf.slice(0, SHELF_SIZE).map((b) => (
                        <BookCard key={b.id} book={b} width={cardWidth} sub={shelfSub(id, b)} />
                      ))}
                    </Group>
                  ) : null,
                )}
                <SectionTitle title="All books" count={list.length} />
              </FadeIn>
            </>
          }
          ItemSeparatorComponent={RowGap}
          // Fewer offscreen rows kept than the default 10 screens each way; covers are cached anyway.
          windowSize={7}
          maxToRenderPerBatch={6}
          renderItem={({ item }) => (
            <FadeIn when={fade} style={{ flexDirection: "row", columnGap: GAP }}>
              {item.map((b) => (
                <BookCard key={b.id} book={b} width={cardWidth} />
              ))}
            </FadeIn>
          )}
        />
        <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} sort={sort} onSort={setSort} />
      </View>
    );
  } else if (tab === "authors") {
    body = groupBy(list, (b) => b.author).map(([name, items]) => (
      <Group key={name} title={name} count={items.length} onOpen={() => openGroup({ author: name })}>
        {sortBooks(items, "author").map((b) => (
          <BookCard key={b.id} book={b} width={cardWidth} sub={seriesLabel(b.series, b.seriesPosition) ?? null} />
        ))}
      </Group>
    ));
  } else if (tab === "series") {
    const groups = groupBy(list, (b) => b.series);
    body = groups.length ? (
      groups.map(([name, items]) => {
        const ordered = [...items].sort(bySeriesOrder);
        const done = items.filter((b) => b.progress?.finished).length;
        return (
          <Group
            key={name}
            title={name}
            count={items.length}
            sub={ordered[0]?.author}
            side={done ? `${done} finished` : null}
            onOpen={() => openGroup({ series: name })}
          >
            {ordered.map((b) => (
              <BookCard key={b.id} book={b} width={cardWidth} sub={b.seriesPosition !== null ? `Book ${b.seriesPosition}` : b.author} />
            ))}
          </Group>
        );
      })
    ) : (
      <Empty>No series yet.</Empty>
    );
  } else {
    const shown =
      tab === "finished"
        ? [...list].filter((b) => b.progress?.finished).sort((a, b) => b.progress!.updatedAt - a.progress!.updatedAt)
        : sorted.filter((b) => downloads[`book:${b.id}`]);
    body = shown.length ? (
      <View style={{ marginTop: 20 }}>
        <Grid>
          {shown.map((b) => (
            <BookCard key={b.id} book={b} width={cardWidth} />
          ))}
        </Grid>
      </View>
    ) : (
      <Empty>{tab === "finished" ? "No finished books yet." : "No downloaded books yet."}</Empty>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }} refreshControl={refresh} keyboardShouldPersistTaps="handled">
        {header}
        <FadeIn when={fade}>{body}</FadeIn>
      </ScrollView>
      <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} sort={sort} onSort={setSort} />
    </View>
  );

}

// Defined once: an inline component here would be a new type each render, remounting every gap.
const RowGap = () => <View style={{ height: 18 }} />;

function SortSheet({ open, onClose, sort, onSort }: { open: boolean; onClose: () => void; sort: BookSort; onSort: (s: BookSort) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Sort books">
      {SORTS.map((s) => (
        <SheetItem key={s.id} label={s.label} active={sort === s.id} onPress={() => onSort(s.id)} />
      ))}
    </Sheet>
  );
}

function ContinueCard({ book }: { book: BookSummary }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={book.title}
      onPress={() => router.push(`/book/${book.id}`)}
      style={({ pressed }) => ({ width: 150, gap: 8, opacity: pressed ? 0.75 : 1 })}
    >
      <Cover path={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 600) : null} title={book.title} color={book.coverColor} radius={12} />
      <Bar pct={progressPct(book)} height={4} />
      <Text variant="small">{timeLeft(book.durationSec, book.progress!.positionSec)}</Text>
    </Pressable>
  );
}
