import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { apiPaths, type EpisodeWithShow } from "@murmur/shared";
import { Cover } from "@/components/cover";
import { BottomMiniPlayer } from "@/components/mini-player";
import { EpisodeRow } from "@/components/episode-row";
import { HeroBackdrop } from "@/components/hero";
import { MoreIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BackRow, Empty, SectionTitle, useBottomPad, useTopInset } from "@/components/page";
import { Sheet, SheetItem } from "@/components/sheet";
import { Button, IconButton, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { invalidateListening, keys, useEpisodes, usePodcast } from "@/lib/data";
import { queryClient } from "@/lib/query";
import { refreshQueue } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

const PAGE = 50;

export default function ShowScreen() {
  const t = useTheme();
  const top = useTopInset();
  const bottomPad = useBottomPad();
  const { id } = useLocalSearchParams<{ id: string }>();
  const podcast = usePodcast(id);
  const episodes = useEpisodes(id);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [sheet, setSheet] = useState<null | "menu" | "unsubscribe">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const show = podcast.data;
  const withShow: EpisodeWithShow[] = useMemo(
    () =>
      show
        ? (episodes.data ?? []).map((e) => ({
            ...e,
            podcastTitle: show.title,
            podcastCoverHash: show.coverHash,
            podcastCoverColor: show.coverColor,
            speed: show.speed,
          }))
        : [],
    [episodes.data, show],
  );
  const visible = useMemo(() => (oldestFirst ? [...withShow].reverse() : withShow), [withShow, oldestFirst]);

  if (!show) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: top, paddingHorizontal: PAD }}>
        <BackRow />
        {podcast.isError ? <Empty title="Couldn't load this podcast">{podcast.error.message}</Empty> : <ActivityIndicator color={t.accent} style={{ marginTop: 48 }} />}
      </View>
    );
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const cover600 = show.coverHash ? apiPaths.podcastCoverUrl(show.id, show.coverHash, 600) : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: top, paddingHorizontal: PAD, paddingBottom: bottomPad }}
        refreshControl={
          <RefreshControl
            refreshing={podcast.isRefetching || episodes.isRefetching}
            onRefresh={() => {
              void podcast.refetch();
              void episodes.refetch();
            }}
            tintColor={t.accent}
            colors={[t.accent]}
          />
        }
      >
        <HeroBackdrop path={cover600} color={show.coverColor} height={top + 320} />
        <BackRow
          right={
            <IconButton label="More options" onPress={() => setSheet("menu")} style={{ marginRight: -10 }}>
              <MoreIcon color={t.text} />
            </IconButton>
          }
        />
        <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-end", marginTop: 4 }}>
          <Cover path={cover600} title={show.title} color={show.coverColor} size={128} radius={12} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="title" style={{ fontSize: 22, lineHeight: 28 }} numberOfLines={3}>
              {show.title}
            </Text>
            {show.author ? <Text variant="small" numberOfLines={1}>{show.author}</Text> : null}
          </View>
        </View>

        {show.lastError ? (
          <Text variant="small" style={{ color: t.danger, marginTop: 14 }}>
            Last feed check failed: {show.lastError}
          </Text>
        ) : null}
        {error ? (
          <Text variant="small" style={{ color: t.danger, marginTop: 14 }}>
            {error}
          </Text>
        ) : null}

        {show.description ? (
          <Pressable onPress={() => setAboutOpen((o) => !o)} style={{ marginTop: 18, gap: 4 }}>
            <Text numberOfLines={aboutOpen ? undefined : 2}>{show.description}</Text>
            {show.description.length > 120 ? (
              <Text variant="small" style={{ color: t.accent, fontFamily: fonts.bold }}>
                {aboutOpen ? "Less" : "More"}
              </Text>
            ) : null}
          </Pressable>
        ) : null}

        <SectionTitle
          title="Episodes"
          right={
            <Pressable accessibilityRole="button" onPress={() => setOldestFirst((o) => !o)} hitSlop={8}>
              <Text variant="small" style={{ fontFamily: fonts.semibold }}>
                {oldestFirst ? "Oldest first" : "Newest first"}
              </Text>
            </Pressable>
          }
        />

        {episodes.isPending ? (
          <ActivityIndicator color={t.accent} style={{ marginTop: 32 }} />
        ) : visible.length === 0 ? (
          <Empty>No episodes.</Empty>
        ) : (
          <>
            {visible.slice(0, limit).map((e) => (
              <EpisodeRow key={e.id} episode={e} />
            ))}
            {visible.length > limit ? (
              <Button label={`Show more (${visible.length - limit} left)`} kind="secondary" onPress={() => setLimit((l) => l + PAGE)} style={{ marginTop: 16 }} />
            ) : null}
          </>
        )}
      </ScrollView>

      <BottomMiniPlayer />
      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title={show.title}>
        <SheetItem
          label={busy ? "Checking…" : "Check for new episodes"}
          disabled={busy}
          onPress={() => {
            setSheet(null);
            void run(async () => {
              await api(`/api/podcasts/${show.id}/refresh`, { method: "POST" });
              invalidateListening();
              void queryClient.invalidateQueries({ queryKey: keys.podcast(show.id) });
            });
          }}
        />
        {show.link ? (
          <SheetItem
            label="Podcast website"
            onPress={() => {
              setSheet(null);
              void Linking.openURL(show.link!);
            }}
          />
        ) : null}
        <SheetItem label="Unsubscribe" danger onPress={() => setSheet("unsubscribe")} />
      </Sheet>

      <Sheet open={sheet === "unsubscribe"} onClose={() => setSheet(null)} title={`Unsubscribe from ${show.title}?`}>
        <View style={{ paddingHorizontal: 12, gap: 14, paddingBottom: 8 }}>
          <Text>Your listening history for this podcast is removed from your lists.</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button label="Cancel" kind="secondary" onPress={() => setSheet(null)} style={{ flex: 1 }} />
            <Button
              label="Unsubscribe"
              busy={busy}
              style={{ flex: 1 }}
              onPress={() =>
                void run(async () => {
                  await api(`/api/podcasts/${show.id}`, { method: "DELETE" });
                  setSheet(null);
                  void queryClient.invalidateQueries({ queryKey: keys.podcasts });
                  void queryClient.invalidateQueries({ queryKey: keys.newEpisodes });
                  void refreshQueue();
                  router.back();
                })
              }
            />
          </View>
        </View>
      </Sheet>
    </View>
  );
}
