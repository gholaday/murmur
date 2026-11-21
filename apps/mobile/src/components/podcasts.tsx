import { useState } from "react";
import { Linking, Pressable, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import {
  apiPaths,
  type EpisodeWithShow,
  errorText,
  plural,
  PODCAST_SORT_LABEL,
  type PodcastDetail,
  type PodcastListId,
  type PodcastSort,
  type PodcastSummary,
  shortDate,
} from "@murmur/shared/client";
import { api } from "@/lib/api";
import { invalidateListening, keys } from "@/lib/data";
import { withLongPressHaptic } from "@/lib/haptics";
import { queryClient } from "@/lib/query";
import { createStore } from "@/lib/store";
import { refreshUpNext } from "@/player/engine";
import { toast } from "./toast";
import { fonts, mixColor, useTheme } from "@/theme";
import { Cover } from "./cover";
import { EpisodeActions, useEpisodePlay } from "./episode-row";
import { HeroBones, ItemHero, MetaLine } from "./hero";
import { CheckIcon, LockIcon, PlusIcon } from "./icons";
import { PAD } from "./library";
import { Mixer, useNowPlaying } from "./mixer";
import { ActionButton } from "./music";
import { ConfirmSheet, Sheet, SheetItem, useCardMenu, useMenuIdle } from "./sheet";
import { Bone, Skeleton } from "./skeleton";
import { ACTION_HEIGHT, NumberBadge, Text } from "./ui";

// The Shows tab's sort, kept for the whole session.
const sortStore = createStore<PodcastSort>("latest");
const setSort = sortStore.set;
export const useSort = sortStore.useValue;

export function SortSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const current = useSort();
  return (
    <Sheet open={open} onClose={onClose} title="Sort podcasts">
      {(Object.keys(PODCAST_SORT_LABEL) as PodcastSort[]).map((s) => (
        <SheetItem
          key={s}
          label={PODCAST_SORT_LABEL[s]}
          active={s === current}
          onPress={() => {
            setSort(s);
            onClose();
          }}
        />
      ))}
    </Sheet>
  );
}

export function openPodcastList(id: PodcastListId) {
  router.push({ pathname: "/podcast-list", params: { id } });
}

/**
 * The top of a show's page, laid out like a book's: cover, title, author and the facts line
 * (episodes, the latest one, a private feed). A subscribed show has a quiet check on the cover's
 * corner that asks to unsubscribe; a search preview puts Subscribe below instead (SubscribeButton).
 */
export function ShowHero({
  cover,
  color,
  title,
  author,
  episodeCount,
  latestPublishedAt,
  privateFeed,
  onUnsubscribe,
}: {
  cover: string | null;
  color: string | null;
  title: string;
  author: string | null;
  episodeCount: number;
  latestPublishedAt: number | null;
  privateFeed?: boolean;
  /** Subscribed: shows the corner check, which calls this (it asks first). */
  onUnsubscribe?: () => void;
}) {
  const t = useTheme();
  return (
    <>
      <ItemHero
        cover={cover}
        color={color}
        title={title}
        corner={
          onUnsubscribe ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Subscribed. Unsubscribe"
              onPress={onUnsubscribe}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                // Dark in both themes, like the web's, so it reads on any cover.
                backgroundColor: "rgba(11, 11, 13, 0.55)",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <CheckIcon size={16} color="#fff" />
            </Pressable>
          ) : undefined
        }
      >
        {author ? (
          <Text variant="small" numberOfLines={1} style={{ color: t.text2, textAlign: "center" }}>
            {author}
          </Text>
        ) : null}
        <MetaLine>
          <Text variant="small">{plural(episodeCount, "episode")}</Text>
          {latestPublishedAt ? <Text variant="small">Latest {shortDate(latestPublishedAt)}</Text> : null}
          {/* A personal feed, so the server never sends it for ad detection. */}
          {privateFeed ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <LockIcon size={12} color={t.muted} />
              <Text variant="small">Private</Text>
            </View>
          ) : null}
        </MetaLine>
      </ItemHero>
    </>
  );
}

/** Where a book has Play, on a search preview. */
export function SubscribeButton({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", marginTop: 22 }}>
      <ActionButton
        label={busy ? "Subscribing…" : "Subscribe"}
        primary
        icon={<PlusIcon size={20} color={t.onAccent} />}
        onPress={busy ? undefined : onPress}
      />
    </View>
  );
}

/** ShowHero's shape while the show loads; a preview has the Subscribe button, then the tab or heading row. */
export function ShowHeroBones({ preview }: { preview?: boolean }) {
  return (
    <Skeleton>
      <HeroBones />
      {preview ? <Bone height={ACTION_HEIGHT} radius={ACTION_HEIGHT / 2} style={{ marginTop: 22 }} /> : null}
      <Bone width="70%" height={18} style={{ marginTop: 32 }} />
    </Skeleton>
  );
}

/** Width of a Continue listening card: wide, with the next one peeking in at the edge. */
export function useContinueWidth() {
  const { width } = useWindowDimensions();
  return Math.min(290, width - PAD * 2 - 40);
}

/**
 * An episode you're part way through, on Home's Continue listening shelf: the show's cover, its
 * name and the episode, then the play pill and progress. Tinted with the show's colour.
 */
export function ContinueCard({ episode, width }: { episode: EpisodeWithShow; width: number }) {
  const t = useTheme();
  const play = useEpisodePlay(episode);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${episode.title}, ${episode.podcastTitle}`}
      accessibilityHint="Opens the podcast"
      onPress={() => router.push(`/show/${episode.podcastId}`)}
      style={({ pressed }) => ({
        width,
        padding: 12,
        gap: 12,
        borderRadius: 14,
        justifyContent: "space-between",
        backgroundColor: mixColor(episode.podcastCoverColor ?? t.accent, t.surface, 0.15),
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Cover
          path={episode.podcastCoverHash ? apiPaths.podcastCoverUrl(episode.podcastId, episode.podcastCoverHash, 200) : null}
          title={episode.podcastTitle}
          color={episode.podcastCoverColor}
          size={64}
          radius={10}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 13, color: t.text2 }}>
            {episode.podcastTitle}
          </Text>
          <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 15, lineHeight: 20 }}>
            {episode.title}
          </Text>
        </View>
      </View>
      <EpisodeActions episode={episode} play={play} />
    </Pressable>
  );
}

/** Unsubscribes, and takes the show out of your lists and Up Next. The toast says so. */
export async function unsubscribeShow(show: { id: string; title: string }) {
  await api(apiPaths.podcast(show.id), { method: "DELETE" });
  void queryClient.invalidateQueries({ queryKey: keys.podcasts });
  void queryClient.invalidateQueries({ queryKey: keys.newEpisodes });
  void queryClient.invalidateQueries({ queryKey: keys.continueEpisodes });
  void refreshUpNext();
  toast.show(`Unsubscribed from ${show.title}`);
}

/** A show with what its page knows: the website and feed, which a card has only once the page was opened. */
type ShowRef = PodcastSummary & Partial<Pick<PodcastDetail, "link" | "feedUrl">>;

/**
 * A show's menu, the same from its card's long press and its page's ⋯ (like the web's): Check for
 * new episodes, then the website and Copy feed URL where they're known, then Unsubscribe, which
 * asks first. `onUnsubscribed` runs once that's done (the page leaves).
 */
export function ShowActions({
  show,
  open,
  onClose,
  onIdle,
  onUnsubscribed,
}: {
  show: ShowRef;
  open: boolean;
  onClose: () => void;
  onIdle?: () => void;
  onUnsubscribed?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useMenuIdle(open || confirming, onIdle);
  const then = (fn: () => Promise<unknown> | void) => () => {
    onClose();
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => toast.error(errorText(err)));
  };
  return (
    <>
      <Sheet open={open} onClose={onClose} title={show.title}>
        <SheetItem
          label="Check for new episodes"
          onPress={then(async () => {
            await api(apiPaths.podcastRefresh(show.id), { method: "POST" });
            invalidateListening();
            void queryClient.invalidateQueries({ queryKey: keys.podcast(show.id) });
            toast.show("Checked for new episodes");
          })}
        />
        {show.link ? <SheetItem label="Podcast website" onPress={then(() => Linking.openURL(show.link!))} /> : null}
        {show.feedUrl ? (
          <SheetItem
            label="Copy feed URL"
            onPress={then(async () => {
              await Clipboard.setStringAsync(show.feedUrl!);
              toast.show("Feed URL copied");
            })}
          />
        ) : null}
        <SheetItem label="Unsubscribe" danger onPress={then(() => setConfirming(true))} />
      </Sheet>
      <UnsubscribeSheet show={show} open={confirming} onClose={() => setConfirming(false)} after={onUnsubscribed} />
    </>
  );
}

/** Asks before unsubscribing; `after` runs once it's done (the show's page leaves). */
export function UnsubscribeSheet({ show, open, onClose, after }: { show: PodcastSummary; open: boolean; onClose: () => void; after?: () => void }) {
  return (
    <ConfirmSheet
      open={open}
      title={`Unsubscribe from ${show.title}?`}
      message="Your listening history for this podcast is removed from your lists."
      confirmLabel="Unsubscribe"
      danger
      onConfirm={() => {
        onClose();
        unsubscribeShow(show).then(after, (err: unknown) => toast.error(errorText(err, "Couldn't unsubscribe.")));
      }}
      onClose={onClose}
    />
  );
}

/** A followed show's card. A long press opens its menu, like every other card. */
export function ShowCard({ show, width }: { show: PodcastSummary; width: number }) {
  const t = useTheme();
  const now = useNowPlaying((s) => s.item?.type === "episode" && s.item.podcastId === show.id);
  const menu = useCardMenu();
  // The website and feed, if the show's page was opened.
  const detail = menu.shown ? queryClient.getQueryData<PodcastDetail>(keys.podcast(show.id)) : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={show.unplayedCount ? `${show.title}, ${show.unplayedCount} unplayed` : show.title}
      accessibilityActions={[{ name: "longpress", label: "Options" }]}
      onAccessibilityAction={menu.show}
      onPress={() => router.push(`/show/${show.id}`)}
      onLongPress={withLongPressHaptic(menu.show)}
      style={({ pressed }) => ({ width, gap: 6, opacity: pressed ? 0.75 : 1 })}
    >
      {menu.shown ? (
        <ShowActions show={{ ...show, link: detail?.link, feedUrl: detail?.feedUrl }} open={menu.open} onClose={menu.close} onIdle={menu.idle} />
      ) : null}
      <View>
        <Cover path={show.coverHash ? apiPaths.podcastCoverUrl(show.id, show.coverHash, 200) : null} title={show.title} color={show.coverColor} />
        {show.unplayedCount > 0 ? (
          <NumberBadge
            tone="new"
            value={show.unplayedCount > 99 ? "99+" : show.unplayedCount}
            style={{ position: "absolute", top: 6, right: 6 }}
          />
        ) : null}
        {now ? <Mixer playing={now === "playing"} /> : null}
      </View>
      <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 13, color: now ? t.accent : t.text }}>
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
