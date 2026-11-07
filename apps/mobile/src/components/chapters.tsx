import { memo } from "react";
import { Pressable, View } from "react-native";
import { type ChapterDto, duration } from "@murmur/shared/client";
import { fonts, useTheme } from "@/theme";
import { MixerBars } from "./mixer";
import { Text } from "./ui";

/** A row's height in the player's sheet, so the sheet can scroll the current one into view. */
export const CHAPTER_ROW = 50;

/**
 * Chapters: number, title, length; played ones muted, the current one in the accent. On the book
 * page rows sit between lines; in the player's sheet (`playing` given) they're a fixed height and
 * the current one shows the mixer in place of its number. Memoized so playback ticks only redraw
 * it when the chapter changes.
 */
export const ChapterList = memo(function ChapterList({
  chapters,
  current,
  onPick,
  playing,
}: {
  chapters: ChapterDto[];
  current: number;
  onPick: (chapter: ChapterDto) => void;
  playing?: boolean;
}) {
  const t = useTheme();
  const sheet = playing !== undefined;
  return chapters.map((c, i) => {
    const now = i === current;
    const done = i < current;
    return (
      <Pressable
        key={c.index}
        accessibilityRole="button"
        accessibilityLabel={`Play ${c.title}`}
        onPress={() => onPick(c)}
        style={({ pressed }) =>
          sheet
            ? { flexDirection: "row", alignItems: "center", gap: 12, height: CHAPTER_ROW, paddingHorizontal: 12, borderRadius: 12, backgroundColor: pressed ? t.surface2 : "transparent" }
            : { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 52, borderBottomWidth: 1, borderBottomColor: t.line, opacity: pressed ? 0.6 : done ? 0.55 : 1 }
        }
      >
        <View style={{ width: sheet ? 26 : 28 }}>
          {sheet && now ? (
            <MixerBars playing={playing} color={t.accent} />
          ) : (
            <Text variant="small" style={{ color: now ? t.accent : t.muted }}>
              {i + 1}
            </Text>
          )}
        </View>
        <Text
          numberOfLines={sheet ? 1 : 2}
          style={{ flex: 1, fontFamily: now ? fonts.bold : fonts.medium, color: now ? t.accent : sheet && done ? t.muted : t.text }}
        >
          {c.title}
        </Text>
        <Text variant="small" style={{ color: t.muted }}>
          {duration(c.endSec - c.startSec)}
        </Text>
      </Pressable>
    );
  });
});
