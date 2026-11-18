import { useMemo, useState } from "react";
import { Animated, Linking, Pressable, TextInput, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { router, useLocalSearchParams } from "expo-router";
import {
  apiPaths,
  type BookmarkDto,
  type EpisodeWithShow,
  errorText,
  matchesEpisode,
  SHOW_TABS,
  type ShowTab,
  unplayedEpisodes,
} from "@murmur/shared/client";
import { BookmarkRows, openBookmark } from "@/components/bookmarks";
import { MoreLikeList } from "@/components/browse";
import { BottomMiniPlayer } from "@/components/mini-player";
import { EpisodeRow } from "@/components/episode-row";
import { HeroBackdrop } from "@/components/hero";
import { CloseIcon, FilterIcon, MoreIcon, SearchIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BackRow, Empty, NestedFallback, useBottomPad, useTopInset } from "@/components/page";
import { ConfirmSheet, Sheet, SheetItem } from "@/components/sheet";
import { FadeIn } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { usePullRefresh } from "@/components/pull-refresh";
import { ShowHero, ShowHeroBones } from "@/components/podcasts";
import { StickyHeading, useStickyHeading } from "@/components/sticky-heading";
import { TextTabs, useTabFade } from "@/components/text-tabs";
import { Button, IconButton, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { usePodcastBookmarks } from "@/lib/bookmarks";
import { invalidateListening, keys, useEpisodes, useFirstEpisodes, usePodcast } from "@/lib/data";
import { useHasDirectory } from "@/lib/directory";
import { queryClient } from "@/lib/query";
import { refreshUpNext } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

type Item = "top" | "heading" | "empty" | "bookmarks" | "morelike" | EpisodeWithShow;

/** A podcast's bookmarks by episode, the most recently bookmarked first. */
function byEpisode(bookmarks: BookmarkDto[]): BookmarkDto[][] {
  const groups = new Map<string, BookmarkDto[]>();
  for (const b of bookmarks) groups.set(b.itemId, [...(groups.get(b.itemId) ?? []), b]);
  const newest = (group: BookmarkDto[]) => Math.max(...group.map((b) => b.createdAt));
  return [...groups.values()].sort((a, b) => newest(b) - newest(a));
}

export default function ShowScreen() {
  const t = useTheme();
  const top = useTopInset();
  const bottomPad = useBottomPad();
  // `tab` opens a tab other than Episodes, e.g. More like from a Browse shelf.
  const { id, tab: openOn } = useLocalSearchParams<{ id: string; tab?: string }>();
  const hasDirectory = useHasDirectory();
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
  const bookmarks = usePodcastBookmarks(id);
  const bookmarkGroups = useMemo(() => byEpisode(bookmarks), [bookmarks]);
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
  const [tab, setTab] = useState<ShowTab>(openOn === "morelike" ? "morelike" : "episodes");
  // Bookmarks is only a tab while there are some; deleting the last one goes back to Episodes.
  // More like needs a server with the podcast directory.
  const shownTab: ShowTab = (tab === "bookmarks" && !bookmarks.length) || (tab === "morelike" && !hasDirectory) ? "episodes" : tab;
  // Kept there, so a bookmark added later doesn't switch tabs by itself. More like stays asked
  // for, in case prefs are still loading.
  if (shownTab !== tab && tab === "bookmarks") setTab(shownTab);
  const tabs = useMemo(
    () => SHOW_TABS.filter((s) => (s.id !== "bookmarks" || bookmarks.length) && (s.id !== "morelike" || hasDirectory)),
    [bookmarks.length, hasDirectory],
  );
  // Search and sort are for episodes; bookmarks and similar shows are as they are.
  const episodeTab = shownTab === "episodes" || shownTab === "unplayed";
  const tabFade = useTabFade(shownTab);
  // Set when Unplayed had to wait for the full list, so its rows fade in when it comes.
  const [unplayedWaited, setUnplayedWaited] = useState(false);
  const pickTab = (next: ShowTab) => {
    setTab(next);
    // Unplayed needs every episode, as search does.
    if (next === "unplayed") {
      setWantAll(true);
      if (!complete) setUnplayedWaited(true);
    }
  };

  // Oldest first waits for the full list, so it never shows the first page backwards.
  const ordered = useMemo(() => (oldestFirst && complete ? [...withShow].reverse() : withShow), [withShow, oldestFirst, complete]);
  // Matches titles and the start of the notes, the part the list carries.
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const list = shownTab === "unplayed" ? unplayedEpisodes(ordered) : ordered;
    return q ? list.filter((e) => matchesEpisode(e, q)) : list;
  }, [ordered, q, shownTab]);
  // Episodes still to load past the first page.
  const left = q || complete || shownTab !== "episodes" ? 0 : (show?.episodeCount ?? 0) - visible.length;
  const sticky = useStickyHeading();
  const refresh = usePullRefresh(() => Promise.all([podcast.refetch(), (wantAll ? full : first).refetch()]));
  // The list's items: the top of the page, the heading (which sticks), then the tab's content.
  const items: Item[] = useMemo(() => {
    if (shownTab === "bookmarks") return ["top", "heading", "bookmarks"];
    if (shownTab === "morelike") return ["top", "heading", "morelike"];
    // Unplayed waits for the full list, so it never shows the first page's unplayed as all of them.
    // Offline the fetch pauses rather than runs, and whatever is cached shows.
    if (shownTab === "unplayed" && !complete && full.isFetching) return ["top", "heading"];
    if (!data && (first.isFetching || full.isFetching)) return ["top", "heading"];
    return visible.length ? ["top", "heading", ...visible] : ["top", "heading", "empty"];
  }, [data, first.isFetching, full.isFetching, visible, shownTab, complete]);

  if (!show) {
    return (
      <NestedFallback>{podcast.isError ? <Empty title="Couldn't load this podcast">{podcast.error.message}</Empty> : <ShowHeroBones />}</NestedFallback>
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
      <HeroBackdrop path={cover600} color={show.coverColor} height={top + 400} />
      <View {...sticky.topProps} style={[sticky.topProps.style, { paddingTop: top, paddingHorizontal: PAD }]}>
        <BackRow
          right={
            <IconButton label="More options" onPress={() => setSheet("menu")} style={{ marginRight: -10 }}>
              <MoreIcon color={t.text} />
            </IconButton>
          }
        />
        <ShowHero
          cover={cover600}
          color={show.coverColor}
          title={show.title}
          author={show.author}
          episodeCount={show.episodeCount}
          latestPublishedAt={show.latestPublishedAt}
          privateFeed={show.privateFeed}
          onUnsubscribe={() => setSheet("unsubscribe")}
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
    <StickyHeading sticky={sticky.sticky}>
      <TextTabs
        options={tabs}
        value={shownTab}
        onPick={pickTab}
        gap={20}
        trailing={
          !episodeTab ? null : (
            <>
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
            </>
          )
        }
      />
      {searching && episodeTab ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              height: 48,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: t.surface,
              marginTop: 10,
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
              <Reanimated.View style={tabFade}>
                {q ? (
                  <Empty>No episodes match.</Empty>
                ) : shownTab === "unplayed" ? (
                  <Empty title="No unplayed episodes">You&apos;re all caught up.</Empty>
                ) : (
                  <Empty>No episodes.</Empty>
                )}
              </Reanimated.View>
            ) : item === "morelike" ? (
              <Reanimated.View style={[{ paddingHorizontal: PAD }, tabFade]}>
                <MoreLikeList feedUrl={show.feedUrl} />
              </Reanimated.View>
            ) : item === "bookmarks" ? (
              <Reanimated.View style={[{ paddingHorizontal: PAD - 12, paddingTop: 8, gap: 12 }, tabFade]}>
                {bookmarkGroups.map((group) => (
                  <View key={group[0]!.itemId} style={{ gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={2} style={{ paddingHorizontal: 12 }}>
                      {group[0]!.title}
                    </Text>
                    <BookmarkRows bookmarks={group} onJump={openBookmark} />
                  </View>
                ))}
              </Reanimated.View>
            ) : (
              <Reanimated.View style={tabFade}>
                <FadeIn when={episodesWaited || unplayedWaited} style={{ paddingHorizontal: PAD }}>
                  <EpisodeRow episode={item} />
                </FadeIn>
              </Reanimated.View>
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
              await api(apiPaths.podcastRefresh(show.id), { method: "POST" });
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
            await api(apiPaths.podcast(show.id), { method: "DELETE" });
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
