import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, type ScrollViewInstance, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedViewClass from "@react-native-masked-view/masked-view";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { selectHaptic } from "@/lib/haptics";
import { fonts, useTheme } from "@/theme";
import { PAD } from "./library";
import { Text } from "./ui";

const SLIDE_MS = 280;
const FADE_MS = 220;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
/** How far the row fades at an edge with more to scroll to, like the web's. */
const EDGE_FADE = 48;

const MaskedView = MaskedViewClass as unknown as React.ComponentType<ViewProps & { maskElement: React.ReactElement }>;

/** Where each remembered tab row's line last was, and when. */
const lastLine = new Map<string, { value: unknown; x: number; width: number; at: number }>();
/** The time, for lastLine; only ever read from layout and press handlers. */
const now = () => Date.now();

/**
 * The one way to switch views of a screen (Home / Authors / Series, To review / Applied / No match);
 * never pill chips. Muted words, the picked one in the text colour, with one accent underline over
 * a hairline that slides to whichever is picked. They run to the edge and scroll sideways when they
 * don't fit, bringing the picked one into view. Chips stay for turning things on and off and for
 * picking a value inside a sheet.
 */
export function TextTabs<T extends string | number>({
  options,
  value,
  onPick,
  label,
  inset = PAD,
  style,
  memoryKey,
  trailing,
  gap = 24,
  fade = true,
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
  /** Icon buttons on the right of the same row, over the same hairline (a show page's search and sort). */
  trailing?: React.ReactNode;
  /** Space between the tabs; a row sharing its width with icons uses less. */
  gap?: number;
  /**
   * False for a few tabs that always fit, in a list's sticky cell: there Android's mask swallows
   * the taps.
   */
  fade?: boolean;
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
    if (!placed.current && last && last.value !== to && now() - last.at < 1000 && !reduced) {
      lineX.set(last.x);
      lineWidth.set(last.width);
      placed.current = true;
      slide = true;
    }
    if (memoryKey) lastLine.set(memoryKey, { value: to, x: spot.x, width: spot.width, at: now() });
    if (slide && placed.current && !reduced) {
      lineX.set(withTiming(spot.x, { duration: SLIDE_MS, easing: EASE }));
      lineWidth.set(withTiming(spot.width, { duration: SLIDE_MS, easing: EASE }));
    } else {
      lineX.set(spot.x);
      lineWidth.set(spot.width);
    }
    placed.current = true;
  };

  // How far the row is scrolled and how long it is, for the fades and bringing a tab into view.
  const scrollX = useRef(0);
  const content = useRef(0);
  const [edges, setEdges] = useState({ left: false, right: false, width: 0 });
  const updateEdges = () => {
    const width = box.current;
    const left = scrollX.current > 1;
    const right = content.current - width - scrollX.current > 1;
    setEdges((e) => (e.left === left && e.right === right && e.width === width ? e : { left, right, width }));
  };

  // Keeps the picked tab on screen, clear of the fades.
  const bringIntoView = (animated: boolean) => {
    const spot = spots.current.get(value);
    if (!spot || !box.current) return;
    const max = Math.max(0, content.current - box.current);
    const right = spot.x + spot.width + EDGE_FADE;
    const left = spot.x - EDGE_FADE;
    let x: number | null = null;
    if (right > scrollX.current + box.current) x = Math.min(max, right - box.current);
    else if (left < scrollX.current) x = Math.max(0, left);
    if (x === null) return;
    scroll.current?.scrollTo({ x, animated });
    if (!animated) {
      scrollX.current = x;
      updateEdges();
    }
  };
  // Until the row and the picked tab are both measured, the tab can't be brought into view; the
  // first time they are, it's put there without scrolling, as when a screen opens on a far tab.
  const shown = useRef(false);
  const firstView = () => {
    if (shown.current || !spots.current.has(value) || !box.current || !content.current) return;
    shown.current = true;
    bringIntoView(false);
  };

  // Slides the line over, and scrolls the picked tab into view, as when Search's kind changes.
  useEffect(() => {
    moveLine(value, true);
    bringIntoView(!reduced);
    // moveLine and bringIntoView read refs and shared values only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, inset, reduced]);

  const Fader = fade ? MaskedView : View;
  const line = useAnimatedStyle(() => ({ width: lineWidth.value, transform: [{ translateX: lineX.value }] }));

  return (
    <View
      style={[{ marginHorizontal: -inset }, trailing ? { flexDirection: "row", alignItems: "center" } : null, style]}
      accessibilityRole="tablist"
      accessibilityLabel={label}
    >
      {/* The hairline stays put under tabs that scroll. */}
      <View pointerEvents="none" style={{ position: "absolute", left: inset, right: inset, bottom: 0, height: 1, backgroundColor: t.line }} />
      {/* Fades out over EDGE_FADE at an edge with more to scroll to. */}
      <Fader
        style={trailing ? { flex: 1 } : null}
        maskElement={
          <LinearGradient
            colors={[edges.left ? "transparent" : "#000", "#000", "#000", edges.right ? "transparent" : "#000"]}
            locations={edges.width ? [0, EDGE_FADE / edges.width, 1 - EDGE_FADE / edges.width, 1] : [0, 0, 1, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ flex: 1 }}
          />
        }
      >
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => {
          scrollX.current = e.nativeEvent.contentOffset.x;
          updateEdges();
        }}
        onContentSizeChange={(w) => {
          content.current = w;
          updateEdges();
          firstView();
        }}
        onLayout={(e) => {
          box.current = e.nativeEvent.layout.width;
          updateEdges();
          firstView();
        }}
        contentContainerStyle={{ paddingHorizontal: inset, gap }}
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
                if (o.id === value) {
                  moveLine(o.id, false);
                  firstView();
                }
              }}
              onPress={() => {
                if (!selected) selectHaptic();
                // Stamped as the switch starts, so the line the next mount finds is fresh.
                const from = spots.current.get(value);
                if (memoryKey && from) lastLine.set(memoryKey, { value, x: from.x, width: from.width, at: now() });
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
      </Fader>
      {trailing ? <View style={{ flexDirection: "row", marginRight: inset - 10 }}>{trailing}</View> : null}
    </View>
  );
}

const NOT_SHOWN = Symbol("not shown");

/**
 * Fades what's under a screen's text tabs in when the tab changes (and when the screen opens, with
 * `onOpen`). Spread the style onto each part of the content that changes with the tab.
 */
export function useTabFade(tab: unknown, onOpen = false) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(onOpen && !reduced ? 0 : 1);
  const shown = useRef(onOpen ? NOT_SHOWN : tab);
  useEffect(() => {
    if (shown.current === tab) return;
    shown.current = tab;
    if (reduced) return;
    opacity.set(0);
    opacity.set(withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.cubic) }));
  }, [tab, reduced, opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}
