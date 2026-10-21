import { ActivityIndicator, Pressable, View } from "react-native";
import { router } from "expo-router";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { chapterAt, timeLeft } from "@murmur/shared/client";
import { skipBy, toggle, usePlayer, usePosition } from "@/player/engine";
import { fonts, mixColor, useTheme } from "@/theme";
import { Cover } from "./cover";
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "./icons";
import { Text } from "./ui";

/** Floating player above the tabs; tap to open the full player. */
export function MiniPlayer() {
  const t = useTheme();
  const { item, playing, loading, error, skip } = usePlayer();
  const position = usePosition();
  // Tinted with what's playing, like the web's Now playing card; eases over when the item changes.
  const surface = item?.color ? mixColor(item.color, t.surface2, 0.22) : t.surface2;
  const tint = useAnimatedStyle(() => ({ backgroundColor: withTiming(surface, { duration: 400 }) }));
  if (!item) return null;
  const dur = item.durationSec || 0;
  const chapter = item.chapters.length > 1 ? item.chapters[chapterAt(item.chapters, position)] : undefined;
  const pct = dur ? Math.min(100, (position / dur) * 100) : 0;

  return (
    <Animated.View
      style={[
        {
          marginHorizontal: 8,
          marginBottom: 6,
          borderRadius: 14,
          overflow: "hidden",
          elevation: 6,
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
        tint,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 4, minHeight: 64, paddingVertical: 6, gap: 4 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open player: ${item.title}`}
          onPress={() => router.push("/player")}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}
        >
          <Cover path={item.coverPath} title={item.title} color={item.color} size={48} radius={8} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
              {item.title}
            </Text>
            {/* Title, then the chapter (books with chapters), then time left, each on its own line. */}
            {error ? (
              <Text variant="small" numberOfLines={2} style={{ color: t.danger }}>
                {error}
              </Text>
            ) : (
              <>
                {chapter ? (
                  <Text variant="small" numberOfLines={1}>
                    {chapter.title}
                  </Text>
                ) : null}
                <Text variant="small" numberOfLines={1}>
                  {dur ? timeLeft(dur, position) : item.subtitle}
                </Text>
              </>
            )}
          </View>
        </Pressable>
        <SkipButton label={`Skip back ${skip.back} seconds`} seconds={skip.back} onPress={() => skipBy(-skip.back)}>
          <SkipBackIcon size={30} color={t.text} />
        </SkipButton>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause" : "Play"}
          onPress={toggle}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          {loading ? (
            <ActivityIndicator color={t.text} />
          ) : playing ? (
            <PauseIcon size={26} color={t.text} />
          ) : (
            <PlayIcon size={26} color={t.text} />
          )}
        </Pressable>
        <SkipButton label={`Skip forward ${skip.forward} seconds`} seconds={skip.forward} onPress={() => skipBy(skip.forward)}>
          <SkipForwardIcon size={30} color={t.text} />
        </SkipButton>
      </View>
      {/* A faint track under the fill, so early on (when the fill is tucked into the rounded
          corner) the bar still reads as progress. */}
      {dur ? (
        <View style={{ height: 3 }}>
          <View style={{ position: "absolute", inset: 0, backgroundColor: t.muted, opacity: 0.18 }} />
          <View style={{ height: 3, width: `${pct}%`, backgroundColor: t.accent }} />
        </View>
      ) : null}
    </Animated.View>
  );
}

function SkipButton({ label, seconds, onPress, children }: { label: string; seconds: number; onPress: () => void; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      {children}
      <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 9, lineHeight: 10, includeFontPadding: false, color: t.text }}>{seconds}</Text>
      </View>
    </Pressable>
  );
}

/** The mini player at the bottom of screens outside the tabs (book, show, author). */
export function BottomMiniPlayer() {
  const insets = useSafeAreaInsets();
  const { item } = usePlayer();
  if (!item) return null;
  return (
    <View style={{ paddingBottom: insets.bottom + 4, paddingTop: 4 }}>
      <MiniPlayer />
    </View>
  );
}
