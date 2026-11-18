import { useEffect, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Reanimated from "react-native-reanimated";
import {
  apiPaths,
  duration,
  type PodcastPreview,
  type PodcastPreviewEpisode,
  type PodcastSummary,
  SHOW_TABS,
  type ShowTab,
  shortDate,
} from "@murmur/shared/client";
import { MoreLikeList } from "@/components/browse";
import { HeroBackdrop } from "@/components/hero";
import { PAD } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { BackRow, Empty, NestedFallback, useBottomPad, useTopInset } from "@/components/page";
import { ShowHero, ShowHeroBones, SubscribeButton } from "@/components/podcasts";
import { FadeIn } from "@/components/skeleton";
import { StickyHeading, useStickyHeading } from "@/components/sticky-heading";
import { TextTabs, useTabFade } from "@/components/text-tabs";
import { toast } from "@/components/toast";
import { Text } from "@/components/ui";
import { api } from "@/lib/api";
import { keys } from "@/lib/data";
import { refreshAfterSubscribe, useHasDirectory } from "@/lib/directory";
import { fonts, useTheme } from "@/theme";

type Item = "top" | "heading" | "empty" | "morelike" | PodcastPreviewEpisode;

const PREVIEW_TABS = SHOW_TABS.filter((t) => t.id === "episodes" || t.id === "morelike");

/** A podcast from search, read live from its feed, with Subscribe. Browse only: nothing plays. */
export default function PreviewScreen() {
  const t = useTheme();
  const top = useTopInset();
  const bottomPad = useBottomPad();
  // `art` is the search result's 600px artwork; feeds often link a 3000px original instead.
  const { feedUrl, art } = useLocalSearchParams<{ feedUrl: string; art?: string }>();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sticky = useStickyHeading();
  const hasDirectory = useHasDirectory();
  const [tab, setTab] = useState<ShowTab>("episodes");
  const tabFade = useTabFade(tab);

  // Read live each time; the server caches it for a few minutes.
  const query = useQuery({
    queryKey: keys.podcastPreview(feedUrl),
    queryFn: () => api<PodcastPreview>(apiPaths.podcastPreview(feedUrl)),
    gcTime: 0,
    retry: false,
  });
  const preview = query.data;

  // Followed elsewhere in the meantime: the real page has more to offer.
  useEffect(() => {
    if (preview?.subscribedId) router.replace(`/show/${preview.subscribedId}`);
  }, [preview?.subscribedId]);

  if (!preview || preview.subscribedId) {
    return (
      <NestedFallback>
        {query.isError ? (
          <Empty title="Couldn't open this podcast">{query.error.message}</Empty>
        ) : (
          <ShowHeroBones preview />
        )}
      </NestedFallback>
    );
  }

  const artwork = art || preview.artworkUrl;

  const subscribe = async () => {
    setBusy(true);
    try {
      const show = await api<PodcastSummary>(apiPaths.podcasts, { method: "POST", body: { feedUrl: preview.feedUrl } });
      toast.show(`Subscribed to ${show.title}`);
      refreshAfterSubscribe();
      // Replace, so back from the new podcast goes to the search, not this preview.
      router.replace(`/show/${show.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't subscribe.");
      setBusy(false);
    }
  };

  const topBlock = (
    <View>
          <HeroBackdrop path={artwork} color={null} height={top + 400} />
          <View {...sticky.topProps} style={[sticky.topProps.style, { paddingTop: top, paddingHorizontal: PAD }]}>
          <BackRow />
          <ShowHero
            cover={artwork}
            color={null}
            title={preview.title}
            author={preview.author}
            episodeCount={preview.episodeCount}
            latestPublishedAt={preview.latestPublishedAt}
          />
          <SubscribeButton busy={busy} onPress={() => void subscribe()} />

          {preview.description ? (
            <Pressable onPress={() => setAboutOpen((o) => !o)} style={{ marginTop: 18, gap: 4 }}>
              <Text numberOfLines={aboutOpen ? undefined : 2}>{preview.description}</Text>
              {preview.description.length > 120 ? (
                <Text variant="small" style={{ color: t.accent, fontFamily: fonts.bold }}>
                  {aboutOpen ? "Less" : "More"}
                </Text>
              ) : null}
            </Pressable>
          ) : null}
          </View>
    </View>
  );

  // The list's items: the top of the page, the heading (which sticks), then the episodes.
  const items: Item[] =
    tab === "morelike" && hasDirectory
      ? ["top", "heading", "morelike"]
      : ["top", "heading", ...(preview.episodes.length ? preview.episodes : ["empty" as const])];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FadeIn style={{ flex: 1 }}>
        <Animated.FlatList
          data={items}
          keyExtractor={(item) => (typeof item === "string" ? item : item.guid)}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          {...sticky.scrollProps}
          stickyHeaderIndices={[1]}
          windowSize={7}
          maxToRenderPerBatch={8}
          renderItem={({ item }) =>
            item === "top" ? (
              topBlock
            ) : item === "heading" ? (
              hasDirectory ? (
                <StickyHeading sticky={sticky.sticky}>
                  <TextTabs options={PREVIEW_TABS} value={tab} onPick={setTab} gap={20} />
                </StickyHeading>
              ) : (
                <StickyHeading title="Episodes" count={preview.episodeCount} sticky={sticky.sticky} />
              )
            ) : item === "morelike" ? (
              <Reanimated.View style={[{ paddingHorizontal: PAD }, tabFade]}>
                <MoreLikeList feedUrl={preview.feedUrl} />
              </Reanimated.View>
            ) : item === "empty" ? (
              <Reanimated.View style={tabFade}>
                <Empty>No episodes.</Empty>
              </Reanimated.View>
            ) : (
              <Reanimated.View style={[{ paddingHorizontal: PAD }, tabFade]}>
                <PreviewEpisodeRow episode={item} />
              </Reanimated.View>
            )
          }
        />
      </FadeIn>
      <BottomMiniPlayer />
    </View>
  );
}

function PreviewEpisodeRow({ episode }: { episode: PodcastPreviewEpisode }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((o) => !o)}
      style={{ gap: 3, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.line }}
    >
      <View style={{ flexDirection: "row", columnGap: 10 }}>
        <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: t.muted }}>{shortDate(episode.publishedAt)}</Text>
        {episode.durationSec ? <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: t.muted }}>{duration(episode.durationSec)}</Text> : null}
      </View>
      <Text variant="bodyStrong" style={{ fontSize: 15, lineHeight: 20 }}>
        {episode.title}
      </Text>
      {episode.description ? (
        <Text numberOfLines={open ? undefined : 1} style={{ fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: t.muted }}>
          {episode.description}
        </Text>
      ) : null}
    </Pressable>
  );
}
