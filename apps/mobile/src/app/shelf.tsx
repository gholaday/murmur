import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { apiPaths, type BookSummary, duration, SHELF_IDS, SHELF_TITLES, shelfBooks, type ShelfId, shelfSub } from "@murmur/shared/client";
import { AllBooks } from "@/components/all-books";
import { BookCard } from "@/components/book-card";
import { Cover } from "@/components/cover";
import { DragIcon, MoreIcon } from "@/components/icons";
import { Grid, PAD, safeShelf, safeShelfTitle, todayKey, useGridWidth } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { BackRow, Empty, NestedScreen, PageTitle, useBottomPad, useTopInset } from "@/components/page";
import { Sheet, SheetItem } from "@/components/sheet";
import { DragHandle, SortableList, SortableScrollView } from "@/components/sortable-list";
import { IconButton, Text } from "@/components/ui";
import { orderPlayNext, setPlayNext, useBooks } from "@/lib/data";
import { useTheme } from "@/theme";

/** Everything on one of the Books tab's shelves, opened from its heading. All books has its own screen. */
export default function ShelfScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  if (params.id === "all") return <AllBooks />;
  if (params.id === "playnext") return <PlayNextList />;
  return <ShelfList id={SHELF_IDS.find((s) => s === params.id) ?? "continue"} />;
}

function ShelfList({ id }: { id: ShelfId }) {
  const width = useGridWidth();
  const books = useBooks();
  const list = safeShelf(id, books.data ?? [], todayKey());

  return (
    <NestedScreen>
      <PageTitle title={safeShelfTitle(id, books.data ?? [])} count={list.length} />
      {list.length === 0 ? (
        books.isPending ? null : <Empty>Nothing here right now.</Empty>
      ) : (
        <View style={{ marginTop: 12 }}>
          <Grid>
            {list.map((b) => (
              <BookCard key={b.id} book={b} width={width} sub={shelfSub(id, b)} />
            ))}
          </Grid>
        </View>
      )}
    </NestedScreen>
  );
}

/** Play next as a list in your order: drag a row to move it, or take it off from its menu. */
function PlayNextList() {
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  const books = useBooks();
  const list = shelfBooks("playnext", books.data ?? [], todayKey());
  const [menu, setMenu] = useState<BookSummary | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SortableScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: bottom }}>
        <BackRow />
        <PageTitle title={SHELF_TITLES.playnext} count={list.length} />
        {list.length === 0 ? (
          books.isPending ? null : <Empty title="Nothing lined up">Add books from their menu, with Add to Play next.</Empty>
        ) : (
          <View style={{ marginTop: 8 }}>
            <SortableList
              items={list}
              keyOf={(b) => b.id}
              liftInset={8}
              onReorder={(ids) => void orderPlayNext(ids).catch(() => undefined)}
              renderRow={(b) => <PlayNextRow book={b} onMenu={() => setMenu(b)} />}
            />
          </View>
        )}
      </SortableScrollView>
      <BottomMiniPlayer />

      <Sheet open={menu !== null} onClose={() => setMenu(null)} title={menu?.title}>
        <SheetItem
          label="Remove from Play next"
          onPress={() => {
            if (menu) void setPlayNext(menu.id, false);
            setMenu(null);
          }}
        />
      </Sheet>
    </View>
  );
}

function PlayNextRow({ book, onMenu }: { book: BookSummary; onMenu: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 72, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={book.title}
        onPress={() => router.push(`/book/${book.id}`)}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.75 : 1 })}
      >
        <Cover
          path={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 200) : null}
          title={book.title}
          color={book.coverColor}
          size={52}
          radius={8}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {book.title}
          </Text>
          <Text variant="small" numberOfLines={1}>
            {book.author ?? "Unknown author"}
          </Text>
          <Text variant="small">{duration(book.durationSec)}</Text>
        </View>
      </Pressable>
      <IconButton label={`Options for ${book.title}`} onPress={onMenu}>
        <MoreIcon size={22} color={t.muted} />
      </IconButton>
      <View style={{ marginRight: -8 }}>
        <DragHandle label={`Reorder ${book.title}`}>
          <DragIcon size={20} color={t.faint} />
        </DragHandle>
      </View>
    </View>
  );
}
