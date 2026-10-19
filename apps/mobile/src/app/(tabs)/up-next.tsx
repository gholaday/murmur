import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { apiPaths, duration, type QueueEntry, type QueueRef, timeLeft } from "@murmur/shared";
import { Cover } from "@/components/cover";
import { CloseIcon, DragIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { Empty, PageTitle, useTopInset } from "@/components/page";
import { Sheet, SheetItem } from "@/components/sheet";
import { Bone, FadeIn, ListRowBone, Skeleton, useJustLoaded } from "@/components/skeleton";
import { DragHandle, SortableList, SortableScrollView } from "@/components/sortable-list";
import { Bar, IconButton, Text } from "@/components/ui";
import { chapterAt, playRef, queueReplace, refreshQueue, usePlayer, usePosition } from "@/player/engine";
import { useTheme } from "@/theme";

function entryView(e: QueueEntry) {
  if (e.itemType === "book") {
    const b = e.book;
    const pos = b.progress && !b.progress.finished ? b.progress.positionSec : 0;
    return {
      kind: b.author ?? "Audiobook",
      title: b.title,
      length: pos > 5 ? timeLeft(b.durationSec, pos) : duration(b.durationSec),
      cover: b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 200) : null,
      color: b.coverColor,
      remaining: Math.max(0, b.durationSec - pos),
    };
  }
  const ep = e.episode;
  const dur = ep.durationSec ?? 0;
  const pos = ep.progress && !ep.progress.finished ? ep.progress.positionSec : 0;
  return {
    kind: ep.podcastTitle,
    title: ep.title,
    length: pos > 5 && dur ? timeLeft(dur, pos) : duration(dur),
    cover: ep.podcastCoverHash ? apiPaths.podcastCoverUrl(ep.podcastId, ep.podcastCoverHash, 200) : null,
    color: ep.podcastCoverColor,
    remaining: Math.max(0, dur - pos),
  };
}

const toRef = (e: QueueEntry): QueueRef => ({ itemType: e.itemType, itemId: e.itemId });
const keyOf = (e: QueueEntry) => `${e.itemType}:${e.itemId}`;

export default function UpNext() {
  const t = useTheme();
  const top = useTopInset();
  const { item, queue, queueLoaded } = usePlayer();
  const position = usePosition();
  const [menu, setMenu] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fade = useJustLoaded(queueLoaded);

  const save = (entries: QueueEntry[]) => {
    setError(null);
    queueReplace(entries.map(toRef)).catch((err: unknown) => {
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

  const total = queue.reduce((sum, e) => sum + entryView(e).remaining, 0);
  const nowChapter = item && item.chapters.length > 1 ? item.chapters[chapterAt(item.chapters, position)] : undefined;
  const picked = menu !== null ? queue[menu] : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SortableScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: 24 }}>
        <PageTitle
          title="Up Next"
          count={queue.length || undefined}
          sub={queue.length ? `${duration(total)} to listen` : null}
          below={
            queueLoaded ? undefined : (
              <Skeleton>
                <Bone width={120} height={13} style={{ marginTop: 4 }} />
              </Skeleton>
            )
          }
          right={
            queue.length ? (
              <Pressable onPress={() => save([])} hitSlop={8} style={{ paddingHorizontal: 8, paddingVertical: 10 }}>
                <Text variant="bodyStrong" style={{ color: t.accent }}>
                  Clear
                </Text>
              </Pressable>
            ) : undefined
          }
        />

        {item ? (
          <View style={{ marginTop: 12 }}>
            <Eyebrow>Now playing</Eyebrow>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open player: ${item.title}`}
              onPress={() => router.push("/player")}
              style={{ flexDirection: "row", gap: 14, alignItems: "center", padding: 12, borderRadius: 14, backgroundColor: t.surface }}
            >
              <Cover path={item.coverPath} title={item.title} color={item.color} size={64} radius={8} />
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
            </Pressable>
          </View>
        ) : null}

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

      <Sheet open={picked !== undefined} onClose={() => setMenu(null)} title={picked ? entryView(picked).title : undefined}>
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

function QueueRow({ entry, onMenu, onRemove }: { entry: QueueEntry; onMenu: () => void; onRemove: () => void }) {
  const t = useTheme();
  const v = entryView(entry);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${v.title}`}
        accessibilityHint="Long press for more options"
        onPress={() => void playRef(toRef(entry))}
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

function Eyebrow({ children }: { children: string }) {
  return (
    <Text variant="caption" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>
      {children}
    </Text>
  );
}
