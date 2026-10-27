import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { bySeriesOrder, groupBy, nextInSeriesSub, sortBooks } from "@murmur/shared/client";
import { BookCard } from "@/components/book-card";
import { Grid, Group, openGroup, Shelf, useGridWidth } from "@/components/library";
import { Empty, NestedScreen, PageTitle, SectionTitle } from "@/components/page";
import { useBooks } from "@/lib/data";

/** One author's books (grouped by series) or one series in order. */
export default function GroupScreen() {
  const width = useGridWidth();
  const { author, series } = useLocalSearchParams<{ author?: string; series?: string }>();
  const books = useBooks();
  const list = (books.data ?? []).filter((b) => (author ? b.author === author : b.series === series));
  const groups = author ? groupBy(list, (b) => b.series) : [];
  const standalone = author ? list.filter((b) => !b.series) : [];
  const standaloneCards = sortBooks(standalone, "title").map((b) => <BookCard key={b.id} book={b} width={width} sub={null} />);

  return (
    <NestedScreen>
      <PageTitle title={author ?? series ?? ""} count={list.length} sub={series ? list[0]?.author : null} />
      {list.length === 0 ? (
        books.isPending ? null : <Empty>No books here.</Empty>
      ) : series ? (
        <View style={{ marginTop: 12 }}>
          <Grid>
            {[...list].sort(bySeriesOrder).map((b) => (
              <BookCard key={b.id} book={b} width={width} sub={nextInSeriesSub(b)} />
            ))}
          </Grid>
        </View>
      ) : (
        <>
          {groups.map(([name, items]) => (
            <Group key={name} title={name} count={items.length} onOpen={() => openGroup({ series: name })}>
              {[...items].sort(bySeriesOrder).map((b) => (
                <BookCard key={b.id} book={b} width={width} sub={b.seriesPosition !== null ? `Book ${b.seriesPosition}` : null} />
              ))}
            </Group>
          ))}
          {standalone.length ? (
            <>
              {groups.length ? (
                <>
                  <SectionTitle title="Standalone" count={standalone.length} />
                  <Shelf>{standaloneCards}</Shelf>
                </>
              ) : (
                <View style={{ marginTop: 12 }}>
                  <Grid>{standaloneCards}</Grid>
                </View>
              )}
            </>
          ) : null}
        </>
      )}
    </NestedScreen>
  );
}
