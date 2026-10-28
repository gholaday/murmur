import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { type PlayerState, usePlayerSelect } from "@/player/engine";
import { PlayIcon } from "./icons";

// Same as the web's mixer (web/mixer.tsx): light bars on a dark disc in both themes, so it reads on any cover.
const DISC = "rgba(11, 11, 13, 0.62)";
const BAR = "#8e9bff";
/**
 * Each bar's loop, how far into it the bar starts (so they bounce out of step), and its height at
 * rest while paused: together the rests make the app icon's shape.
 */
const BARS = [
  { ms: 820, offset: 300, rest: 1 },
  { ms: 1060, offset: 600, rest: 0.75 },
  { ms: 740, offset: 100, rest: 0.54 },
  { ms: 950, offset: 450, rest: 0.75 },
  { ms: 880, offset: 750, rest: 1 },
];
const EASE = Easing.inOut(Easing.ease);
const FALL = { duration: 500, easing: Easing.bezier(0.3, 0, 0.2, 1) };

/** Whether the thing a card shows is what's loaded in the player: "playing", "paused", or null. */
export function useNowPlaying(match: (s: PlayerState) => boolean): "playing" | "paused" | null {
  return usePlayerSelect((s) => (match(s) ? (s.playing ? "playing" : "paused") : null));
}

type BarsSize = { width: number; gap: number; height: number };
const DISC_BARS: BarsSize = { width: 3, gap: 3, height: 18 };
const SMALL_BARS: BarsSize = { width: 2, gap: 2, height: 14 };

/** The five bouncing bars. Pausing settles each from wherever it was into the icon's shape. */
function Bars({ playing, color, size }: { playing: boolean; color: string; size: BarsSize }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: size.gap, height: size.height }}>
      {BARS.map((b, i) => (
        <Bar key={i} {...b} width={size.width} color={color} playing={playing} />
      ))}
    </View>
  );
}

/** Just the bars, in the text colour: they stand in for the playing song's number in a track list. */
export function MixerBars({ playing, color }: { playing: boolean; color: string }) {
  return <Bars playing={playing} color={color} size={{ width: 2, gap: 2, height: 14 }} />;
}

/**
 * Bouncing bars on a dark disc, centered on the cover of whatever is playing. `thumb` fills a list
 * thumbnail instead (`radius` matching it). `resume` shows Play while paused, for the Up Next row
 * that resumes when tapped.
 */
export function Mixer({ playing, thumb = false, radius = 8, resume = false }: { playing: boolean; thumb?: boolean; radius?: number; resume?: boolean }) {
  return (
    <View pointerEvents="none" style={thumb ? [styles.thumb, { borderRadius: radius }] : styles.disc}>
      {resume && !playing ? <PlayIcon size={18} color={BAR} /> : <Bars playing={playing} color={BAR} size={thumb ? SMALL_BARS : DISC_BARS} />}
    </View>
  );
}

/**
 * One bar's height, as the web's keyframes: .25, .9 at 35%, .45 at 65%, 1, then back the same way.
 * Playing starts the loop from wherever the bar is; pausing eases it to its rest.
 */
function Bar({ ms, offset, rest, width, color, playing }: { ms: number; offset: number; rest: number; width: number; color: string; playing: boolean }) {
  const reduced = useReducedMotion();
  // Already paused when it appears: at rest from the start.
  const scale = useSharedValue(playing ? 0.25 : rest);
  useEffect(() => {
    if (reduced) return;
    cancelAnimation(scale);
    if (!playing) {
      scale.value = withTiming(rest, FALL);
      return;
    }
    const step = (to: number, share: number) => withTiming(to, { duration: ms * share, easing: EASE });
    const up = [step(0.9, 0.35), step(0.45, 0.3), step(1, 0.35)];
    const down = [step(0.45, 0.35), step(0.9, 0.3), step(0.25, 0.35)];
    // The first rise is cut short by the bar's offset, so the four start out of step.
    scale.value = withSequence(
      withTiming(1, { duration: Math.max(120, ms - offset), easing: EASE }),
      withRepeat(withSequence(...down, ...up), -1),
    );
    return () => cancelAnimation(scale);
  }, [playing, reduced, ms, offset, rest, scale]);
  // Reduced motion: still bars, in the icon's shape while paused.
  const still = playing ? 0.6 : rest;
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: reduced ? still : scale.value }] }));
  return <Animated.View style={[{ width, height: "100%", borderRadius: 2, backgroundColor: color, transformOrigin: "bottom" }, style]} />;
}

const styles = StyleSheet.create({
  disc: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 44,
    height: 44,
    marginLeft: -22,
    marginTop: -22,
    borderRadius: 22,
    backgroundColor: DISC,
    alignItems: "center",
    justifyContent: "center",
  },
  thumb: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: DISC,
    alignItems: "center",
    justifyContent: "center",
  },
});
