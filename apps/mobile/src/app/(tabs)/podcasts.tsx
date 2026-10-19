import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths, type PodcastSearchResult, type PodcastSummary } from "@murmur/shared";
import { Cover } from "@/components/cover";
import { EpisodeRow } from "@/components/episode-row";
import { FilterIcon, PlusIcon } from "@/components/icons";
import { Grid, PAD, useGridWidth } from "@/components/library";
import { Empty, PageTitle, SectionTitle, useTopInset } from "@/components/page";
import { SmallButton } from "@/components/settings";
import { Sheet, SheetItem } from "@/components/sheet";
import { CoverGridBones, FadeIn, ListRowBone, SectionBone, Skeleton, useJustLoaded } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { Button, Chip, Field, IconButton, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { keys, useNewEpisodes, usePodcasts } from "@/lib/data";
import { useDownloads } from "@/lib/downloads";
import { queryClient } from "@/lib/query";
import { useTheme } from "@/theme";

type Sort = "latest" | "title" | "unplayed";
const SORT_LABEL: Record<Sort, string> = { latest: "Latest episode", title: "Title", unplayed: "Most unplayed" };

function sortShows(shows: PodcastSummary[], sort: Sort) {
  const out = [...shows];
  if (sort === "title") return out.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "unplayed") return out.sort((a, b) => b.unplayedCount - a.unplayedCount || a.title.localeCompare(b.title));
  return out.sort((a, b) => (b.latestPublishedAt ?? 0) - (a.latestPublishedAt ?? 0));
}

export default function Podcasts() {
  const t = useTheme();
  const top = useTopInset();
  const cardWidth = useGridWidth();
  const podcasts = usePodcasts();
  const newEpisodes = useNewEpisodes();
  const downloads = useDownloads();
  const [view, setView] = useState<"shows" | "downloaded">("shows");
  const [sort, setSort] = useState<Sort>("latest");
  const [sortOpen, setSortOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const fade = useJustLoaded(!podcasts.isPending);

  const shows = useMemo(() => sortShows(podcasts.data ?? [], sort), [podcasts.data, sort]);
  const fresh = newEpisodes.data ?? [];
  const downloaded = useMemo(
    () =>
      Object.values(downloads)
        .flatMap((d) => (d.type === "episode" ? [d] : []))
        .sort((a, b) => b.episode.publishedAt - a.episode.publishedAt),
    [downloads],
  );

  const refreshing = podcasts.isRefetching || newEpisodes.isRefetching;
  const onRefresh = () => {
    void podcasts.refetch();
    void newEpisodes.refetch();
  };

  let body: React.ReactNode;
  if (podcasts.isPending) {
    body = (
      <Skeleton>
        <SectionBone />
        {[0, 1, 2, 3].map((i) => (
          <ListRowBone key={i} thumb={48} />
        ))}
        <SectionBone />
        <CoverGridBones count={6} />
      </Skeleton>
    );
  }
  else if (view === "downloaded") {
    body = downloaded.length ? (
      <View style={{ marginTop: 8 }}>
        {downloaded.map((d) => (
          <EpisodeRow key={d.id} episode={d.episode} showThumb />
        ))}
      </View>
    ) : (
      <Empty>No downloaded episodes yet.</Empty>
    );
  } else if (podcasts.isError && shows.length === 0) {
    body = <Empty title="Couldn't load podcasts">{podcasts.error.message}</Empty>;
  } else if (shows.length === 0) {
    body = (
      <Empty title="No podcasts yet" />
    );
  } else {
    body = (
      <>
        {fresh.length ? (
          <>
            <SectionTitle
              title="New episodes"
              right={
                fresh.length > 4 ? (
                  <Pressable onPress={() => setShowAll((s) => !s)} hitSlop={8}>
                    <Text variant="small" style={{ color: t.accent }}>
                      {showAll ? "Show less" : "See all"}
                    </Text>
                  </Pressable>
                ) : undefined
              }
            />
            {(showAll ? fresh : fresh.slice(0, 4)).map((e) => (
              <EpisodeRow key={e.id} episode={e} showThumb />
            ))}
          </>
        ) : null}
        <SectionTitle title="Your podcasts" count={shows.length} />
        <Grid>
          {shows.map((p) => (
            <ShowCard key={p.id} show={p} width={cardWidth} />
          ))}
        </Grid>
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} colors={[t.accent]} />}
      >
        <PageTitle
          title="Podcasts"
          right={
            <>
              {shows.length > 1 && view === "shows" ? (
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
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip label="Podcasts" selected={view === "shows"} onPress={() => setView("shows")} />
          <Chip label="Downloaded" selected={view === "downloaded"} onPress={() => setView("downloaded")} />
        </View>
        {podcasts.isPending ? body : <FadeIn when={fade}>{body}</FadeIn>}
      </ScrollView>

      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort podcasts">
        {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
          <SheetItem
            key={s}
            label={SORT_LABEL[s]}
            active={s === sort}
            onPress={() => {
              setSort(s);
              setSortOpen(false);
            }}
          />
        ))}
      </Sheet>
      <AddPodcastSheet open={adding} onClose={() => setAdding(false)} />
    </View>
  );
}

function ShowCard({ show, width }: { show: PodcastSummary; width: number }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={show.unplayedCount ? `${show.title}, ${show.unplayedCount} unplayed` : show.title}
      onPress={() => router.push(`/show/${show.id}`)}
      style={({ pressed }) => ({ width, gap: 6, opacity: pressed ? 0.75 : 1 })}
    >
      <View>
        <Cover path={show.coverHash ? apiPaths.podcastCoverUrl(show.id, show.coverHash, 200) : null} title={show.title} color={show.coverColor} />
        {show.unplayedCount > 0 ? (
          <View
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              minWidth: 22,
              height: 22,
              paddingHorizontal: 6,
              borderRadius: 11,
              backgroundColor: t.accent,
              justifyContent: "center",
            }}
          >
            <Text variant="caption" style={{ color: t.onAccent, fontSize: 11, textAlign: "center" }}>
              {show.unplayedCount > 99 ? "99+" : show.unplayedCount}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 13 }}>
        {show.title}
      </Text>
      {show.lastError ? (
        <Text variant="small" style={{ color: t.danger }}>
          Feed problem
        </Text>
      ) : null}
    </Pressable>
  );
}

function AddPodcastSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    onClose();
    router.push(`/show/${id}`);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add a podcast">
      <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 14 }}>
        <PodcastSearch onOpen={opened} />
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

/** Searches the podcast directory as you type; each result subscribes or opens in one tap. */
function PodcastSearch({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useTheme();
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
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
        autoFocus
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
          <Cover path={r.artworkUrl} title={r.title} size={48} radius={8} />
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
