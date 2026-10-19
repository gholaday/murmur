import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SHELF_IDS, SHELF_TITLES, shelfBooks, type ShelfId } from "@murmur/shared/client";
import { BookCard } from "@/components/book-card";
import { BottomMiniPlayer } from "@/components/mini-player";
import { Grid, PAD, shelfSub, todayKey, useGridWidth } from "@/components/library";
import { BackRow, Empty, PageTitle, useBottomPad, useTopInset } from "@/components/page";
import { useBooks } from "@/lib/data";
import { useTheme } from "@/theme";

/** Everything on one of the Books tab's shelves, opened from its heading. */
export default function ShelfScreen() {
  const t = useTheme();
  const top = useTopInset();
  const bottomPad = useBottomPad();
  const width = useGridWidth();
  const params = useLocalSearchParams<{ id?: string }>();
  const id: ShelfId = SHELF_IDS.find((s) => s === params.id) ?? "continue";
  const books = useBooks();
  const list = shelfBooks(id, books.data ?? [], todayKey());

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: top, paddingHorizontal: PAD, paddingBottom: bottomPad }}>
        <BackRow />
        <PageTitle title={SHELF_TITLES[id]} count={list.length} />
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
      </ScrollView>
      <BottomMiniPlayer />
    </View>
  );
}
