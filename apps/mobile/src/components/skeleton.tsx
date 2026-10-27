import { createContext, useContext, useEffect, useState } from "react";
import { View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  FadeIn as FadeInAnimation,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Grid, useGridWidth } from "./library";
import { useTheme } from "@/theme";

// Loading placeholders in the shape of the real screen, like the web's skeletons.tsx, and
// the fade the real content arrives with. Both stay still when the phone asks for reduced motion.

const FADE_MS = 220;
const PULSE_MS = 900;

const Pulse = createContext<SharedValue<number> | null>(null);

/** Wraps a screen's placeholders so they all shimmer together. */
export function Skeleton({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    pulse.set(withRepeat(withTiming(0.45, { duration: PULSE_MS }), -1, true));
    return () => cancelAnimation(pulse);
  }, [pulse, reduced]);
  return (
    <Pulse.Provider value={pulse}>
      <View accessible accessibilityLabel="Loading" style={style}>
        {children}
      </View>
    </Pulse.Provider>
  );
}

/** One grey placeholder block. */
export function Bone({ width = "100%", height, radius = 6, style }: { width?: DimensionValue; height: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const pulse = useContext(Pulse);
  const animated = useAnimatedStyle(() => ({ opacity: pulse ? pulse.get() : 1 }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: t.surface2 }, animated, style]} />;
}

/**
 * Real content arriving after a load: a short fade, or none with reduced motion. The fade
 * plays on mount only, so pass `when={false}` for content that mounts later for other reasons
 * (list rows scrolling in, tab switches).
 */
export function FadeIn({ children, when = true, style }: { children: React.ReactNode; when?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={when ? FadeInAnimation.duration(FADE_MS) : undefined} style={style}>
      {children}
    </Animated.View>
  );
}

/** True for a moment after `ready` turns true: the window in which content should fade in. */
export function useJustLoaded(ready: boolean) {
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setFresh(false), 600);
    return () => clearTimeout(timer);
  }, [ready]);
  return ready && fresh;
}

/** A section heading's placeholder, spaced like SectionTitle. */
export function SectionBone({ width = 140 }: { width?: number }) {
  return <Bone width={width} height={18} style={{ marginTop: 28, marginBottom: 14 }} />;
}

/** Covers three across, each with two lines under it, like the book and podcast grids. */
export function CoverGridBones({ count = 9, columns = 3 }: { count?: number; columns?: number }) {
  const width = useGridWidth(columns);
  return (
    <Grid>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width, gap: 6 }}>
          <Bone width={width} height={width} radius={10} />
          <Bone width="85%" height={13} style={{ marginTop: 2 }} />
          <Bone width="60%" height={11} />
        </View>
      ))}
    </Grid>
  );
}

/** A row with a square thumbnail and lines beside it, for episodes and the queue. */
export function ListRowBone({ thumb = 52, lines = 2, buttons = 0 }: { thumb?: number; lines?: number; buttons?: number }) {
  const widths = ["40%", "80%", "30%"] as const;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
      <Bone width={thumb} height={thumb} radius={8} />
      <View style={{ flex: 1, gap: 8 }}>
        {Array.from({ length: lines }, (_, i) => (
          <Bone key={i} width={widths[i % widths.length]} height={i === 1 ? 14 : 11} />
        ))}
      </View>
      {Array.from({ length: buttons }, (_, i) => (
        <View key={i} style={{ width: 44, alignItems: "center" }}>
          <Bone width={20} height={20} radius={10} />
        </View>
      ))}
    </View>
  );
}
