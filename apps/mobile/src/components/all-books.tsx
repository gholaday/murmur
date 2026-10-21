import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { BOOK_SECTION_TITLES, type BookSummary, sortBooks } from "@murmur/shared/client";
import { useBooks } from "@/lib/data";
import { useTheme } from "@/theme";
import { BookCard } from "./book-card";
import { BookSortSheet, useBookSort } from "./book-sort";
import { FilterIcon } from "./icons";
import { GAP, PAD, useGridWidth } from "./library";
import { BottomMiniPlayer } from "./mini-player";
import { BackRow, Empty, PageTitle, useBottomPad, useTopInset } from "./page";
import { usePullRefresh } from "./pull-refresh";
import { IconButton } from "./ui";

// Defined once: an inline component here would be a new type each render, remounting every gap.
const RowGap = () => <View style={{ height: 18 }} />;

/**
 * Every book in the saved sort, opened from the Books tab's All books heading. Long libraries
 * scroll in a virtualised list of rows of three.
 */
export function AllBooks() {
  const t = useTheme();
  const top = useTopInset();
  const bottomPad = useBottomPad();
  const width = useGridWidth();
  const books = useBooks();
  const sort = useBookSort();
  const [sortOpen, setSortOpen] = useState(false);
  const refresh = usePullRefresh(books.refetch);

  const sorted = useMemo(() => sortBooks(books.data ?? [], sort), [books.data, sort]);
  const rows = useMemo(() => {
    const out: BookSummary[][] = [];
    for (let i = 0; i < sorted.length; i += 3) out.push(sorted.slice(i, i + 3));
    return out;
  }, [sorted]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r[0]!.id}
        contentContainerStyle={{ paddingTop: top, paddingHorizontal: PAD, paddingBottom: bottomPad }}
        refreshControl={refresh}
        ListHeaderComponent={
          <View style={{ marginBottom: 12 }}>
            <BackRow />
            <PageTitle
              title={BOOK_SECTION_TITLES.all}
              count={sorted.length}
              right={
                <IconButton label="Sort" onPress={() => setSortOpen(true)}>
                  <FilterIcon color={t.text} />
                </IconButton>
              }
            />
          </View>
        }
        ListEmptyComponent={books.isPending ? undefined : <Empty>No books yet.</Empty>}
        ItemSeparatorComponent={RowGap}
        // Fewer offscreen rows kept than the default 10 screens each way; covers are cached anyway.
        windowSize={7}
        maxToRenderPerBatch={6}
        renderItem={({ item }) => (
          <View style={{ flexDirection: "row", columnGap: GAP }}>
            {item.map((b) => (
              <BookCard key={b.id} book={b} width={width} />
            ))}
          </View>
        )}
      />
      <BottomMiniPlayer />
      <BookSortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
    </View>
  );
}
