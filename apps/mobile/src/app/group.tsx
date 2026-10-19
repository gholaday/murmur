import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { bySeriesOrder, groupBy, sortBooks } from "@murmur/shared";
import { BookCard } from "@/components/book-card";
import { BottomMiniPlayer } from "@/components/mini-player";
import { Grid, Group, openGroup, PAD, useGridWidth } from "@/components/library";
import { BackRow, Empty, useBottomPad, PageTitle, SectionTitle, useTopInset } from "@/components/page";
import { useBooks } from "@/lib/data";
import { useTheme } from "@/theme";

/** One author's books (grouped by series) or one series in order. */
export default function GroupScreen() {
  const t = useTheme();
  const top = useTopInset();
  const bottomPad = useBottomPad();
  const width = useGridWidth();
  const { author, series } = useLocalSearchParams<{ author?: string; series?: string }>();
  const books = useBooks();
  const list = (books.data ?? []).filter((b) => (author ? b.author === author : b.series === series));
  const groups = author ? groupBy(list, (b) => b.series) : [];
  const standalone = author ? list.filter((b) => !b.series) : [];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: top, paddingHorizontal: PAD, paddingBottom: bottomPad }}>
        <BackRow />
        <PageTitle title={author ?? series ?? ""} count={list.length} sub={series ? list[0]?.author : null} />
        {list.length === 0 ? (
          <Empty>{books.isPending ? "Loading…" : "No books here."}</Empty>
        ) : series ? (
          <View style={{ marginTop: 12 }}>
            <Grid>
              {[...list].sort(bySeriesOrder).map((b) => (
                <BookCard key={b.id} book={b} width={width} sub={b.seriesPosition !== null ? `Book ${b.seriesPosition}` : b.author} />
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
                {groups.length ? <SectionTitle title="Standalone" count={standalone.length} /> : <View style={{ height: 12 }} />}
                <Grid>
                  {sortBooks(standalone, "title").map((b) => (
                    <BookCard key={b.id} book={b} width={width} sub={null} />
                  ))}
                </Grid>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
      <BottomMiniPlayer />
    </View>
  );
}
