import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";
import { newByShow, PODCAST_LIST_TITLES, PODCAST_SECTION_SIZE, PODCAST_TABS, type PodcastTab, sortShows } from "@murmur/shared/client";
import { BrowseBody } from "@/components/browse";
import { EpisodeRow } from "@/components/episode-row";
import { FilterIcon, PlusIcon } from "@/components/icons";
import { GAP, Grid, PAD, SectionHead, Shelf, useGridWidth } from "@/components/library";
import { Empty, PageTitle, useTopInset } from "@/components/page";
import { ContinueCard, openPodcastList, ShowCard, SortSheet, useContinueWidth, useSort } from "@/components/podcasts";
import { usePullRefresh } from "@/components/pull-refresh";
import { SearchPill } from "@/components/search-pill";
import { Bone, FadeIn, ListRowBone, SectionBone, Skeleton, useJustLoaded } from "@/components/skeleton";
import { TextTabs, useTabFade } from "@/components/text-tabs";
import { IconButton } from "@/components/ui";
import { keys, useContinueEpisodes, useNewEpisodes, usePodcasts } from "@/lib/data";
import { queryClient } from "@/lib/query";
import { useTheme } from "@/theme";

export default function Podcasts() {
  const t = useTheme();
  const top = useTopInset();
  const gridWidth = useGridWidth();
  const continueWidth = useContinueWidth();
  // Kept while the tab stays mounted, like Music's.
  const [tab, setTab] = useState<PodcastTab>("home");
  const tabFade = useTabFade(tab);
  // Browse's box, kept across a show's preview and back.
  const [query, setQuery] = useState("");
  // Set by Add, which opens Browse ready to type.
  const [focusBox, setFocusBox] = useState(false);
  const podcasts = usePodcasts();
  const newEpisodes = useNewEpisodes();
  const continueEpisodes = useContinueEpisodes();
  const sort = useSort();
  const [sortOpen, setSortOpen] = useState(false);
  const fade = useJustLoaded(!podcasts.isPending);

  const shows = useMemo(() => sortShows(podcasts.data ?? [], sort), [podcasts.data, sort]);
  const fresh = newEpisodes.data ?? [];
  const groups = useMemo(() => newByShow(newEpisodes.data ?? []), [newEpisodes.data]);
  const started = continueEpisodes.data ?? [];

  // With nothing followed yet, the tab is just Browse: it's where shows are found. Following one
  // there keeps you on Browse.
  const none = podcasts.isSuccess && shows.length === 0;
  if (none && tab !== "browse") setTab("browse");
  const tabbed = shows.length > 0 || podcasts.isPending;
  const browsing = tab === "browse" && !podcasts.isPending && (tabbed || none);

  const pick = (next: PodcastTab) => {
    setTab(next);
    setFocusBox(false);
  };
  const add = () => {
    setTab("browse");
    setFocusBox(true);
  };

  const refresh = usePullRefresh(() =>
    Promise.all([
      podcasts.refetch(),
      newEpisodes.refetch(),
      continueEpisodes.refetch(),
      browsing ? queryClient.refetchQueries({ queryKey: keys.podcastBrowse }) : null,
    ]),
  );

  let body: React.ReactNode;
  if (podcasts.isPending) {
    body = (
      <Skeleton>
        <SectionBone />
        <View style={{ flexDirection: "row", columnGap: GAP }}>
          {[0, 1].map((i) => (
            <Bone key={i} width={continueWidth} height={132} radius={14} />
          ))}
        </View>
        <SectionBone />
        {Array.from({ length: PODCAST_SECTION_SIZE }, (_, i) => (
          <ListRowBone key={i} thumb={64} />
        ))}
      </Skeleton>
    );
  } else if (podcasts.isError && shows.length === 0) {
    body = <Empty title="Couldn't load podcasts">{podcasts.error.message}</Empty>;
  } else if (browsing) {
    body = (
      <Animated.View style={tabFade}>
        <BrowseBody query={query} />
      </Animated.View>
    );
  } else if (tab === "shows") {
    body = (
      <Animated.View style={[{ marginTop: 18 }, tabFade]}>
        <Grid>
          {shows.map((p) => (
            <ShowCard key={p.id} show={p} width={gridWidth} />
          ))}
        </Grid>
      </Animated.View>
    );
  } else {
    body = (
      <Animated.View style={tabFade}>
        {started.length ? (
          <View style={{ marginTop: 24 }}>
            <SectionHead title={PODCAST_LIST_TITLES.continue} count={started.length} onOpen={() => openPodcastList("continue")} />
            <Shelf>
              {started.map((e) => (
                <ContinueCard key={e.id} episode={e} width={continueWidth} />
              ))}
            </Shelf>
          </View>
        ) : null}
        {groups.length ? (
          <View style={{ marginTop: 24 }}>
            <SectionHead title={PODCAST_LIST_TITLES.new} count={fresh.length} onOpen={() => openPodcastList("new")} />
            {groups.slice(0, PODCAST_SECTION_SIZE).map((g) => (
              <EpisodeRow key={g.episode.id} episode={g.episode} showThumb newCount={g.count} />
            ))}
          </View>
        ) : null}
        {started.length || groups.length ? null : <Empty title="Nothing new">New episodes from your shows will show here.</Empty>}
      </Animated.View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* The title, tabs and Browse's box stay put above whatever scrolls, like Library's. */}
      <View style={{ paddingTop: top, paddingHorizontal: PAD }}>
        <PageTitle
          title="Podcasts"
          right={
            tab !== "browse" ? (
              <>
                {tab === "shows" && shows.length > 1 ? (
                  <IconButton label="Sort podcasts" onPress={() => setSortOpen(true)}>
                    <FilterIcon color={t.text} />
                  </IconButton>
                ) : null}
                <IconButton label="Add podcast" onPress={add}>
                  <PlusIcon color={t.accent} />
                </IconButton>
              </>
            ) : null
          }
        />
        {tabbed ? <TextTabs options={PODCAST_TABS} value={tab} onPick={pick} /> : null}
        {browsing ? (
          <View style={{ paddingTop: 12, paddingBottom: 6 }}>
            <SearchPill value={query} onChangeText={setQuery} placeholder="Search podcasts or paste a feed link" autoFocus={focusBox} links />
          </View>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" refreshControl={refresh}>
        {podcasts.isPending ? body : <FadeIn when={fade}>{body}</FadeIn>}
      </ScrollView>

      <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
    </View>
  );
}
