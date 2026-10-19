import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import Animated, { FadeIn as EnterFade, FadeOut as ExitFade, LayoutAnimationConfig } from "react-native-reanimated";
import {
  apiPaths,
  BOOK_SECTION_TITLES,
  type BookSection,
  type BookSectionId,
  type BookSort,
  type BookSummary,
  bySeriesOrder,
  continueListening,
  groupBy,
  SHELF_SIZE,
  type ShelfId,
  shelfBooks,
  matchesBook,
  seriesLabel,
  sortBooks,
  timeLeft,
} from "@murmur/shared/client";
import { BookCard, progressPct } from "@/components/book-card";
import { Cover } from "@/components/cover";
import { CloseIcon, CustomizeIcon, DragIcon, FilterIcon, SearchIcon } from "@/components/icons";
import { Empty, PageTitle, useTopInset } from "@/components/page";
import { SmallButton } from "@/components/settings";
import { Sheet, SheetItem } from "@/components/sheet";
import { CoverGridBones, FadeIn, SectionBone, Skeleton, useJustLoaded } from "@/components/skeleton";
import { DragHandle, SortableList, SortableScrollProvider, useSortableScroll } from "@/components/sortable-list";
import { Grid, Group, openGroup, openShelf, PAD, Shelf, shelfSub, todayKey, useGridWidth } from "@/components/library";
import { Bar, Button, Chip, CountPill, IconButton, Text } from "@/components/ui";
import { saveBookSections, useBookSections, useBooks } from "@/lib/data";
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
  const [customizing, setCustomizing] = useState(false);
  const fade = useJustLoaded(!books.isPending);

  const list = useMemo(() => books.data ?? [], [books.data]);
  const sorted = useMemo(() => sortBooks(list, sort), [list, sort]);
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
            {tab === "books" ? (
              <IconButton
                label={customizing ? "Done customizing" : "Customize"}
                accessibilityState={{ selected: customizing }}
                onPress={() => {
                  setCustomizing((c) => !c);
                  setSearching(false);
                  setQuery("");
                }}
                style={customizing ? { backgroundColor: t.accent, borderRadius: 22 } : undefined}
              >
                <CustomizeIcon color={customizing ? t.onAccent : t.text} />
              </IconButton>
            ) : null}
            <IconButton
              label={searching ? "Close search" : "Search"}
              onPress={() => {
                setSearching((s) => !s);
                setQuery("");
                setCustomizing(false);
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
            <Chip
              key={x.id}
              label={x.label}
              selected={tab === x.id}
              onPress={() => {
                setTab(x.id);
                setCustomizing(false);
              }}
            />
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
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <BooksTab
          header={header}
          books={list}
          sorted={sorted}
          fade={fade}
          refresh={refresh}
          customizing={customizing}
          onCustomize={() => setCustomizing(true)}
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

/**
 * The Books tab: its sections in your saved order. Normally All books is the virtualised grid
 * and the shelves sit above and below it; hidden sections and empty shelves aren't shown.
 * Customizing keeps the same sections in place, shows hidden and empty ones as headings, and
 * adds Hide/Show and a handle to drag each into order. Changes save straight away.
 */
function BooksTab({
  header,
  books,
  sorted,
  fade,
  refresh,
  customizing,
  onCustomize,
}: {
  header: React.ReactNode;
  books: BookSummary[];
  sorted: BookSummary[];
  fade: boolean;
  refresh: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
  customizing: boolean;
  onCustomize: () => void;
}) {
  const t = useTheme();
  const cardWidth = useGridWidth();
  const sections = useBookSections();
  const { scroll, props: scrollProps } = useSortableScroll<Animated.FlatList<BookSummary[]>>();
  const day = todayKey();
  const continuing = useMemo(() => continueListening(books), [books]);
  const shelves = useMemo(
    () => ({ next: shelfBooks("next", books, day), added: shelfBooks("added", books, day), unstarted: shelfBooks("unstarted", books, day) }),
    [books, day],
  );
  const counts: Record<BookSectionId, number> = {
    continue: continuing.length,
    next: shelves.next.length,
    added: shelves.added.length,
    unstarted: shelves.unstarted.length,
    all: books.length,
  };

  /** A section's cards, or null when it has none. All books is only drawn here while customizing. */
  const cards = (id: BookSectionId): React.ReactNode => {
    if (id === "all") {
      return (
        <Grid>
          {sorted.map((b) => (
            <BookCard key={b.id} book={b} width={cardWidth} />
          ))}
        </Grid>
      );
    }
    if (id === "continue") {
      return continuing.length ? (
        <Shelf>
          {continuing.slice(0, SHELF_SIZE).map((b) => (
            <ContinueCard key={b.id} book={b} />
          ))}
        </Shelf>
      ) : null;
    }
    const list = shelves[id];
    return list.length ? (
      <Shelf>
        {list.slice(0, SHELF_SIZE).map((b) => (
          <BookCard key={b.id} book={b} width={cardWidth} sub={shelfSub(id, b)} />
        ))}
      </Shelf>
    ) : null;
  };

  const toggle = (id: BookSectionId) => saveBookSections(sections.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s)));
  const reorder = (keys: string[]) => saveBookSections(keys.map((k) => sections.find((s) => s.id === k)!));

  const list = (data: BookSummary[][], top: React.ReactElement, bottom?: React.ReactElement) => (
    <SortableScrollProvider value={scroll}>
      <Animated.FlatList
        {...scrollProps}
        data={data}
        keyExtractor={(r) => r[0]!.id}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }}
        refreshControl={refresh}
        ListHeaderComponent={
          <>
            {header}
            {top}
          </>
        }
        ListFooterComponent={bottom}
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
    </SortableScrollProvider>
  );

  // Long libraries scroll in a virtualised list of rows of three, so normally All books is the
  // list's data and the shelves before and after it are its header and footer. Customizing
  // draws every section in the header instead, all books as a full grid.
  const shown = sections.filter((s) => !s.hidden && (s.id === "all" ? books.length > 0 : cards(s.id) !== null));
  const allAt = shown.findIndex((s) => s.id === "all");
  const before = allAt < 0 ? shown : shown.slice(0, allAt);
  const after = allAt < 0 ? [] : shown.slice(allAt + 1);
  const rows: BookSummary[][] = [];
  if (allAt >= 0 && !customizing) for (let i = 0; i < sorted.length; i += 3) rows.push(sorted.slice(i, i + 3));

  const shelf = (id: BookSectionId) => (
    <View key={id} style={{ paddingTop: 24 }}>
      <SectionHeading title={BOOK_SECTION_TITLES[id]} count={counts[id]} onOpen={() => openShelf(id as ShelfId)} />
      {cards(id)}
    </View>
  );

  // The shelves above All books are the same rows in both modes, so their covers stay mounted
  // (and on screen) when customize opens and closes.
  const section = (s: BookSection) => {
    const title = BOOK_SECTION_TITLES[s.id];
    return (
      <View style={{ paddingTop: 24 }}>
        <SectionHeading
          title={title}
          count={counts[s.id]}
          faint={customizing && s.hidden}
          onOpen={customizing || s.id === "all" ? undefined : () => openShelf(s.id as ShelfId)}
          actions={
            customizing ? (
              <>
                <SmallButton label={s.hidden ? "Show" : "Hide"} onPress={() => toggle(s.id)} />
                <DragHandle label={`Reorder ${title}`}>
                  <DragIcon size={22} color={t.faint} />
                </DragHandle>
              </>
            ) : undefined
          }
        />
        {/* Fades only on Hide and Show, not when customize opens or closes. */}
        <LayoutAnimationConfig skipEntering skipExiting>
          {s.hidden ? null : (
            <Animated.View entering={EnterFade.duration(220)} exiting={ExitFade.duration(150)}>
              {cards(s.id) ?? <Text variant="small">Nothing here right now.</Text>}
            </Animated.View>
          )}
        </LayoutAnimationConfig>
      </View>
    );
  };

  return list(
    rows,
    <FadeIn when={fade}>
      <SortableList
        items={customizing ? sections : before}
        keyOf={(s) => s.id}
        onReorder={reorder}
        liftInset={16}
        locked={!customizing}
        renderRow={section}
      />
      {allAt >= 0 && !customizing ? (
        <View style={{ paddingTop: 24 }}>
          <SectionHeading title={BOOK_SECTION_TITLES.all} count={counts.all} />
        </View>
      ) : null}
      {!customizing && sections.every((s) => s.hidden) ? (
        <View style={{ alignItems: "center", paddingVertical: 48, gap: 14 }}>
          <Text variant="bodyStrong">Everything here is hidden</Text>
          <Button label="Customize" kind="secondary" onPress={onCustomize} style={{ paddingHorizontal: 24 }} />
        </View>
      ) : null}
    </FadeIn>,
    after.length && !customizing ? <FadeIn when={fade}>{after.map((s) => shelf(s.id))}</FadeIn> : undefined,
  );
}

/**
 * A Books tab section's title and count. Customize controls sit over its right end, so
 * showing them moves nothing.
 */
function SectionHeading({
  title,
  count,
  faint,
  onOpen,
  actions,
}: {
  title: string;
  count: number;
  faint?: boolean;
  onOpen?: () => void;
  actions?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
      <Pressable
        accessibilityRole={onOpen ? "link" : "header"}
        disabled={!onOpen}
        onPress={onOpen}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}
      >
        <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1, color: faint ? t.faint : t.text }}>
          {title}
        </Text>
        <CountPill count={count} />
      </Pressable>
      {actions ? (
        <Animated.View
          entering={EnterFade.duration(200)}
          style={{ position: "absolute", right: -10, top: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 2 }}
        >
          {actions}
        </Animated.View>
      ) : null}
    </View>
  );
}

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
