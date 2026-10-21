import { useState } from "react";
import { Animated, type LayoutChangeEvent, View } from "react-native";
import { useTheme } from "@/theme";
import { PAD } from "./library";
import { useTopInset } from "./page";
import { CountPill, Text } from "./ui";

/**
 * A section heading that sticks under the status bar while the list below it scrolls. Pass
 * `scrollProps` to an Animated scroll view or list whose `stickyHeaderIndices` points at the
 * heading, `topProps` to the View just above it, and `cover` to the heading. Neither the list
 * nor its content container should pad its sides; the items do.
 *
 * The View above ends in a spacer a status bar tall that the heading overlaps, so the heading
 * sticks a status bar early: its padding then sits under the status bar and the title just
 * below. That padding is see-through until it sticks and solid after, so rows pass under the
 * status bar.
 */
export function useStickyHeading() {
  const top = useTopInset();
  const [y] = useState(() => new Animated.Value(0));
  const [onScroll] = useState(() => Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true }));
  const [at, setAt] = useState(0);
  const cover = y.interpolate({ inputRange: [at - 1, at], outputRange: [0, 1], extrapolate: "clamp" });
  return {
    scrollProps: { onScroll, scrollEventThrottle: 16 },
    topProps: {
      onLayout: (e: LayoutChangeEvent) => setAt(e.nativeEvent.layout.y + e.nativeEvent.layout.height - top),
      // The spacer plus the gap above the heading, and the overlap.
      style: { paddingBottom: top + 16, marginBottom: -top },
    },
    cover,
  };
}

export function StickyHeading({
  title,
  count,
  right,
  cover,
  children,
}: {
  title: string;
  count?: number;
  right?: React.ReactNode;
  cover: Animated.AnimatedInterpolation<number>;
  /** Shown under the title and sticking with it, e.g. a search box. */
  children?: React.ReactNode;
}) {
  const t = useTheme();
  const top = useTopInset();
  return (
    <View style={{ paddingTop: top }}>
      <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: top, backgroundColor: t.bg, opacity: cover }} />
      <View style={{ backgroundColor: t.bg, paddingHorizontal: PAD, paddingBottom: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
            <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
              {title}
            </Text>
            {count !== undefined ? <CountPill count={count} /> : null}
          </View>
          {right}
        </View>
        {children}
      </View>
    </View>
  );
}
