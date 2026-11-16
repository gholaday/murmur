import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { NEW_EPISODES_PAGE, PODCAST_LIST_IDS, PODCAST_LIST_TITLES, type PodcastListId } from "@murmur/shared/client";
import { EpisodeRow } from "@/components/episode-row";
import { Empty, NestedScreen, PageTitle } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { Button } from "@/components/ui";
import { useContinueEpisodes, useNewEpisodes } from "@/lib/data";

/** Everything in one of the Podcasts tab's episode sections, opened from its heading. */
export default function PodcastListScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id: PodcastListId = PODCAST_LIST_IDS.find((s) => s === params.id) ?? "new";
  const [shown, setShown] = useState(NEW_EPISODES_PAGE);

  const newEpisodes = useNewEpisodes();
  const continueEpisodes = useContinueEpisodes();
  const query = id === "new" ? newEpisodes : continueEpisodes;
  const episodes = query.data ?? [];
  const refresh = usePullRefresh(query.refetch);

  let body: React.ReactNode;
  if (episodes.length === 0) body = query.isPending ? null : <Empty>Nothing here right now.</Empty>;
  else {
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
    <NestedScreen refreshControl={refresh}>
      <PageTitle title={PODCAST_LIST_TITLES[id]} />
      {body}
    </NestedScreen>
  );
}
