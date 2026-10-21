import { useEffect, useState } from "react";
import { ActivityIndicator, Animated, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { duration, plural, type PodcastPreview, type PodcastPreviewEpisode, type PodcastSummary, shortDate } from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { HeroBackdrop } from "@/components/hero";
import { PlusIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { BackRow, Empty, useBottomPad, useTopInset } from "@/components/page";
import { Bone, FadeIn, Skeleton } from "@/components/skeleton";
import { StickyHeading, useStickyHeading } from "@/components/sticky-heading";
import { toast } from "@/components/toast";
import { Text } from "@/components/ui";
import { api } from "@/lib/api";
import { keys } from "@/lib/data";
import { queryClient } from "@/lib/query";
import { fonts, useTheme } from "@/theme";

type Item = "top" | "heading" | "empty" | PodcastPreviewEpisode;

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

  // Read live each time; the server caches it for a few minutes.
  const query = useQuery({
    queryKey: ["podcast-preview", feedUrl],
    queryFn: () => api<PodcastPreview>(`/api/podcasts/preview?feedUrl=${encodeURIComponent(feedUrl)}`),
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
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: top, paddingHorizontal: PAD }}>
        <BackRow />
        {query.isError ? (
          <Empty title="Couldn't open this podcast">{query.error.message}</Empty>
        ) : (
          <Skeleton style={{ marginTop: 4 }}>
            <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-end" }}>
              <Bone width={128} height={128} radius={12} />
              <View style={{ flex: 1, gap: 8 }}>
                <Bone width="90%" height={22} />
                <Bone width="60%" height={14} />
              </View>
            </View>
            <Bone width={140} height={44} radius={22} style={{ marginTop: 18 }} />
            <Bone height={14} style={{ marginTop: 18 }} />
            <Bone width="70%" height={14} style={{ marginTop: 8 }} />
            <View style={{ marginTop: 32, gap: 28 }}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={{ gap: 8 }}>
                  <Bone width={110} height={12} />
                  <Bone width="80%" height={16} />
                </View>
              ))}
            </View>
          </Skeleton>
        )}
      </View>
    );
  }

  const artwork = art || preview.artworkUrl;

  const subscribe = async () => {
    setBusy(true);
    try {
      const show = await api<PodcastSummary>("/api/podcasts", { method: "POST", body: { feedUrl: preview.feedUrl } });
      toast.show(`Subscribed to ${show.title}`);
      void queryClient.invalidateQueries({ queryKey: keys.podcasts });
      void queryClient.invalidateQueries({ queryKey: keys.newEpisodes });
      void queryClient.invalidateQueries({ queryKey: keys.continueEpisodes });
      void queryClient.invalidateQueries({ queryKey: ["podcast-search"] });
      // Replace, so back from the new podcast goes to the search, not this preview.
      router.replace(`/show/${show.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't subscribe.");
      setBusy(false);
    }
  };

  const topBlock = (
    <View>
          <HeroBackdrop path={artwork} color={null} height={top + 360} />
          <View {...sticky.topProps} style={[sticky.topProps.style, { paddingTop: top, paddingHorizontal: PAD }]}>
          <BackRow />
          <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-end", marginTop: 4 }}>
            <Cover path={artwork} title={preview.title} size={128} radius={12} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="title" style={{ fontSize: 22, lineHeight: 28 }} numberOfLines={3}>
                {preview.title}
              </Text>
              {preview.author ? (
                <Text variant="small" numberOfLines={1}>
                  {preview.author}
                </Text>
              ) : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 2 }}>
                <Text variant="small" style={{ color: t.muted }}>
                  {plural(preview.episodeCount, "episode")}
                </Text>
                {preview.latestPublishedAt ? (
                  <Text variant="small" style={{ color: t.muted }}>
                    Latest {shortDate(preview.latestPublishedAt)}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={() => void subscribe()}
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              marginTop: 18,
              height: 44,
              paddingHorizontal: 20,
              borderRadius: 22,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: t.accent,
              opacity: busy ? 0.7 : pressed ? 0.85 : 1,
            })}
          >
            {busy ? <ActivityIndicator size="small" color={t.onAccent} style={{ width: 18, height: 18 }} /> : <PlusIcon size={18} color={t.onAccent} />}
            <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: t.onAccent }}>{busy ? "Subscribing…" : "Subscribe"}</Text>
          </Pressable>

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
  const items: Item[] = ["top", "heading", ...(preview.episodes.length ? preview.episodes : ["empty" as const])];

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
              <StickyHeading title="Episodes" count={preview.episodeCount} cover={sticky.cover} />
            ) : item === "empty" ? (
              <Empty>No episodes.</Empty>
            ) : (
              <View style={{ paddingHorizontal: PAD }}>
                <PreviewEpisodeRow episode={item} />
              </View>
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
