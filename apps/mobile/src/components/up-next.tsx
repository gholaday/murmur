import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { albumCover, chapterAt, duration, plural, type QueueEntry, queueEntryView, queueRef, timeLeft, type TrackDto } from "@murmur/shared/client";
import { type Playable, playContextAt, playQueued, queueReplace, refreshQueue, usePlayer, usePosition } from "@/player/engine";
import { useTheme } from "@/theme";
import { Cover } from "./cover";
import { CloseIcon, DownIcon, DragIcon } from "./icons";
import { PAD } from "./library";
import { Eyebrow, ListMeta } from "./listening";
import { SongRow, SongSheet } from "./music";
import { Empty, useTopInset } from "./page";
import { Sheet, SheetItem } from "./sheet";
import { Bone, FadeIn, ListRowBone, Skeleton, useJustLoaded } from "./skeleton";
import { DragHandle, SortableList, SortableScrollView } from "./sortable-list";
import { Bar, IconButton, Text } from "./ui";

/** Title, chapter and progress of what's playing; on its own so only this re-renders as it plays. */
function NowPlayingText({ item }: { item: Playable }) {
  const position = usePosition();
  const nowChapter = item.chapters.length > 1 ? item.chapters[chapterAt(item.chapters, position)] : undefined;
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text variant="bodyStrong" numberOfLines={2}>
        {item.title}
      </Text>
      <Text variant="small" numberOfLines={1}>
        {nowChapter?.title ?? item.subtitle}
      </Text>
      {item.durationSec ? (
        <>
          <Bar pct={(position / item.durationSec) * 100} />
          <Text variant="small">{timeLeft(item.durationSec, position)}</Text>
        </>
      ) : null}
    </View>
  );
}

const keyOf = (e: QueueEntry) => `${e.itemType}:${e.itemId}`;

/** The Listening tab's Up Next: what's playing, then the queue to reorder. */
export function UpNextView({ header }: { header: React.ReactNode }) {
  const t = useTheme();
  const top = useTopInset();
  const { item, queue, queueLoaded } = usePlayer();
  const [menu, setMenu] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fade = useJustLoaded(queueLoaded);

  const save = (entries: QueueEntry[]) => {
    setError(null);
    queueReplace(entries.map(queueRef)).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Couldn't save the queue.");
      void refreshQueue();
    });
  };
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= queue.length) return;
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    save(next);
  };

  const total = queue.reduce((sum, e) => sum + queueEntryView(e).remaining, 0);
  const picked = menu !== null ? queue[menu] : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SortableScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: 24 }}>
        {header}
        {!queueLoaded ? (
          <Skeleton style={{ marginTop: 12 }}>
            <Bone width={120} height={13} />
          </Skeleton>
        ) : queue.length ? (
          <ListMeta
            text={`${duration(total)} to listen`}
            action={
              <Pressable accessibilityRole="button" onPress={() => save([])} hitSlop={8} style={{ paddingHorizontal: 8, paddingVertical: 10, marginRight: -8 }}>
                <Text variant="bodyStrong" style={{ color: t.accent }}>
                  Clear
                </Text>
              </Pressable>
            }
          />
        ) : null}

        {item ? (
          <View style={{ marginTop: 16 }}>
            <Eyebrow>Now playing</Eyebrow>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open player: ${item.title}`}
              onPress={() => router.push("/player")}
              style={{ flexDirection: "row", gap: 14, alignItems: "center", padding: 12, borderRadius: 14, backgroundColor: t.surface }}
            >
              <Cover path={item.coverPath} title={item.title} color={item.color} size={64} radius={8} />
              <NowPlayingText item={item} />
            </Pressable>
          </View>
        ) : null}
        <RestOfMusic />

        {!queueLoaded ? (
          <Skeleton style={{ marginTop: 24 }}>
            <Eyebrow>Next</Eyebrow>
            {[0, 1, 2, 3, 4].map((i) => (
              <ListRowBone key={i} lines={3} buttons={2} />
            ))}
          </Skeleton>
        ) : (
          <FadeIn when={fade} style={{ marginTop: 24 }}>
            {queue.length ? <Eyebrow>Next</Eyebrow> : null}
            {error ? (
              <Text variant="small" style={{ color: t.danger, marginBottom: 8 }}>
                {error}
              </Text>
            ) : null}
            {queue.length === 0 ? (
              <Empty title="Your queue is empty" />
            ) : (
              <View style={{ marginHorizontal: -8 }}>
                <SortableList
                  items={queue}
                  keyOf={keyOf}
                  onReorder={(keys) => {
                    const byKey = new Map(queue.map((e) => [keyOf(e), e]));
                    save(keys.flatMap((k) => byKey.get(k) ?? []));
                  }}
                  renderRow={(e, i) => (
                    <QueueRow entry={e} onMenu={() => setMenu(i)} onRemove={() => save(queue.filter((_, j) => j !== i))} />
                  )}
                />
              </View>
            )}
          </FadeIn>
        )}
      </SortableScrollView>

      <Sheet open={picked !== undefined} onClose={() => setMenu(null)} title={picked ? queueEntryView(picked).title : undefined}>
        {menu !== null ? (
          <>
            <SheetItem label="Move to top" disabled={menu === 0} onPress={() => (move(menu, 0), setMenu(null))} />
            <SheetItem label="Move up" disabled={menu === 0} onPress={() => (move(menu, menu - 1), setMenu(menu - 1))} />
            <SheetItem label="Move down" disabled={menu === queue.length - 1} onPress={() => (move(menu, menu + 1), setMenu(menu + 1))} />
            <SheetItem label="Move to bottom" disabled={menu === queue.length - 1} onPress={() => (move(menu, queue.length - 1), setMenu(null))} />
            <SheetItem
              label="Remove from Up Next"
              danger
              onPress={() => {
                save(queue.filter((_, j) => j !== menu));
                setMenu(null);
              }}
            />
          </>
        ) : null}
      </Sheet>
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
    <View style={{ marginTop: 24 }}>
      <Eyebrow>Playing from</Eyebrow>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}
      >
        <Cover path={albumCover(first.albumId, first.coverHash)} title={c.title} size={52} radius={8} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 14 }}>
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

function QueueRow({ entry, onMenu, onRemove }: { entry: QueueEntry; onMenu: () => void; onRemove: () => void }) {
  const t = useTheme();
  const v = queueEntryView(entry);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${v.title}`}
        accessibilityHint="Long press for more options"
        onPress={() => void playQueued(queueRef(entry))}
        onLongPress={onMenu}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <Cover path={v.cover} title={v.title} color={v.color} size={52} radius={8} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" numberOfLines={1} style={{ fontSize: 12 }}>
            {v.kind}
          </Text>
          <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 14 }}>
            {v.title}
          </Text>
          <Text variant="small">{v.length}</Text>
        </View>
      </Pressable>
      <IconButton label={`Remove ${v.title}`} onPress={onRemove}>
        <CloseIcon size={20} color={t.muted} />
      </IconButton>
      <DragHandle label={`Drag to reorder ${v.title}`}>
        <DragIcon size={20} color={t.muted} />
      </DragHandle>
    </View>
  );
}
