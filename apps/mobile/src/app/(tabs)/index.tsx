import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import Animated, { FadeIn as EnterFade, LayoutAnimationConfig } from "react-native-reanimated";
import {
  apiPaths,
  BOOK_SECTION_TITLES,
  type BookSection,
  type BookSectionId,
  type BookSummary,
  bySeriesOrder,
  continueListening,
  emptyLibraryReason,
  groupBy,
  nextInSeriesSub,
  progressPct,
  SHELF_SIZE,
  type ShelfId,
  shelfBooks,
  shelfSub,
  matchesBook,
  seriesLabel,
  sortBooks,
  timeLeft,
} from "@murmur/shared/client";
import { BookActions, BookCard } from "@/components/book-card";
import { Cover } from "@/components/cover";
import { Mixer, useNowPlaying } from "@/components/mixer";
import { CloseIcon, CustomizeIcon, DragIcon, FilterIcon, SearchIcon } from "@/components/icons";
import { Empty, PageTitle, useTopInset } from "@/components/page";
import { SmallButton, useHealth } from "@/components/settings";
import { BookSortSheet, useBookSort } from "@/components/book-sort";
import { usePullRefresh } from "@/components/pull-refresh";
import { CoverGridBones, FadeIn, SectionBone, Skeleton, useJustLoaded } from "@/components/skeleton";
import { useCardMenu } from "@/components/sheet";
import { DragHandle, SortableList, SortableScrollProvider, useSortableScroll } from "@/components/sortable-list";
import { GAP, Grid, Group, openAllBooks, openGroup, openShelf, PAD, safeShelf, safeShelfTitle, Shelf, todayKey, useGridWidth, useShelfWidth } from "@/components/library";
import { Bar, Button, Chips, CountPill, IconButton, Text } from "@/components/ui";
import { saveBookSections, useBookSections, useBooks } from "@/lib/data";
import { withLongPressHaptic } from "@/lib/haptics";
import { isCurrent } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

type Tab = "books" | "authors" | "series" | "finished";

const TABS: { id: Tab; label: string }[] = [
  { id: "books", label: "Books" },
  { id: "authors", label: "Authors" },
  { id: "series", label: "Series" },
  { id: "finished", label: "Finished" },
];

export default function Library() {
  const t = useTheme();
  const top = useTopInset();
  const cardWidth = useGridWidth();
  const shelfWidth = useShelfWidth();
  const books = useBooks();
  const [tab, setTab] = useState<Tab>("books");
  const sort = useBookSort();
  const [sortOpen, setSortOpen] = useState(false);
  const refresh = usePullRefresh(books.refetch);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [customizing, setCustomizing] = useState(false);
  const fade = useJustLoaded(!books.isPending);

  const list = useMemo(() => books.data ?? [], [books.data]);
  // Why the library is empty, such as the first scan still running.
  const health = useHealth(books.isSuccess && list.length === 0).data;
  const sorted = useMemo(() => sortBooks(list, sort), [list, sort]);
  const q = query.trim().toLowerCase();

  const groups = useMemo((): BookGroup[] => {
    if (tab === "authors") {
      return groupBy(list, (b) => b.author).map(([name, items]) => ({
        name,
        books: sortBooks(items, "author"),
        open: () => openGroup({ author: name }),
        cardSub: (b) => seriesLabel(b.series, b.seriesPosition) ?? null,
      }));
    }
    if (tab === "series") {
      return groupBy(list, (b) => b.series).map(([name, items]) => {
        const ordered = [...items].sort(bySeriesOrder);
        const done = items.filter((b) => b.progress?.finished).length;
        return {
          name,
          books: ordered,
          sub: ordered[0]?.author,
          side: done ? `${done} finished` : null,
          open: () => openGroup({ series: name }),
          cardSub: nextInSeriesSub,
        };
      });
    }
    return [];
  }, [list, tab]);

  const finishedRows = useMemo(() => {
    if (tab !== "finished") return [];
    const shown = list.filter((b) => b.progress?.finished).sort((a, b) => b.progress!.updatedAt - a.progress!.updatedAt);
    const rows: BookSummary[][] = [];
    for (let i = 0; i < shown.length; i += 3) rows.push(shown.slice(i, i + 3));
    return rows;
  }, [list, tab]);


  const header = (
    <View style={{ paddingTop: top }}>
      <PageTitle
        title="Books"
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
          <Chips
            gap={8}
            options={TABS}
            value={tab}
            onPick={(id) => {
              setTab(id);
              setCustomizing(false);
            }}
          />
          <View style={{ width: PAD - 8 }} />
        </ScrollView>
      ) : null}
    </View>
  );


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
    body = <Empty title="No books yet">{health ? emptyLibraryReason(health.scan) : null}</Empty>;
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
      <Empty>{`Nothing matches "${query.trim()}".`}</Empty>
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
        <BookSortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
      </View>
    );
  } else if ((tab === "authors" || tab === "series") && groups.length) {
    // One item per author or series: its heading and its sideways shelf.
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <VirtualList
          header={header}
          data={groups}
          keyOf={(g) => g.name}
          fade={fade}
          refresh={refresh}
          render={(g) => (
            <Group title={g.name} count={g.books.length} sub={g.sub} side={g.side} onOpen={g.open}>
              {g.books.map((b) => (
                <BookCard key={b.id} book={b} width={shelfWidth} sub={g.cardSub(b)} />
              ))}
            </Group>
          )}
        />
        <BookSortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
      </View>
    );
  } else if (tab === "finished" && finishedRows.length) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <VirtualList
          header={
            <>
              {header}
              <View style={{ height: 20 }} />
            </>
          }
          data={finishedRows}
          keyOf={(r) => r[0]!.id}
          fade={fade}
          refresh={refresh}
          separator={RowGap}
          render={(r) => (
            <View style={{ flexDirection: "row", columnGap: GAP }}>
              {r.map((b) => (
                <BookCard key={b.id} book={b} width={cardWidth} />
              ))}
            </View>
          )}
        />
        <BookSortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
      </View>
    );
  } else {
    body = tab === "authors" ? null : <Empty>{tab === "finished" ? "No finished books yet." : "No series yet."}</Empty>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }} refreshControl={refresh} keyboardShouldPersistTaps="handled">
        {header}
        <FadeIn when={fade}>{body}</FadeIn>
      </ScrollView>
      <BookSortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
    </View>
  );

}

// Defined once: an inline component here would be a new type each render, remounting every gap.
const RowGap = () => <View style={{ height: 18 }} />;

/** An author's or series' books, shown as a heading over a sideways shelf. */
type BookGroup = {
  name: string;
  books: BookSummary[];
  sub?: string | null;
  side?: string | null;
  open: () => void;
  cardSub: (b: BookSummary) => string | null;
};

/**
 * A virtualised list under the page header, so long libraries only mount the rows near the
 * screen. Used by the Authors, Series and Finished views.
 */
function VirtualList<T>({
  header,
  data,
  keyOf,
  render,
  fade,
  refresh,
  separator,
}: {
  header: React.ReactElement;
  data: T[];
  keyOf: (item: T) => string;
  render: (item: T) => React.ReactNode;
  fade: boolean;
  refresh: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
  separator?: React.ComponentType;
}) {
  return (
    <FlatList
      data={data}
      keyExtractor={keyOf}
      contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }}
      refreshControl={refresh}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ItemSeparatorComponent={separator}
      windowSize={7}
      maxToRenderPerBatch={6}
      renderItem={({ item }) => <FadeIn when={fade}>{render(item)}</FadeIn>}
    />
  );
}

/**
 * The Books tab: its shelves in your saved order, All books among them showing its first few;
 * hidden sections and empty shelves aren't shown.
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
  const cardWidth = useShelfWidth();
  const sections = useBookSections();
  const { scroll, props: scrollProps } = useSortableScroll<Animated.ScrollView>();
  const day = todayKey();
  const continuing = useMemo(() => continueListening(books), [books]);
  const shelves = useMemo(
    () => ({
      playnext: shelfBooks("playnext", books, day),
      next: shelfBooks("next", books, day),
      like: safeShelf("like", books, day),
      short: safeShelf("short", books, day),
      added: shelfBooks("added", books, day),
      unstarted: shelfBooks("unstarted", books, day),
    }),
    [books, day],
  );
  const likeTitle = useMemo(() => safeShelfTitle("like", books), [books]);
  const counts: Record<BookSectionId, number> = {
    continue: continuing.length,
    playnext: shelves.playnext.length,
    next: shelves.next.length,
    like: shelves.like.length,
    short: shelves.short.length,
    added: shelves.added.length,
    unstarted: shelves.unstarted.length,
    all: books.length,
  };

  /** A section's cards, or null when it has none. All books shows its first few; the heading opens the rest. */
  const cards = (id: BookSectionId): React.ReactNode => {
    if (id === "all") {
      return sorted.length ? (
        <Shelf>
          {sorted.slice(0, SHELF_SIZE).map((b) => (
            <BookCard key={b.id} book={b} width={cardWidth} />
          ))}
        </Shelf>
      ) : null;
    }
    if (id === "continue") {
      return continuing.length ? (
        <Shelf>
          {continuing.slice(0, SHELF_SIZE).map((b) => (
            <ContinueCard key={b.id} book={b} width={Math.round(cardWidth * 1.15)} />
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

  // Which sections have anything, without building their cards just to find out.
  const hasCards = (id: BookSectionId) => (id === "all" ? sorted.length : id === "continue" ? continuing.length : shelves[id].length) > 0;
  const shown = sections.filter((s) => !s.hidden && hasCards(s.id));

  // Shown sections are the same rows in both modes, so their covers stay mounted (and on
  // screen) when customize opens and closes.
  const section = (s: BookSection) => {
    const title = s.id === "like" ? likeTitle : BOOK_SECTION_TITLES[s.id];
    return (
      <View style={{ paddingTop: 24 }}>
        <SectionHeading
          title={title}
          count={counts[s.id]}
          faint={customizing && s.hidden}
          onOpen={customizing ? undefined : s.id === "all" ? openAllBooks : () => openShelf(s.id as ShelfId)}
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
        {/* Fades in on Show, not when customize opens or closes. Hide removes it at once: a fade
            out would linger over the rows below as they glide up into its space. */}
        <LayoutAnimationConfig skipEntering skipExiting>
          {s.hidden ? null : (
            <Animated.View entering={EnterFade.duration(220)}>
              {cards(s.id) ?? <Text variant="small">Nothing here right now.</Text>}
            </Animated.View>
          )}
        </LayoutAnimationConfig>
      </View>
    );
  };

  return (
    <SortableScrollProvider value={scroll}>
      <Animated.ScrollView {...scrollProps} contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }} refreshControl={refresh}>
        {header}
        <FadeIn when={fade}>
          <SortableList
            items={customizing ? sections : shown}
            keyOf={(s) => s.id}
            onReorder={reorder}
            liftInset={16}
            locked={!customizing}
            renderRow={section}
          />
          {!customizing && sections.every((s) => s.hidden) ? (
            <View style={{ alignItems: "center", paddingVertical: 48, gap: 14 }}>
              <Text variant="bodyStrong">Everything here is hidden</Text>
              <Button label="Customize" kind="secondary" onPress={onCustomize} style={{ paddingHorizontal: 24 }} />
            </View>
          ) : null}
        </FadeIn>
      </Animated.ScrollView>
    </SortableScrollProvider>
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


/** A book in progress: a little bigger than the shelf covers, so it stands out at the top. */
function ContinueCard({ book, width }: { book: BookSummary; width: number }) {
  const t = useTheme();
  const now = useNowPlaying((s) => isCurrent(s, "book", book.id));
  const menu = useCardMenu();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={book.title}
      accessibilityActions={[{ name: "longpress", label: "Options" }]}
      onAccessibilityAction={menu.show}
      onPress={() => router.push(`/book/${book.id}`)}
      onLongPress={withLongPressHaptic(menu.show)}
      style={({ pressed }) => ({ width, gap: 8, opacity: pressed ? 0.75 : 1 })}
    >
      {menu.shown ? <BookActions book={book} open={menu.open} onClose={menu.close} onIdle={menu.idle} /> : null}
      <View>
        <Cover path={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 600) : null} title={book.title} color={book.coverColor} radius={12} />
        {now ? <Mixer playing={now === "playing"} /> : null}
      </View>
      <Bar pct={progressPct(book)} height={4} />
      <View>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14, color: now ? t.accent : t.text }}>
          {book.title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {book.author ?? "Unknown author"}
        </Text>
        <Text variant="small">{timeLeft(book.durationSec, book.progress!.positionSec)}</Text>
      </View>
    </Pressable>
  );
}
