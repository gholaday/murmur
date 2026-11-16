import { useState } from "react";
import { Animated, type LayoutChangeEvent, View } from "react-native";
import { useTheme } from "@/theme";
import { PAD } from "./library";
import { useTopInset } from "./page";
import { CountPill, Text } from "./ui";

/**
 * A section heading that sticks under the status bar while the list below it scrolls. Pass
 * `scrollProps` to an Animated scroll view or list whose `stickyHeaderIndices` points at the
 * heading, `topProps` to the View just above it, and `sticky` to the heading. Neither the list
 * nor its content container should pad its sides; the items do.
 *
 * On the page the heading sits just under what's above it. As it reaches the status bar it
 * stops there, sliding down as the page goes up, until the list's own sticking takes over; a
 * strip the colour of the page then fills in behind the status bar, so rows pass under it. It
 * moves by transform only, so nothing changes size and nothing jumps.
 */
export function useStickyHeading() {
  const top = useTopInset();
  const [y] = useState(() => new Animated.Value(0));
  const [onScroll] = useState(() => Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true }));
  // Where the page has scrolled when the heading reaches the status bar.
  const [at, setAt] = useState(0);
  const cover = y.interpolate({ inputRange: [at - 1, at], outputRange: [0, 1], extrapolate: "clamp" });
  // The list sticks it at the very top a status bar later; this keeps it below the status bar.
  const shift = y.interpolate({ inputRange: [at, at + top], outputRange: [0, top], extrapolate: "clamp" });
  return {
    scrollProps: { onScroll, scrollEventThrottle: 16 },
    topProps: {
      onLayout: (e: LayoutChangeEvent) => setAt(e.nativeEvent.layout.y + e.nativeEvent.layout.height - top),
      // The gap above the heading.
      style: { paddingBottom: 12 },
    },
    sticky: { cover, shift },
  };
}

export function StickyHeading({
  title,
  count,
  right,
  sticky,
  children,
}: {
  /** Left out when the children make the heading, e.g. text tabs. */
  title?: string;
  count?: number;
  right?: React.ReactNode;
  sticky: ReturnType<typeof useStickyHeading>["sticky"];
  /** Shown under the title and sticking with it, e.g. a search box. */
  children?: React.ReactNode;
}) {
  const t = useTheme();
  const top = useTopInset();
  return (
    <Animated.View style={{ transform: [{ translateY: sticky.shift }] }}>
      <Animated.View pointerEvents="none" style={{ position: "absolute", top: -top, left: 0, right: 0, height: top, backgroundColor: t.bg, opacity: sticky.cover }} />
      <View style={{ backgroundColor: t.bg, paddingHorizontal: PAD, paddingBottom: 6 }}>
        {title !== undefined ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
              <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
                {title}
              </Text>
              {count !== undefined ? <CountPill count={count} /> : null}
            </View>
            {right}
          </View>
        ) : null}
        {children}
      </View>
    </Animated.View>
  );
}
