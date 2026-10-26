import { useEffect, useState } from "react";
import { AppState, type StyleProp, View, type ViewStyle } from "react-native";
import { useIsFocused } from "expo-router";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";

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

function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  return active;
}
