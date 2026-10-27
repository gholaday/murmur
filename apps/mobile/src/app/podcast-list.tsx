import { useMemo, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { NEW_EPISODES_PAGE, PODCAST_LIST_IDS, PODCAST_LIST_TITLES, type PodcastListId, sortShows } from "@murmur/shared/client";
import { EpisodeRow } from "@/components/episode-row";
import { FilterIcon } from "@/components/icons";
import { Grid, useGridWidth } from "@/components/library";
import { Empty, NestedScreen, PageTitle } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { ShowCard, SortSheet, useSort } from "@/components/podcasts";
import { Button, IconButton } from "@/components/ui";
import { useContinueEpisodes, useNewEpisodes, usePodcasts } from "@/lib/data";
import { useTheme } from "@/theme";


/** Everything in one of the Podcasts tab's sections, opened from its heading. */
export default function PodcastListScreen() {
  const t = useTheme();
  const width = useGridWidth();
  const params = useLocalSearchParams<{ id?: string }>();
  const id: PodcastListId = PODCAST_LIST_IDS.find((s) => s === params.id) ?? "new";
  const sort = useSort();
  const [sortOpen, setSortOpen] = useState(false);
  const [shown, setShown] = useState(NEW_EPISODES_PAGE);

  const podcasts = usePodcasts();
  const newEpisodes = useNewEpisodes();
  const continueEpisodes = useContinueEpisodes();
  const query = id === "podcasts" ? podcasts : id === "new" ? newEpisodes : continueEpisodes;
  const shows = useMemo(() => sortShows(podcasts.data ?? [], sort), [podcasts.data, sort]);
  const episodes = (id === "new" ? newEpisodes.data : continueEpisodes.data) ?? [];
  const count = id === "podcasts" ? shows.length : episodes.length;
  const refresh = usePullRefresh(query.refetch);

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
            <Button label="Show more" kind="secondary" onPress={() => setShown((n) => n + NEW_EPISODES_PAGE)} />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <NestedScreen refreshControl={refresh} after={<SortSheet open={sortOpen} onClose={() => setSortOpen(false)} />}>
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
    </NestedScreen>
  );
}
