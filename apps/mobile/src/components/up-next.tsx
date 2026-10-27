import { useState } from "react";
import { Pressable, View } from "react-native";
import { albumCover, duration, plural, type QueueEntry, queueEntryView, queueRef, timeLeft, type TrackDto } from "@murmur/shared/client";
import { type Playable, playContextAt, playQueued, queueReplace, refreshQueue, usePlayer, usePosition } from "@/player/engine";
import { useTheme } from "@/theme";
import { Cover } from "./cover";
import { CloseIcon, DownIcon, DragIcon } from "./icons";
import { Eyebrow } from "./listening";
import { SongRow, SongSheet } from "./music";
import { Empty } from "./page";
import { Sheet } from "./sheet";
import { Bone, Skeleton } from "./skeleton";
import { DragHandle, SortableList } from "./sortable-list";
import { CountPill, IconButton, Text } from "./ui";

const keyOf = (e: QueueEntry) => `${e.itemType}:${e.itemId}`;

/**
 * Up Next, opened from the full player: what's playing, then the episodes and songs lined up
 * after it, to reorder or remove. It's kept on the server, so closing the player keeps it.
 */
export function UpNextSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTheme();
  const { item, queue, queueLoaded } = usePlayer();
  const [error, setError] = useState<string | null>(null);

  const save = (entries: QueueEntry[]) => {
    setError(null);
    queueReplace(entries.map(queueRef)).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Couldn't save Up Next.");
      void refreshQueue();
    });
  };
  const total = queue.reduce((sum, e) => sum + queueEntryView(e).remaining, 0);

  const head = (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text variant="heading">Up Next</Text>
          {queue.length ? <CountPill count={queue.length} /> : null}
        </View>
        {queue.length ? (
          <Pressable accessibilityRole="button" onPress={() => save([])} hitSlop={8} style={{ paddingHorizontal: 4, paddingVertical: 10, marginRight: -4 }}>
            <Text variant="bodyStrong" style={{ fontSize: 14, color: t.accent }}>
              Clear
            </Text>
          </Pressable>
        ) : null}
      </View>
      {queue.length ? <Text variant="small">{`${duration(total)} to listen`}</Text> : null}
    </View>
  );

  return (
    <Sheet open={open} onClose={onClose} head={head}>
      <View style={{ paddingHorizontal: 12 }}>
        {item ? (
          <View style={{ marginTop: 8 }}>
            <Eyebrow>Now playing</Eyebrow>
            <Pressable accessibilityRole="button" accessibilityLabel={`Back to the player: ${item.title}`} onPress={onClose}>
              <NowPlayingRow item={item} />
            </Pressable>
          </View>
        ) : null}
        <RestOfMusic />

        <View style={{ marginTop: 20 }}>
          {!queueLoaded ? (
            <Skeleton>
              <Eyebrow>Next</Eyebrow>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64 }}>
                  <Bone width={44} height={44} radius={8} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Bone width="70%" height={14} />
                    <Bone width="40%" height={12} />
                  </View>
                </View>
              ))}
            </Skeleton>
          ) : queue.length === 0 ? (
            <Empty title="Your queue is empty" />
          ) : (
            <>
              <Eyebrow>Next</Eyebrow>
              {error ? (
                <Text variant="small" style={{ color: t.danger, marginBottom: 8 }}>
                  {error}
                </Text>
              ) : null}
              <SortableList
                items={queue}
                keyOf={keyOf}
                liftInset={8}
                onReorder={(keys) => {
                  const byKey = new Map(queue.map((e) => [keyOf(e), e]));
                  save(keys.flatMap((k) => byKey.get(k) ?? []));
                }}
                renderRow={(e, i) => <QueueRow entry={e} onRemove={() => save(queue.filter((_, j) => j !== i))} />}
              />
            </>
          )}
        </View>
      </View>
    </Sheet>
  );
}

/** What's playing, with the time left; on its own so only this re-renders as it plays. */
function NowPlayingRow({ item }: { item: Playable }) {
  const t = useTheme();
  const position = usePosition();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Cover path={item.coverPath} title={item.title} color={item.color} size={44} radius={8} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ color: t.accent }}>
          {item.title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {item.subtitle}
        </Text>
      </View>
      {item.durationSec ? (
        <Text variant="small" style={{ fontVariant: ["tabular-nums"] }}>
          {timeLeft(item.durationSec, position)}
        </Text>
      ) : null}
    </View>
  );
}

/** The rest of the album or list music is playing from, as one row that opens to show the songs. */
function RestOfMusic() {
  const t = useTheme();
  const { item, context: c } = usePlayer();
  const [open, setOpen] = useState(false);
  const [song, setSong] = useState<TrackDto | null>(null);
  if (!c || item?.type !== "track") return null;
  const rest = c.tracks.slice(c.index + 1);
  if (!rest.length) return null;
  const first = rest[0]!;
  return (
    <View style={{ marginTop: 20 }}>
      <Eyebrow>Playing from</Eyebrow>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, opacity: pressed ? 0.7 : 1 })}
      >
        <Cover path={albumCover(first.albumId, first.coverHash)} title={c.title} size={44} radius={8} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            Rest of {c.title}
          </Text>
          <Text variant="small">{plural(rest.length, "song")}</Text>
        </View>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <DownIcon size={20} color={t.muted} />
        </View>
      </Pressable>
      {open ? rest.map((s, i) => <SongRow key={s.id} track={s} onPlay={() => playContextAt(c.index + 1 + i)} onMore={() => setSong(s)} />) : null}
      <SongSheet track={song} onClose={() => setSong(null)} />
    </View>
  );
}

function QueueRow({ entry, onRemove }: { entry: QueueEntry; onRemove: () => void }) {
  const t = useTheme();
  const v = queueEntryView(entry);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${v.title}`}
        onPress={() => void playQueued(queueRef(entry))}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <Cover path={v.cover} title={v.title} color={v.color} size={44} radius={8} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {v.title}
          </Text>
          <Text variant="small" numberOfLines={1}>
            {v.kind}
          </Text>
        </View>
        <Text variant="small" style={{ fontVariant: ["tabular-nums"] }}>
          {v.length}
        </Text>
      </Pressable>
      <IconButton label={`Remove ${v.title}`} onPress={onRemove} style={{ width: 36 }}>
        <CloseIcon size={20} color={t.muted} />
      </IconButton>
      <View style={{ marginRight: -8 }}>
        <DragHandle label={`Drag to reorder ${v.title}`}>
          <DragIcon size={20} color={t.muted} />
        </DragHandle>
      </View>
    </View>
  );
}
