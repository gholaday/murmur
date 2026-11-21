import { useMemo, useState } from "react";
import { FlatList, PixelRatio, Pressable, RefreshControl, ScrollView, View } from "react-native";
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
  seriesLabel,
  sortBooks,
  timeLeft,
} from "@murmur/shared/client";
import { BookActions, BookCard } from "@/components/book-card";
import { Cover } from "@/components/cover";
import { Mixer, useNowPlaying } from "@/components/mixer";
import { CustomizeIcon, DragIcon } from "@/components/icons";
import { Empty, LibraryTitle, useTopInset } from "@/components/page";
import { SmallButton, useHealth } from "@/components/settings";
import { useBookSort } from "@/components/book-sort";
import { usePullRefresh } from "@/components/pull-refresh";
import { CoverGridBones, FadeIn, SectionBone, Skeleton, useJustLoaded } from "@/components/skeleton";
import { useCardMenu } from "@/components/sheet";
import { SelectionProvider, useSelection } from "@/components/selection";
import { DragHandle, SortableList, SortableScrollProvider, useSortableScroll } from "@/components/sortable-list";
import { GAP, gridRows, Group, openAllBooks, openGroup, openShelf, PAD, safeShelf, safeShelfTitle, Shelf, todayKey, useGridWidth, useShelfWidth } from "@/components/library";
import { TextTabs, useTabFade } from "@/components/text-tabs";
import { Bar, Button, CountPill, IconButton, Text } from "@/components/ui";
import { saveBookSections, useBookSections, useBooks } from "@/lib/data";
import { librarySection, useSectionJumps } from "@/lib/library";
import { withLongPressHaptic } from "@/lib/haptics";
import { isCurrent } from "@/player/engine";
import { useTheme } from "@/theme";

type Tab = "books" | "authors" | "series" | "finished";

const SHOW_CUSTOMIZE = false;

const TABS: { id: Tab; label: string }[] = [
  { id: "books", label: "Home" },
  { id: "authors", label: "Authors" },
  { id: "series", label: "Series" },
  { id: "finished", label: "Finished" },
];

/** Library's Books section: Home's shelves, Authors, Series and Finished. */
export function BooksSection() {
  const t = useTheme();
  const top = useTopInset();
  const cardWidth = useGridWidth();
  const shelfWidth = useShelfWidth();
  const books = useBooks();
  const [tab, setTab] = useState<Tab>("books");
  // Music or Watch in the title row leaves select mode, like another tab.
  const open = librarySection.useValue() === "books";
  // The All books shelf follows the sort picked on the All books page.
  const sort = useBookSort();
  const refresh = usePullRefresh(books.refetch);
  const [customizing, setCustomizing] = useState(false);
  const fade = useJustLoaded(!books.isPending);
  // A new tab, or a tap on Books in the title row, fades the content in.
  const jumps = useSectionJumps("books");
  const tabFade = useTabFade(`${tab}:${jumps}`, jumps > 0);

  const list = useMemo(() => books.data ?? [], [books.data]);
  // Why the library is empty, such as the first scan still running.
  const health = useHealth(books.isSuccess && list.length === 0).data;
  const sorted = useMemo(() => sortBooks(list, sort), [list, sort]);

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

  const finished = useMemo(
    () => (tab === "finished" ? list.filter((b) => b.progress?.finished).sort((a, b) => b.progress!.updatedAt - a.progress!.updatedAt) : []),
    [list, tab],
  );
  const finishedRows = useMemo(() => gridRows(finished), [finished]);

  const sections = useBookSections();
  const day = todayKey();
  const shelves = useMemo(
    () => ({
      playnext: shelfBooks("playnext", list, day),
      next: shelfBooks("next", list, day),
      like: safeShelf("like", list, day),
      short: safeShelf("short", list, day),
      added: shelfBooks("added", list, day),
      unstarted: shelfBooks("unstarted", list, day),
    }),
    [list, day],
  );

  // The books this tab shows as cards, top to bottom and each once, for selecting several.
  // Continue listening's cards can't be picked.
  const shown = useMemo(() => {
    const lists =
      tab === "books"
        ? sections.filter((s) => !s.hidden).map((s) => (s.id === "all" ? sorted : s.id === "continue" ? [] : shelves[s.id]).slice(0, SHELF_SIZE))
        : tab === "finished"
          ? [finished]
          : groups.map((g) => g.books);
    const seen = new Set<string>();
    return lists.flat().filter((b) => !seen.has(b.id) && !!seen.add(b.id));
  }, [tab, sections, sorted, shelves, finished, groups]);

  // The title row and tabs stay put above whatever scrolls.
  const header = (
    <View style={{ paddingTop: top, paddingHorizontal: PAD }}>
      <LibraryTitle
        current="books"
        right={
          <>
            {/* Customize is hidden for now, but the empty state's Customize still opens it, so Done shows while it's on. */}
            {(SHOW_CUSTOMIZE || customizing) && tab === "books" ? (
              <IconButton
                label={customizing ? "Done customizing" : "Customize"}
                accessibilityState={{ selected: customizing }}
                onPress={() => setCustomizing((c) => !c)}
                style={customizing ? { backgroundColor: t.accent, borderRadius: 22 } : undefined}
              >
                <CustomizeIcon color={customizing ? t.onAccent : t.text} />
              </IconButton>
            ) : null}
          </>
        }
      />
      <TextTabs
        memoryKey="books"
        options={TABS}
        value={tab}
        onPick={(id) => {
          setTab(id);
          setCustomizing(false);
        }}
      />
    </View>
  );

  const plain = (body: React.ReactNode) => (
    <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }} refreshControl={refresh} keyboardShouldPersistTaps="handled">
      <FadeIn when={fade} style={tabFade}>{body}</FadeIn>
    </ScrollView>
  );

  let content: React.ReactNode;
  if (books.isPending) {
    content = (
      <View style={{ flex: 1, paddingHorizontal: PAD }}>
        <Skeleton>
          <SectionBone />
          <CoverGridBones />
        </Skeleton>
      </View>
    );
  } else if (books.isError && list.length === 0) {
    content = plain(<Empty title="Couldn't load your library">{books.error.message}</Empty>);
  } else if (list.length === 0) {
    content = plain(<Empty title="No books yet">{health ? emptyLibraryReason(health.scan) : null}</Empty>);
  } else if (tab === "books") {
    content = (
      <BooksTab
        books={list}
        sorted={sorted}
        sections={sections}
        shelves={shelves}
        fade={fade}
        tabFade={tabFade}
        refresh={refresh}
        customizing={customizing}
        onCustomize={() => setCustomizing(true)}
      />
    );
  } else if ((tab === "authors" || tab === "series") && groups.length) {
    // One item per author or series: its heading and its sideways shelf.
    content = (
      <VirtualList
        data={groups}
        keyOf={(g) => g.name}
        fade={fade}
        tabFade={tabFade}
        refresh={refresh}
        render={(g) => (
          <Group title={g.name} count={g.books.length} sub={g.sub} side={g.side} onOpen={g.open}>
            {g.books.map((b) => (
              <BookCard key={b.id} book={b} width={shelfWidth} sub={g.cardSub(b)} />
            ))}
          </Group>
        )}
      />
    );
  } else if (tab === "finished" && finishedRows.length) {
    content = (
      <VirtualList
        header={<View style={{ height: 20 }} />}
        data={finishedRows}
        keyOf={(r) => r[0]!.id}
        fade={fade}
        tabFade={tabFade}
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
    );
  } else {
    content = plain(tab === "authors" ? null : <Empty>{tab === "finished" ? "No finished books yet." : "No series yet."}</Empty>);
  }

  return (
    <SelectionProvider books={shown} view={open ? tab : "closed"}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        {header}
        {content}
      </View>
    </SelectionProvider>
  );
}

type Shelves = Record<Exclude<BookSectionId, "continue" | "all">, BookSummary[]>;

type TabFade = ReturnType<typeof useTabFade>;

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
 * A virtualised list, so long libraries only mount the rows near the screen. Used by the Authors, Series and Finished views.
 */
function VirtualList<T>({
  header,
  data,
  keyOf,
  render,
  fade,
  tabFade,
  refresh,
  separator,
}: {
  header?: React.ReactElement;
  data: T[];
  keyOf: (item: T) => string;
  render: (item: T) => React.ReactNode;
  fade: boolean;
  tabFade: TabFade;
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
      renderItem={({ item }) => (
        <FadeIn when={fade} style={tabFade}>
          {render(item)}
        </FadeIn>
      )}
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
  books,
  sorted,
  sections,
  shelves,
  fade,
  tabFade,
  refresh,
  customizing,
  onCustomize,
}: {
  books: BookSummary[];
  sorted: BookSummary[];
  sections: BookSection[];
  shelves: Shelves;
  fade: boolean;
  tabFade: TabFade;
  refresh: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
  customizing: boolean;
  onCustomize: () => void;
}) {
  const t = useTheme();
  const cardWidth = useShelfWidth();
  const { scroll, props: scrollProps } = useSortableScroll<Animated.ScrollView>();
  const continuing = useMemo(() => continueListening(books), [books]);
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
      <Animated.ScrollView {...scrollProps} contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }} refreshControl={refresh} keyboardShouldPersistTaps="handled">
        <FadeIn when={fade} style={tabFade}>
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
  // Can't be picked: while selecting, a tap does nothing.
  const selecting = !!useSelection()?.selecting;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={book.title}
      accessibilityActions={[{ name: "longpress", label: "Options" }]}
      onAccessibilityAction={menu.show}
      onPress={selecting ? undefined : () => router.push(`/book/${book.id}`)}
      onLongPress={selecting ? undefined : withLongPressHaptic(menu.show)}
      style={({ pressed }) => ({ width, gap: 8, opacity: pressed ? 0.75 : 1 })}
    >
      {menu.shown ? <BookActions book={book} open={menu.open} onClose={menu.close} onIdle={menu.idle} selectable={false} /> : null}
      <View>
        <Cover path={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, PixelRatio.getPixelSizeForLayoutSize(width) > 300 ? 600 : 200) : null} title={book.title} color={book.coverColor} radius={12} />
        {now ? <Mixer playing={now === "playing"} /> : null}
      </View>
      <Bar pct={progressPct(book)} height={4} />
      <View>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14, color: now ? t.accent : t.text }}>
          {book.title}
        </Text>
        {book.author ? (
          <Text variant="small" numberOfLines={1}>
            {book.author}
          </Text>
        ) : null}
        <Text variant="small">{timeLeft(book.durationSec, book.progress!.positionSec)}</Text>
      </View>
    </Pressable>
  );
}
