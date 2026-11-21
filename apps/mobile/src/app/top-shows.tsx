import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import Animated from "react-native-reanimated";
import { PODCAST_GENRES } from "@murmur/shared/client";
import { DirectoryError, DirectoryProvider, DirectoryRow, DirectoryRowBones } from "@/components/browse";
import { Empty, NestedScreen } from "@/components/page";
import { TextTabs, useTabFade } from "@/components/text-tabs";
import { useChart } from "@/lib/directory";

const CATEGORIES = [{ id: "all", label: "All" }, ...PODCAST_GENRES.map((g) => ({ id: String(g.id), label: g.name }))];

/** Top shows: the top 50 overall or in one category, picked with text tabs. Opened from Browse. */
export default function TopShowsScreen() {
  const params = useLocalSearchParams<{ genre?: string }>();
  const [genre, setGenre] = useState(params.genre ? Number(params.genre) : null);
  const chart = useChart(genre);
  const fade = useTabFade(genre);

  return (
    <NestedScreen title="Top shows">
      <TextTabs label="Category" options={CATEGORIES} value={genre ? String(genre) : "all"} onPick={(id) => setGenre(id === "all" ? null : Number(id))} />
      <DirectoryProvider>
        <Animated.View style={[{ marginTop: 12 }, fade]}>
          {chart.data ? (
            chart.data.length ? (
              chart.data.map((s, i) => <DirectoryRow key={s.feedUrl} show={s} rank={i + 1} />)
            ) : (
              <Empty>Nothing here right now.</Empty>
            )
          ) : chart.isError ? (
            <DirectoryError onRetry={() => void chart.refetch()} />
          ) : (
            <DirectoryRowBones count={12} rank />
          )}
        </Animated.View>
      </DirectoryProvider>
    </NestedScreen>
  );
}
