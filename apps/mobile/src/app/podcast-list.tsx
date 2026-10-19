import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { EpisodeRow } from "@/components/episode-row";
import { FilterIcon } from "@/components/icons";
import { Grid, PAD, useGridWidth } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { BackRow, Empty, PageTitle, useBottomPad, useTopInset } from "@/components/page";
import { PODCAST_LIST_IDS, PODCAST_LIST_TITLES, type PodcastListId, ShowCard, SortSheet, sortShows, useSort } from "@/components/podcasts";
import { Button, IconButton } from "@/components/ui";
import { useContinueEpisodes, useNewEpisodes, usePodcasts } from "@/lib/data";
import { useTheme } from "@/theme";

const NEW_PAGE = 10;

/** Everything in one of the Podcasts tab's sections, opened from its heading. */
export default function PodcastListScreen() {
  const t = useTheme();
  const top = useTopInset();
  const bottomPad = useBottomPad();
  const width = useGridWidth();
  const params = useLocalSearchParams<{ id?: string }>();
  const id: PodcastListId = PODCAST_LIST_IDS.find((s) => s === params.id) ?? "new";
  const sort = useSort();
  const [sortOpen, setSortOpen] = useState(false);
  const [shown, setShown] = useState(NEW_PAGE);

  const podcasts = usePodcasts();
  const newEpisodes = useNewEpisodes();
  const continueEpisodes = useContinueEpisodes();
  const query = id === "podcasts" ? podcasts : id === "new" ? newEpisodes : continueEpisodes;
  const shows = useMemo(() => sortShows(podcasts.data ?? [], sort), [podcasts.data, sort]);
  const episodes = (id === "new" ? newEpisodes.data : continueEpisodes.data) ?? [];
  const count = id === "podcasts" ? shows.length : episodes.length;

  let body: React.ReactNode;
  if (count === 0) body = query.isPending ? null : <Empty>Nothing here right now.</Empty>;
  else if (id === "podcasts") {
    body = (
      <View style={{ marginTop: 12 }}>
        <Grid>
          {shows.map((p) => (
            <ShowCard key={p.id} show={p} width={width} />
          ))}
        </Grid>
      </View>
    );
  } else {
    const list = id === "new" ? episodes.slice(0, shown) : episodes;
    body = (
      <>
        {list.map((e) => (
          <EpisodeRow key={e.id} episode={e} showThumb />
        ))}
        {list.length < episodes.length ? (
          <View style={{ marginTop: 20, alignItems: "center" }}>
            <Button label="Show more" kind="secondary" onPress={() => setShown((n) => n + NEW_PAGE)} />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: top, paddingHorizontal: PAD, paddingBottom: bottomPad }}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={t.accent} colors={[t.accent]} />
        }
      >
        <BackRow />
        <PageTitle
          title={PODCAST_LIST_TITLES[id]}
          count={count}
          right={
            id === "podcasts" && shows.length > 1 ? (
              <IconButton label="Sort podcasts" onPress={() => setSortOpen(true)}>
                <FilterIcon color={t.text} />
              </IconButton>
            ) : null
          }
        />
        {body}
      </ScrollView>
      <BottomMiniPlayer />
      <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
    </View>
  );
}
