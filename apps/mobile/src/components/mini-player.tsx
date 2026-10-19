import { ActivityIndicator, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { timeLeft } from "@murmur/shared/client";
import { chapterAt, skipBy, toggle, usePlayer, usePosition } from "@/player/engine";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "./icons";
import { Text } from "./ui";

/** Floating player above the tabs; tap to open the full player. */
export function MiniPlayer() {
  const t = useTheme();
  const { item, playing, loading, error, skip } = usePlayer();
  const position = usePosition();
  if (!item) return null;
  const dur = item.durationSec || 0;
  const chapter = item.chapters.length > 1 ? item.chapters[chapterAt(item.chapters, position)] : undefined;
  const pct = dur ? Math.min(100, (position / dur) * 100) : 0;

  return (
    <View
      style={{
        marginHorizontal: 8,
        marginBottom: 6,
        borderRadius: 14,
        backgroundColor: t.surface2,
        overflow: "hidden",
        elevation: 6,
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 4, height: 64, gap: 4 }}>
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
            <Text variant="small" numberOfLines={1} style={error ? { color: t.danger } : undefined}>
              {error ?? chapter?.title ?? (dur ? timeLeft(dur, position) : item.subtitle)}
            </Text>
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
      <View style={{ height: 2, width: `${pct}%`, backgroundColor: t.accent }} />
    </View>
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
