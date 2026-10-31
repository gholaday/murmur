import { useMemo, useState } from "react";
import { Animated, Linking, Pressable, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { apiPaths, type EpisodeWithShow, errorText, matchesEpisode, plural, shortDate } from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { BottomMiniPlayer } from "@/components/mini-player";
import { EpisodeRow } from "@/components/episode-row";
import { HeroBackdrop } from "@/components/hero";
import { CheckIcon, CloseIcon, FilterIcon, LockIcon, MoreIcon, SearchIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BackRow, Empty, NestedFallback, useBottomPad, useTopInset } from "@/components/page";
import { ConfirmSheet, Sheet, SheetItem } from "@/components/sheet";
import { FadeIn } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { usePullRefresh } from "@/components/pull-refresh";
import { StickyHeading, useStickyHeading } from "@/components/sticky-heading";
import { Button, IconButton, Pill, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { invalidateListening, keys, useEpisodes, useFirstEpisodes, usePodcast } from "@/lib/data";
import { queryClient } from "@/lib/query";
import { refreshUpNext } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

type Item = "top" | "heading" | "empty" | EpisodeWithShow;

export default function ShowScreen() {
  const t = useTheme();
  const top = useTopInset();
  const bottomPad = useBottomPad();
  const { id } = useLocalSearchParams<{ id: string }>();
  const podcast = usePodcast(id);
  // The newest page shows first; the full list loads once you scroll past it, ask for more,
  // search or sort oldest first. Offline, whichever of the two is cached shows.
  const [wantAll, setWantAll] = useState(false);
  const full = useEpisodes(id, wantAll);
  const first = useFirstEpisodes(id, !wantAll);
  const data = wantAll ? (full.data ?? first.data) : (first.data ?? full.data);
  // A saved full list is cut to its newest episodes (with no fetch time), so it only counts as complete once fetched.
  const complete = wantAll && !!full.data && (full.dataUpdatedAt > 0 || full.isError);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [sheet, setSheet] = useState<null | "menu" | "unsubscribe" | "sort">(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Only what had to wait fades in; anything already cached shows at once.
  const [showWaited] = useState(!podcast.data);
  const [episodesWaited] = useState(!data);

  const show = podcast.data;
  const withShow: EpisodeWithShow[] = useMemo(
    () =>
      show
        ? (data ?? []).map((e) => ({
            ...e,
            podcastTitle: show.title,
            podcastCoverHash: show.coverHash,
            podcastCoverColor: show.coverColor,
            speed: show.speed,
          }))
        : [],
    [data, show],
  );
  // Oldest first waits for the full list, so it never shows the first page backwards.
  const ordered = useMemo(() => (oldestFirst && complete ? [...withShow].reverse() : withShow), [withShow, oldestFirst, complete]);
  // Matches titles and the start of the notes, the part the list carries.
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? ordered.filter((e) => matchesEpisode(e, q)) : ordered),
    [ordered, q],
  );
  // Episodes still to load past the first page.
  const left = q || complete ? 0 : (show?.episodeCount ?? 0) - visible.length;
  const sticky = useStickyHeading();
  const refresh = usePullRefresh(() => Promise.all([podcast.refetch(), (wantAll ? full : first).refetch()]));
  // The list's items: the top of the page, the heading (which sticks), then the episodes.
  const items: Item[] = useMemo(() => {
    if (!data && (first.isFetching || full.isFetching)) return ["top", "heading"];
    return visible.length ? ["top", "heading", ...visible] : ["top", "heading", "empty"];
  }, [data, first.isFetching, full.isFetching, visible]);

  if (!show) {
    return (
      <NestedFallback>{podcast.isError ? <Empty title="Couldn't load this podcast">{podcast.error.message}</Empty> : null}</NestedFallback>
    );
  }

  // Like the web's: what fails says so in a toast, `failed` in place of the server's words.
  const run = async (fn: () => Promise<unknown>, failed?: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(failed ?? errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const cover600 = show.coverHash ? apiPaths.podcastCoverUrl(show.id, show.coverHash, 600) : null;

  const topBlock = (
    <View>
      <HeroBackdrop path={cover600} color={show.coverColor} height={top + 320} />
      <View {...sticky.topProps} style={[sticky.topProps.style, { paddingTop: top, paddingHorizontal: PAD }]}>
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 2 }}>
              <Text variant="small" style={{ color: t.muted }}>
                {plural(show.episodeCount, "episode")}
              </Text>
              {show.latestPublishedAt ? (
                <Text variant="small" style={{ color: t.muted }}>
                  Latest {shortDate(show.latestPublishedAt)}
                </Text>
              ) : null}
            </View>
            {/* A personal feed, so the server never sends it for ad detection. */}
            {show.privateFeed ? (
              <View style={{ flexDirection: "row", marginTop: 4 }}>
                <Pill label="Private" icon={<LockIcon size={12} color={t.accent} />} />
              </View>
            ) : null}
          </View>
        </View>

        <Button
          label="Subscribed"
          icon={<CheckIcon size={16} color={t.onAccent} />}
          small
          onPress={() => setSheet("unsubscribe")}
          style={{ alignSelf: "flex-start", marginTop: 18 }}
        />

        {show.lastError ? (
          <Text variant="small" style={{ color: t.danger, marginTop: 14 }}>
            Last feed check failed: {show.lastError}
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
      </View>
    </View>
  );

  const heading = (
        <StickyHeading
          title="Episodes"
          count={show.episodeCount}
          cover={sticky.cover}
          right={
            <View style={{ flexDirection: "row", marginRight: -10 }}>
              <IconButton
                label={searching ? "Close search" : "Search episodes"}
                onPress={() => {
                  setSearching((s) => !s);
                  setQuery("");
                  setWantAll(true);
                }}
              >
                {searching ? <CloseIcon color={t.text} /> : <SearchIcon color={t.text} />}
              </IconButton>
              <IconButton label="Sort episodes" onPress={() => setSheet("sort")}>
                <FilterIcon color={t.text} />
              </IconButton>
            </View>
          }
        >
        {searching ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              height: 48,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: t.surface,
              marginTop: 4,
            }}
          >
            <SearchIcon size={20} color={t.muted} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search episodes"
              placeholderTextColor={t.faint}
              selectionColor={t.accent}
              style={{ flex: 1, color: t.text, fontFamily: fonts.medium, fontSize: 15 }}
            />
          </View>
        ) : null}
        </StickyHeading>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FadeIn when={showWaited} style={{ flex: 1 }}>
        <Animated.FlatList
          data={items}
          keyExtractor={(item) => (typeof item === "string" ? item : item.id)}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          keyboardShouldPersistTaps="handled"
          {...sticky.scrollProps}
          stickyHeaderIndices={[1]}
          // Fewer offscreen rows kept than the default 10 screens each way.
          windowSize={7}
          maxToRenderPerBatch={8}
          // Nearing the end of the first page loads the rest.
          onEndReached={() => {
            if (left > 0) setWantAll(true);
          }}
          onEndReachedThreshold={1}
          refreshControl={refresh}
          renderItem={({ item }) =>
            item === "top" ? (
              topBlock
            ) : item === "heading" ? (
              heading
            ) : item === "empty" ? (
              <Empty>{q ? "No episodes match." : "No episodes."}</Empty>
            ) : (
              <FadeIn when={episodesWaited} style={{ paddingHorizontal: PAD }}>
                <EpisodeRow episode={item} />
              </FadeIn>
            )
          }
          ListFooterComponent={
            left > 0 && visible.length ? (
              <View style={{ paddingHorizontal: PAD }}>
                <Button
                  label={full.isFetching ? "Loading…" : `Show more (${left} left)`}
                  kind="secondary"
                  disabled={full.isFetching}
                  onPress={() => (wantAll ? void full.refetch() : setWantAll(true))}
                  style={{ marginTop: 16 }}
                />
              </View>
            ) : undefined
          }
        />
      </FadeIn>

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
              toast.show("Checked for new episodes");
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

      <Sheet open={sheet === "sort"} onClose={() => setSheet(null)} title="Sort episodes">
        {[false, true].map((oldest) => (
          <SheetItem
            key={String(oldest)}
            label={oldest ? "Oldest first" : "Newest first"}
            active={oldestFirst === oldest}
            onPress={() => {
              setOldestFirst(oldest);
              if (oldest) setWantAll(true);
              setSheet(null);
            }}
          />
        ))}
      </Sheet>

      <ConfirmSheet
        open={sheet === "unsubscribe"}
        title={`Unsubscribe from ${show.title}?`}
        message="Your listening history for this podcast is removed from your lists."
        confirmLabel="Unsubscribe"
        danger
        onConfirm={() =>
          void run(async () => {
            await api(`/api/podcasts/${show.id}`, { method: "DELETE" });
            void queryClient.invalidateQueries({ queryKey: keys.podcasts });
            void queryClient.invalidateQueries({ queryKey: keys.newEpisodes });
            void queryClient.invalidateQueries({ queryKey: keys.continueEpisodes });
            void refreshUpNext();
            router.back();
            toast.show(`Unsubscribed from ${show.title}`);
          }, "Couldn't unsubscribe.")
        }
        onClose={() => setSheet(null)}
      />
    </View>
  );
}
