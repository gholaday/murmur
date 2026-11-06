import { useEffect, useRef } from "react";
import { Pressable, ScrollView, type ScrollViewInstance, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { selectHaptic } from "@/lib/haptics";
import { fonts, useTheme } from "@/theme";
import { PAD } from "./library";
import { Text } from "./ui";

const SLIDE_MS = 280;
const FADE_MS = 220;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

/** Where each remembered tab row's line last was, and when. */
const lastLine = new Map<string, { value: unknown; x: number; width: number; at: number }>();

/**
 * Text tabs that switch what a screen shows: muted words, the picked one in the text colour, with
 * one accent underline over a hairline that slides to whichever is picked. They run to the edge
 * and scroll sideways when they don't fit, bringing the picked one into view. Chips stay for
 * filters and settings.
 */
export function TextTabs<T extends string | number>({
  options,
  value,
  onPick,
  label,
  inset = PAD,
  style,
  memoryKey,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onPick: (id: T) => void;
  /** Read out for the group, e.g. "Period". */
  label?: string;
  /** The padding of what they sit in, which they reach through to the edge. */
  inset?: number;
  style?: StyleProp<ViewStyle>;
  /** For tabs that remount when switched: where the line was is kept under this, so it still slides. */
  memoryKey?: string;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const scroll = useRef<ScrollViewInstance>(null);
  const spots = useRef(new Map<T, { x: number; width: number }>());
  const box = useRef(0);
  const lineX = useSharedValue(0);
  const lineWidth = useSharedValue(0);
  // Until the picked tab is measured, the line has nowhere to be; the first place it gets, it
  // takes without sliding.
  const placed = useRef(false);

  const moveLine = (to: T, slide: boolean) => {
    const spot = spots.current.get(to);
    if (!spot) return;
    // Tabs remounted by their own switch (a screen whose list changes with the tab) slide on from
    // where the line just was.
    const last = memoryKey ? lastLine.get(memoryKey) : undefined;
    if (!placed.current && last && last.value !== to && Date.now() - last.at < 1000 && !reduced) {
      lineX.set(last.x);
      lineWidth.set(last.width);
      placed.current = true;
      slide = true;
    }
    if (memoryKey) lastLine.set(memoryKey, { value: to, x: spot.x, width: spot.width, at: Date.now() });
    if (slide && placed.current && !reduced) {
      lineX.set(withTiming(spot.x, { duration: SLIDE_MS, easing: EASE }));
      lineWidth.set(withTiming(spot.width, { duration: SLIDE_MS, easing: EASE }));
    } else {
      lineX.set(spot.x);
      lineWidth.set(spot.width);
    }
    placed.current = true;
  };

  // Slides the line over, and keeps the picked tab on screen, as when Search opens on a kind's tab.
  useEffect(() => {
    moveLine(value, true);
    const spot = spots.current.get(value);
    if (!spot || !box.current) return;
    const right = spot.x + spot.width + inset;
    if (right > box.current) scroll.current?.scrollTo({ x: right - box.current, animated: !reduced });
    else if (spot.x - inset < 0) scroll.current?.scrollTo({ x: 0, animated: !reduced });
    // moveLine reads refs and shared values only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, inset, reduced]);

  const line = useAnimatedStyle(() => ({ width: lineWidth.value, transform: [{ translateX: lineX.value }] }));

  return (
    <View style={[{ marginHorizontal: -inset }, style]} accessibilityRole="tablist" accessibilityLabel={label}>
      {/* The hairline stays put under tabs that scroll. */}
      <View pointerEvents="none" style={{ position: "absolute", left: inset, right: inset, bottom: 0, height: 1, backgroundColor: t.line }} />
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={(e) => (box.current = e.nativeEvent.layout.width)}
        contentContainerStyle={{ paddingHorizontal: inset, gap: 24 }}
      >
        {options.map((o) => {
          const selected = o.id === value;
          return (
            <Pressable
              key={String(o.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onLayout={(e) => {
                spots.current.set(o.id, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width });
                if (o.id === value) moveLine(o.id, false);
              }}
              onPress={() => {
                if (!selected) selectHaptic();
                // Stamped as the switch starts, so the line the next mount finds is fresh.
                const from = spots.current.get(value);
                if (memoryKey && from) lastLine.set(memoryKey, { value, x: from.x, width: from.width, at: Date.now() });
                onPick(o.id);
              }}
              hitSlop={{ left: 12, right: 12 }}
              style={{ paddingTop: 10, paddingBottom: 12 }}
            >
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: selected ? t.text : t.muted }}>{o.label}</Text>
            </Pressable>
          );
        })}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, bottom: 0, height: 2, borderRadius: 1, backgroundColor: t.accent }, line]} />
      </ScrollView>
    </View>
  );
}

/**
 * Fades what's under a screen's text tabs in when the tab changes (not when the screen opens).
 * Spread the style onto each part of the content that changes with the tab.
 */
export function useTabFade(tab: unknown) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  const shown = useRef(tab);
  useEffect(() => {
    if (shown.current === tab) return;
    shown.current = tab;
    if (reduced) return;
    opacity.set(0);
    opacity.set(withTiming(1, { duration: FADE_MS }));
  }, [tab, reduced, opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}
