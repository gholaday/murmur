import { useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { apiPaths, PODCAST_SORT_LABEL, type PodcastListId, type PodcastSort, type PodcastSummary } from "@murmur/shared/client";
import { useTheme } from "@/theme";
import { Cover } from "./cover";
import { Sheet, SheetItem } from "./sheet";
import { NumberBadge, Text } from "./ui";

// The sort is shared by the Podcasts tab and its full list, so both show the same order.
let sort: PodcastSort = "latest";
const listeners = new Set<() => void>();
export function setSort(next: PodcastSort) {
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
