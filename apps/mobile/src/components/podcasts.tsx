import { Pressable, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import {
  apiPaths,
  type EpisodeWithShow,
  plural,
  PODCAST_SORT_LABEL,
  type PodcastListId,
  type PodcastSort,
  type PodcastSummary,
  shortDate,
} from "@murmur/shared/client";
import { createStore } from "@/lib/store";
import { fonts, mixColor, useTheme } from "@/theme";
import { Cover } from "./cover";
import { EpisodeActions, useEpisodePlay } from "./episode-row";
import { HeroBones, ItemHero, MetaLine } from "./hero";
import { CheckIcon, LockIcon, PlusIcon } from "./icons";
import { PAD } from "./library";
import { Mixer, useNowPlaying } from "./mixer";
import { ActionButton } from "./music";
import { Sheet, SheetItem } from "./sheet";
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

export function ShowCard({ show, width }: { show: PodcastSummary; width: number }) {
  const t = useTheme();
  const now = useNowPlaying((s) => s.item?.type === "episode" && s.item.podcastId === show.id);
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
