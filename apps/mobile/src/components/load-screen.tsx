import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import Animated, { FadeOut, useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, type SharedValue } from "react-native-reanimated";

/** The app icon's box, 29 units across, and its bars on their baseline. */
const MARK = { box: 29, boxRadius: 7, boxColor: "#141833", barColor: "#8E9BFF", barWidth: 3, barLefts: [3, 8, 13, 18, 23], baseline: 22, heights: [15, 11, 8, 11, 15] };

// The system splash's background and the size its mark shows at, so this follows it without a jump.
const BACKGROUND = "#111214";
const SIZE = 132;
const UNIT = SIZE / MARK.box;

const EASE_IN_MS = 240;
const DANCE_MS = 1200;
const SETTLE_MS = 340;
const STAGGER_MS = [0, 60, 120, 60, 0];
const SPEED = [0.0071, 0.0103, 0.0086, 0.0119, 0.0064];
const FADE_MS = 220;

/** Only the first time the app starts. Android can rebuild this screen around a running app. */
let played = false;

// The splash shows the same M in the same place, so it can go at once: a fade would show the bars
// starting to dance under it.
SplashScreen.setOptions({ duration: 0 });

/** A bar's height while dancing, at its own pace. */
function dance(i: number, t: number) {
  "worklet";
  return 11.5 + 7 * Math.sin(t * SPEED[i]! + i * 1.3) * (0.7 + 0.3 * Math.sin(t * 0.0031 + i));
}

/** A little past the target, then back, like a bar landing. */
function landing(x: number) {
  "worklet";
  return 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
}

/**
 * The cold start, over the app as it loads: the icon's bars dance, then land in the M, and the app
 * fades in. They dance until `ready`. This draws as soon as there's a screen to draw on and takes
 * over from the system splash, which would otherwise wait for the router to be ready.
 */
export function LoadScreen({ ready }: { ready: boolean }) {
  const reduced = useReducedMotion();
  const [done, setDone] = useState(played);
  const time = useSharedValue(0);
  const landAt = useSharedValue(-1);

  useFrameCallback((frame) => {
    time.value = frame.timeSinceFirstFrame;
  }, !reduced);

  useEffect(() => {
    if (!ready || done) return;
    const finish = () => {
      played = true;
      setDone(true);
    };
    if (reduced) return finish();
    let finishing: ReturnType<typeof setTimeout>;
    const land = setTimeout(
      () => {
        landAt.value = time.value;
        finishing = setTimeout(finish, Math.max(...STAGGER_MS) + SETTLE_MS);
      },
      Math.max(0, DANCE_MS - time.value),
    );
    return () => {
      clearTimeout(land);
      clearTimeout(finishing);
    };
  }, [ready, done, reduced, landAt, time]);

  if (done) return null;
  return (
    <Animated.View
      exiting={reduced ? undefined : FadeOut.duration(FADE_MS)}
      onLayout={() => SplashScreen.hide()}
      accessible
      accessibilityLabel="Loading"
      style={styles.screen}
    >
      <StatusBar style="light" />
      <View style={styles.box}>
        {MARK.heights.map((h, i) => (
          <Bar key={i} index={i} target={h} time={time} landAt={landAt} still={reduced} />
        ))}
      </View>
    </Animated.View>
  );
}

function Bar({ index, target, time, landAt, still }: { index: number; target: number; time: SharedValue<number>; landAt: SharedValue<number>; still: boolean }) {
  const style = useAnimatedStyle(() => {
    const t = time.value;
    const begin = landAt.value < 0 ? Infinity : landAt.value + STAGGER_MS[index]!;
    let height: number;
    if (still) height = target;
    else if (t >= begin) {
      const from = dance(index, begin);
      height = from + (target - from) * landing(Math.min(1, (t - begin) / SETTLE_MS));
    } else {
      // Starts from the M the splash left on screen.
      const eased = Math.min(1, t / EASE_IN_MS);
      height = target + (dance(index, t) - target) * eased;
    }
    return { height: height * UNIT };
  });
  return <Animated.View style={[styles.bar, { left: MARK.barLefts[index]! * UNIT }, style]} />;
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, backgroundColor: BACKGROUND, alignItems: "center", justifyContent: "center" },
  box: { width: SIZE, height: SIZE, borderRadius: MARK.boxRadius * UNIT, backgroundColor: MARK.boxColor },
  bar: {
    position: "absolute",
    bottom: (MARK.box - MARK.baseline) * UNIT,
    width: MARK.barWidth * UNIT,
    borderRadius: (MARK.barWidth / 2) * UNIT,
    backgroundColor: MARK.barColor,
  },
});
