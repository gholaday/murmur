import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  newByShow,
  PODCAST_LIST_TITLES,
  PODCAST_SECTION_SIZE,
  type PodcastSearchResult,
  type PodcastSummary,
  sortShows,
} from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { EpisodeRow } from "@/components/episode-row";
import { FilterIcon, PlusIcon } from "@/components/icons";
import { PAD, SectionHead, Shelf, useShelfWidth } from "@/components/library";
import { Empty, PageTitle, useTopInset } from "@/components/page";
import { openPodcastList, ShowCard, SortSheet, useSort } from "@/components/podcasts";
import { usePullRefresh } from "@/components/pull-refresh";
import { SmallButton } from "@/components/settings";
import { Sheet } from "@/components/sheet";
import { CoverGridBones, FadeIn, ListRowBone, SectionBone, Skeleton, useJustLoaded } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { Button, Field, IconButton, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { keys, useContinueEpisodes, useNewEpisodes, usePodcasts } from "@/lib/data";
import { queryClient } from "@/lib/query";
import { useTheme } from "@/theme";

export default function Podcasts() {
  const t = useTheme();
  const top = useTopInset();
  const cardWidth = useShelfWidth();
  const podcasts = usePodcasts();
  const newEpisodes = useNewEpisodes();
  const continueEpisodes = useContinueEpisodes();
  const sort = useSort();
  const [sortOpen, setSortOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [searchText, setSearchText] = useState("");
  // Set while a search result's preview is open, so coming back reopens the search.
  const resumeSearch = useRef(false);
  const fade = useJustLoaded(!podcasts.isPending);

  useFocusEffect(
    useCallback(() => {
      if (!resumeSearch.current) return;
      resumeSearch.current = false;
      setAdding(true);
    }, []),
  );

  const shows = useMemo(() => sortShows(podcasts.data ?? [], sort), [podcasts.data, sort]);
  const fresh = newEpisodes.data ?? [];
  const groups = useMemo(() => newByShow(newEpisodes.data ?? []), [newEpisodes.data]);
  const started = continueEpisodes.data ?? [];

  const refresh = usePullRefresh(() => Promise.all([podcasts.refetch(), newEpisodes.refetch(), continueEpisodes.refetch()]));

  let body: React.ReactNode;
  if (podcasts.isPending) {
    body = (
      <Skeleton>
        <SectionBone />
        <CoverGridBones count={3} />
        <SectionBone />
        {[0, 1, 2].map((i) => (
          <ListRowBone key={i} thumb={48} />
        ))}
      </Skeleton>
    );
  } else if (podcasts.isError && shows.length === 0) {
    body = <Empty title="Couldn't load podcasts">{podcasts.error.message}</Empty>;
  } else if (shows.length === 0) {
    body = (
      <View style={{ alignItems: "center" }}>
        <Empty title="No podcasts yet" />
        <Button label="Add a podcast" onPress={() => setAdding(true)} />
      </View>
    );
  } else {
    body = (
      <>
        <View style={{ marginTop: 24 }}>
          <SectionHead title={PODCAST_LIST_TITLES.podcasts} count={shows.length} onOpen={() => openPodcastList("podcasts")} />
          <Shelf>
            {shows.map((p) => (
              <ShowCard key={p.id} show={p} width={cardWidth} />
            ))}
          </Shelf>
        </View>
        {started.length ? (
          <View style={{ marginTop: 24 }}>
            <SectionHead title={PODCAST_LIST_TITLES.continue} count={started.length} onOpen={() => openPodcastList("continue")} />
            {started.slice(0, PODCAST_SECTION_SIZE).map((e) => (
              <EpisodeRow key={e.id} episode={e} showThumb />
            ))}
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
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: 24 }}
        refreshControl={refresh}
      >
        <PageTitle
          title="Podcasts"
          right={
            <>
              {shows.length > 1 ? (
                <IconButton label="Sort podcasts" onPress={() => setSortOpen(true)}>
                  <FilterIcon color={t.text} />
                </IconButton>
              ) : null}
              <IconButton label="Add podcast" onPress={() => setAdding(true)}>
                <PlusIcon color={t.accent} />
              </IconButton>
            </>
          }
        />
        {podcasts.isPending ? body : <FadeIn when={fade}>{body}</FadeIn>}
      </ScrollView>

      <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} />
      <AddPodcastSheet
        open={adding}
        onClose={() => {
          setAdding(false);
          setSearchText("");
        }}
        searchText={searchText}
        onSearchText={setSearchText}
        onPreview={(feedUrl, artworkUrl) => {
          resumeSearch.current = true;
          setAdding(false);
          router.push({ pathname: "/preview", params: artworkUrl ? { feedUrl, art: artworkUrl } : { feedUrl } });
        }}
      />
    </View>
  );
}

function AddPodcastSheet({
  open,
  onClose,
  searchText,
  onSearchText,
  onPreview,
}: {
  open: boolean;
  onClose: () => void;
  searchText: string;
  onSearchText: (text: string) => void;
  onPreview: (feedUrl: string, artworkUrl: string | null) => void;
}) {
  const t = useTheme();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subscribe = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const show = await api<PodcastSummary>("/api/podcasts", { method: "POST", body: { feedUrl: url.trim() } });
      setUrl("");
      opened(show.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that feed.");
    } finally {
      setBusy(false);
    }
  };

  const opened = (id: string) => {
    void queryClient.invalidateQueries({ queryKey: keys.podcasts });
    void queryClient.invalidateQueries({ queryKey: keys.newEpisodes });
    void queryClient.invalidateQueries({ queryKey: keys.continueEpisodes });
    onClose();
    router.push(`/show/${id}`);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add a podcast">
      <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 14 }}>
        <PodcastSearch text={searchText} setText={onSearchText} onOpen={opened} onPreview={onPreview} />
        <Field
          label="Or paste an RSS feed URL"
          value={url}
          onChangeText={setUrl}
          placeholder="https://example.com/feed.xml"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void subscribe()}
        />
        {error ? (
          <Text variant="small" style={{ color: t.danger }}>
            {error}
          </Text>
        ) : null}
        <Button label="Subscribe" onPress={() => void subscribe()} busy={busy} disabled={!url.trim()} />
      </View>
    </Sheet>
  );
}

/**
 * Searches the podcast directory as you type. Tapping a result opens its preview;
 * its button subscribes, or opens one you already follow.
 */
function PodcastSearch({
  text,
  setText,
  onOpen,
  onPreview,
}: {
  /** Kept by the tab, so the search is still there after coming back from a preview. */
  text: string;
  setText: (text: string) => void;
  onOpen: (id: string) => void;
  onPreview: (feedUrl: string, artworkUrl: string | null) => void;
}) {
  const t = useTheme();
  const [term, setTerm] = useState(text.trim());
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);

  const search = useQuery({
    queryKey: ["podcast-search", term],
    queryFn: () => api<PodcastSearchResult[]>(`/api/podcasts/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  });

  const subscribe = async (r: PodcastSearchResult) => {
    setAdding(r.feedUrl);
    try {
      const show = await api<PodcastSummary>("/api/podcasts", { method: "POST", body: { feedUrl: r.feedUrl } });
      toast.show(`Subscribed to ${show.title}`);
      onOpen(show.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add that podcast.");
    } finally {
      setAdding(null);
    }
  };

  const results = term.length >= 2 ? search.data : undefined;
  return (
    <View style={{ gap: 10 }}>
      <Field
        label="Search podcasts"
        value={text}
        onChangeText={setText}
        placeholder="Title or host"
        autoFocus={!text}
        autoCorrect={false}
        returnKeyType="search"
      />
      {term.length >= 2 && search.isPending ? <ActivityIndicator color={t.accent} style={{ paddingVertical: 12 }} /> : null}
      {term.length >= 2 && search.isError && !results ? (
        <Text variant="small" style={{ color: t.danger }}>
          {search.error.message}
        </Text>
      ) : null}
      {results && results.length === 0 ? <Text variant="small">No podcasts found.</Text> : null}
      {results?.map((r) => (
        <View key={r.feedUrl} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityHint={r.subscribedId ? "Opens the podcast" : "Shows its episodes before you subscribe"}
            onPress={() => (r.subscribedId ? onOpen(r.subscribedId) : onPreview(r.feedUrl, r.artworkUrl))}
            style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 })}
          >
            <Cover path={r.thumbUrl ?? r.artworkUrl} title={r.title} size={48} radius={8} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 14 }}>
                {r.title}
              </Text>
              {r.author ? (
                <Text variant="small" numberOfLines={1}>
                  {r.author}
                </Text>
              ) : null}
              {r.episodeCount !== null ? <Text variant="small">{r.episodeCount === 1 ? "1 episode" : `${r.episodeCount} episodes`}</Text> : null}
            </View>
          </Pressable>
          {r.subscribedId ? (
            <SmallButton label="Open" onPress={() => onOpen(r.subscribedId!)} />
          ) : (
            <SmallButton label={adding === r.feedUrl ? "Adding…" : "Subscribe"} primary disabled={adding !== null} onPress={() => void subscribe(r)} />
          )}
        </View>
      ))}
    </View>
  );
}
