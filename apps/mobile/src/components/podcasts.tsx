import { useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { apiPaths, type EpisodeWithShow, type PodcastSummary } from "@murmur/shared/client";
import { useTheme } from "@/theme";
import { Cover } from "./cover";
import { Sheet, SheetItem } from "./sheet";
import { NumberBadge, Text } from "./ui";

export type Sort = "latest" | "title" | "unplayed";
export const SORT_LABEL: Record<Sort, string> = { latest: "Latest episode", title: "Title", unplayed: "Most unplayed" };

export function sortShows(shows: PodcastSummary[], sort: Sort) {
  const out = [...shows];
  if (sort === "title") return out.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "unplayed") return out.sort((a, b) => b.unplayedCount - a.unplayedCount || a.title.localeCompare(b.title));
  return out.sort((a, b) => (b.latestPublishedAt ?? 0) - (a.latestPublishedAt ?? 0));
}

// The sort is shared by the Podcasts tab and its full list, so both show the same order.
let sort: Sort = "latest";
const listeners = new Set<() => void>();
export function setSort(next: Sort) {
  sort = next;
  listeners.forEach((l) => l());
}
export function useSort() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sort,
  );
}

export function SortSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const current = useSort();
  return (
    <Sheet open={open} onClose={onClose} title="Sort podcasts">
      {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
        <SheetItem
          key={s}
          label={SORT_LABEL[s]}
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

/** How many rows each section on the Podcasts tab shows before its heading opens the full list. */
export const SECTION_SIZE = 3;

export type PodcastListId = "continue" | "new" | "podcasts";
export const PODCAST_LIST_IDS: PodcastListId[] = ["continue", "new", "podcasts"];
export const PODCAST_LIST_TITLES: Record<PodcastListId, string> = {
  continue: "Continue listening",
  new: "New episodes",
  podcasts: "Your podcasts",
};

export function openPodcastList(id: PodcastListId) {
  router.push({ pathname: "/podcast-list", params: { id } });
}

/** Each show's newest new episode, with how many new ones it has. Input is newest first. */
export function newByShow(episodes: EpisodeWithShow[]) {
  const groups = new Map<string, { episode: EpisodeWithShow; count: number }>();
  for (const e of episodes) {
    const g = groups.get(e.podcastId);
    if (g) g.count++;
    else groups.set(e.podcastId, { episode: e, count: 1 });
  }
  return [...groups.values()];
}

export function ShowCard({ show, width }: { show: PodcastSummary; width: number }) {
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
          <NumberBadge
            tone="new"
            value={show.unplayedCount > 99 ? "99+" : show.unplayedCount}
            style={{ position: "absolute", top: 6, right: 6 }}
          />
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
