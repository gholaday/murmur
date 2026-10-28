import { Pressable, View } from "react-native";
import { chapterAt, queueEntryView, timeLeft, type UpNextEntry } from "@murmur/shared/client";
import { clearUpNext, moveUpNext, type Playable, playAt, removeAt, restoreUpNext, toggle, usePlayer, usePlayerSelect, usePosition } from "@/player/engine";
import { useTheme } from "@/theme";
import { Cover } from "./cover";
import { CloseIcon, DragIcon } from "./icons";
import { Eyebrow } from "./listening";
import { MarqueeText } from "./marquee";
import { Mixer } from "./mixer";
import { Empty } from "./page";
import { Sheet } from "./sheet";
import { Bone, Skeleton } from "./skeleton";
import { DragHandle, SortableList } from "./sortable-list";
import { toast } from "./toast";
import { CountPill, IconButton, Text } from "./ui";

/** Every row is this tall, so the sheet can open on the playing one. */
const ROW = 64;
const TOP = 8;

/** Keys for the rows; an item in the list twice (it shouldn't be) still gets its own. */
function rowKeys(items: UpNextEntry[]): string[] {
  const seen = new Map<string, number>();
  return items.map((e) => {
    const k = `${e.itemType}:${e.itemId}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n ? `${k}:${n}` : k;
  });
}

/** The one item that moved between two orders of the same keys, as from and to indexes. */
function moved(before: string[], after: string[]): [number, number] | null {
  let i = 0;
  while (i < before.length && before[i] === after[i]) i++;
  let j = before.length - 1;
  while (j > i && before[j] === after[j]) j--;
  if (i >= j) return null;
  // Moved up: the item that was at j now sits at i. Moved down: the one at i now sits at j.
  return after[i] === before[j] ? [j, i] : [i, j];
}

/**
 * Up Next as one running list, like YouTube Music's: what played stays above the item playing and
 * what's next follows it. Any row plays when tapped (the playing one pauses), and moves or comes out.
 * It's kept on the server, so closing the player keeps it.
 */
export function UpNextSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTheme();
  const { item, upNext, upNextLoaded } = usePlayer();
  const { items, index } = upNext;
  const waiting = Math.max(0, items.length - index - 1);
  const keys = rowKeys(items);
  const book = item?.type === "book" ? item : null;

  const clear = () => {
    const before = upNext;
    clearUpNext();
    toast.show("Up Next cleared", { action: { label: "Undo", onPress: () => restoreUpNext(before) }, duration: 5000 });
  };

  const head = (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text variant="heading">Up Next</Text>
          {waiting ? <CountPill count={waiting} /> : null}
        </View>
        {waiting ? (
          <Pressable accessibilityRole="button" onPress={clear} hitSlop={8} style={{ paddingHorizontal: 4, paddingVertical: 10, marginRight: -4 }}>
            <Text variant="bodyStrong" style={{ fontSize: 14, color: t.accent }}>
              Clear
            </Text>
          </Pressable>
        ) : null}
      </View>
      {upNext.source ? <Text variant="small">{`From ${upNext.source.title}`}</Text> : null}
    </View>
  );

  return (
    <Sheet open={open} onClose={onClose} head={head} keepInView={index >= 0 ? { top: TOP + index * ROW, height: ROW } : undefined}>
      <View style={{ paddingHorizontal: 12, paddingTop: TOP }}>
        {book ? <BookRow item={book} /> : null}
        {!upNextLoaded ? (
          <Skeleton>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: ROW }}>
                <Bone width={48} height={48} radius={8} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Bone width="70%" height={14} />
                  <Bone width="40%" height={12} />
                </View>
              </View>
            ))}
          </Skeleton>
        ) : items.length === 0 ? (
          book ? null : <Empty title="Up Next is empty" />
        ) : (
          <SortableList
            items={items.map((e, i) => ({ e, key: keys[i]! }))}
            keyOf={(r) => r.key}
            liftInset={8}
            onReorder={(after) => {
              const m = moved(keys, after);
              if (m) moveUpNext(m[0], m[1]);
            }}
            renderRow={(r, i) => <UpNextRow entry={r.e} index={i} state={i < index ? "played" : i === index ? "playing" : "next"} />}
          />
        )}
      </View>
    </Sheet>
  );
}

/**
 * A book playing isn't in Up Next, so it sits on its own above the list. Its own component so the
 * playhead ticks redraw this row, not the whole list below it. Tapping it pauses and resumes.
 */
function BookRow({ item }: { item: Playable }) {
  const t = useTheme();
  const position = usePosition();
  const playing = usePlayerSelect((s) => s.playing);
  const where = item.chapters[chapterAt(item.chapters, position)]?.title ?? item.subtitle;
  return (
    <View style={{ marginBottom: 12 }}>
      <Eyebrow>Now playing</Eyebrow>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${playing ? "Pause" : "Play"} ${item.title}`}
        onPress={toggle}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: ROW, opacity: pressed ? 0.7 : 1 })}
      >
        <View>
          <Cover path={item.coverPath} title={item.title} color={item.color} size={48} radius={8} />
          <Mixer thumb resume playing={playing} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <MarqueeText text={item.title} variant="bodyStrong" style={{ color: t.accent }} fadeTo={t.surface} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {where ? (
              <Text variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
                {where}
              </Text>
            ) : null}
            {item.durationSec ? (
              <Text variant="small" style={{ fontVariant: ["tabular-nums"] }}>
                {timeLeft(item.durationSec, position)}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

/**
 * One item: played ones are quieter, the playing one has the mixer and pauses when tapped, and any
 * other plays. Every row can be taken out or dragged, played ones included.
 */
function UpNextRow({ entry, index, state }: { entry: UpNextEntry; index: number; state: "played" | "playing" | "next" }) {
  const t = useTheme();
  const v = queueEntryView(entry);
  const playingNow = state === "playing";
  const playing = usePlayerSelect((s) => playingNow && s.playing);
  const played = state === "played";
  const sub = played ? t.faint : t.muted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, height: ROW, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${playingNow && playing ? "Pause" : "Play"} ${v.title}`}
        onPress={() => (playingNow ? toggle() : playAt(index))}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ opacity: played ? 0.55 : 1 }}>
          <Cover path={v.cover} title={v.title} color={v.color} size={48} radius={8} />
          {playingNow ? <Mixer thumb resume playing={playing} /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <MarqueeText text={v.title} variant="bodyStrong" style={{ color: playingNow ? t.accent : played ? t.faint : t.text }} fadeTo={t.surface} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Text variant="small" numberOfLines={1} style={{ flexShrink: 1, color: sub }}>
              {v.kind}
            </Text>
            <Text variant="small" style={{ color: sub, fontVariant: ["tabular-nums"] }}>
              {v.length}
            </Text>
          </View>
        </View>
      </Pressable>
      <IconButton label={`Remove ${v.title}`} onPress={() => removeAt(index)} style={{ width: 36 }}>
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
