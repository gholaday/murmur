import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { fonts, useTheme } from "@/theme";
import { NumberBadge, Text } from "./ui";

// Pieces of the full players, shared by the audio and video ones.

/** A skip button with its seconds drawn inside the arrow. */
export function SkipButton({
  seconds,
  label,
  color,
  onPress,
  children,
}: {
  seconds: number;
  label: string;
  /** The number's colour; the theme's text unless the button sits on a picture. */
  color?: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 56, height: 56, alignItems: "center", justifyContent: "center" }}>
      {children}
      <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 12, lineHeight: 13, includeFontPadding: false, color: color ?? t.text }}>{seconds}</Text>
      </View>
    </Pressable>
  );
}

/** A square tile in the row along the bottom of a full player: Speed, Sleep, Up Next. */
export function Tile({
  label,
  count,
  onPress,
  active,
  disabled,
  children,
}: {
  label: string;
  /** A grey count in the corner, e.g. how much is in Up Next. */
  count?: number;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count}` : label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 64,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        // Frosted white in light mode: a grey wash disappears into the tinted page.
        backgroundColor: t.isDark ? (pressed ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.07)") : pressed ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.65)",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {children}
      <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 11, color: active ? t.accent : t.isDark ? t.muted : t.text2 }}>
        {label}
      </Text>
      {count ? <NumberBadge value={count > 99 ? "99+" : count} style={{ position: "absolute", top: 6, right: 8 }} /> : null}
    </Pressable>
  );
}

/**
 * A ring turning around a play button while a video waits for its next piece, drawn over the
 * button so its play or pause icon stays.
 */
export function BufferingRing({ size, color, on }: { size: number; color: string; on: boolean }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    if (on) turn.value = withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1);
    else {
      cancelAnimation(turn);
      turn.value = 0;
    }
  }, [on, turn]);
  const style = useAnimatedStyle(() => ({ opacity: withTiming(on ? 1 : 0, { duration: 150 }), transform: [{ rotate: `${turn.value}deg` }] }));
  const r = size / 2 - 2;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={`${r * 1.6} ${r * 10}`} />
      </Svg>
    </Animated.View>
  );
}
