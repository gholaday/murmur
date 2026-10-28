import { useEffect, useState } from "react";
import { AppState, type StyleProp, type TextStyle, View, type ViewStyle } from "react-native";
import { useIsFocused } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Text } from "./ui";

/** Space between the end of the line and its next lap. */
const GAP = 48;
/** Scroll speed in points per second, and the pause before each lap. */
const SPEED = 22;
const REST_MS = 3000;

/**
 * One line that scrolls sideways when it's too wide to fit, and stays still when it fits. The
 * scroll runs on the UI thread and only restarts when the line's width changes, so text that
 * ticks in place (a time left in tabular digits) doesn't jolt it. It stops while the screen is
 * covered or the app is in the background.
 */
export function Marquee({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const [box, setBox] = useState(0);
  const [width, setWidth] = useState(0);
  const focused = useIsFocused();
  const active = useAppActive();
  const x = useSharedValue(0);
  const overflows = box > 0 && width > box + 1;
  const run = overflows && focused && active;

  useEffect(() => {
    cancelAnimation(x);
    x.set(0);
    if (!run) return;
    const lap = width + GAP;
    x.set(
      withRepeat(
        withSequence(withDelay(REST_MS, withTiming(-lap, { duration: (lap / SPEED) * 1000, easing: Easing.linear })), withTiming(0, { duration: 0 })),
        -1,
      ),
    );
    return () => cancelAnimation(x);
  }, [run, width, x]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={[{ overflow: "hidden" }, style]} onLayout={(e) => setBox(e.nativeEvent.layout.width)}>
      {/* Wide enough that the line never wraps, so its own width can be measured. */}
      <Animated.View style={[{ flexDirection: "row", width: 10_000 }, slide]}>
        <View style={{ flexDirection: "row", alignItems: "center" }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {children}
        </View>
        {/* A second copy follows the first, so each lap ends where it started. */}
        {overflows ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginLeft: GAP }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {children}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

// A row's title, as the web's marquee (web/marquee.tsx): a 12 s loop that holds still for its first 15%.
const LOOP_MS = 12000;
const HOLD_MS = LOOP_MS * 0.15;
const TITLE_GAP = 40;
const FADE = 16;

/**
 * A title that scrolls sideways when it doesn't fit, fading at the right edge, so a long one can be
 * read in a tight row (Up Next). With reduced motion it ends in an ellipsis instead. `fadeTo` is
 * the colour behind it, as #rrggbb.
 */
export function MarqueeText({
  text,
  variant,
  style,
  fadeTo,
}: {
  text: string;
  variant?: "title" | "bodyStrong" | "small";
  style?: StyleProp<TextStyle>;
  fadeTo: string;
}) {
  const reduced = useReducedMotion();
  const [box, setBox] = useState(0);
  const [full, setFull] = useState(0);
  const moving = !reduced && box > 0 && full - TITLE_GAP > box + 1;
  const x = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(x);
    x.set(0);
    if (!moving) return;
    x.set(
      withRepeat(
        withSequence(withTiming(0, { duration: HOLD_MS }), withTiming(-full, { duration: LOOP_MS - HOLD_MS, easing: Easing.linear }), withTiming(0, { duration: 0 })),
        -1,
      ),
    );
    return () => cancelAnimation(x);
  }, [moving, full, x]);
  const track = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={{ overflow: "hidden" }} onLayout={(e) => setBox(e.nativeEvent.layout.width)}>
      {/* Sets the line's height, and is the text itself when it fits. */}
      <Text variant={variant} numberOfLines={1} style={[style, moving ? { opacity: 0 } : null]}>
        {text}
      </Text>
      <View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{ position: "absolute", left: 0, top: 0, width: 10_000, flexDirection: "row", opacity: moving ? 1 : 0 }}
      >
        <Animated.View style={[{ flexDirection: "row" }, track]}>
          {/* Measured at its natural width, to know whether the text fits. */}
          <Text variant={variant} style={[style, { paddingRight: TITLE_GAP }]} onLayout={(e) => setFull(e.nativeEvent.layout.width)}>
            {text}
          </Text>
          {moving ? (
            <Text variant={variant} style={[style, { paddingRight: TITLE_GAP }]}>
              {text}
            </Text>
          ) : null}
        </Animated.View>
      </View>
      {moving ? (
        <LinearGradient
          pointerEvents="none"
          colors={[`${fadeTo}00`, fadeTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: FADE }}
        />
      ) : null}
    </View>
  );
}

function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  return active;
}
