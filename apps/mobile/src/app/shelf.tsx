import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SHELF_IDS, SHELF_TITLES, shelfBooks, type ShelfId } from "@murmur/shared/client";
import { AllBooks } from "@/components/all-books";
import { BookCard } from "@/components/book-card";
import { Grid, shelfSub, todayKey, useGridWidth } from "@/components/library";
import { Empty, NestedScreen, PageTitle } from "@/components/page";
import { useBooks } from "@/lib/data";

/** Everything on one of the Books tab's shelves, opened from its heading. All books has its own screen. */
export default function ShelfScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  if (params.id === "all") return <AllBooks />;
  return <ShelfList id={SHELF_IDS.find((s) => s === params.id) ?? "continue"} />;
}

function ShelfList({ id }: { id: ShelfId }) {
  const width = useGridWidth();
  const books = useBooks();
  const list = shelfBooks(id, books.data ?? [], todayKey());

  return (
    <NestedScreen>
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
    </NestedScreen>
  );
}
