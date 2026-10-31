import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { fonts, useTheme } from "@/theme";
import { Text } from "./ui";

// Short confirmations ("Added to queue") at the top centre, just below the top action row,
// like the web player's toasts. One can carry an action such as Undo, or two.

type ToastAction = { label: string; onPress: () => void };
type ToastOptions = {
  action?: ToastAction;
  /** A second action, drawn before the first. */
  cancel?: ToastAction;
  duration?: number;
  /** Runs when it goes for any reason: its time is up, an action was tapped, another took its place. */
  onEnd?: () => void;
};
type Toast = { id: number; message: string; error: boolean; duration: number } & Omit<ToastOptions, "duration">;

let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function set(t: Toast | null) {
  const was = current;
  current = t;
  listeners.forEach((l) => l());
  was?.onEnd?.();
}

const VISIBLE_MS = 2200;

export const toast = {
  show: (message: string, opts: ToastOptions = {}) => set({ ...opts, id: nextId++, message, error: false, duration: opts.duration ?? VISIBLE_MS }),
  error: (message: string) => set({ id: nextId++, message, error: true, duration: VISIBLE_MS }),
};

// An open sheet is a modal over everything, so a toast drawn by the app's own Toaster would sit under
// its backdrop, with an Undo out of reach. Each open sheet draws one too, and only the top one shows.
const layers: number[] = [];
let nextLayer = 1;
const layerListeners = new Set<() => void>();
const notifyLayers = () => layerListeners.forEach((l) => l());

/** For a sheet: while `open`, toasts are drawn by its own Toaster with the layer this returns. */
export function useToastLayer(open: boolean): number {
  const [layer] = useState(() => nextLayer++);
  useEffect(() => {
    if (!open) return;
    layers.push(layer);
    notifyLayers();
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      notifyLayers();
    };
  }, [open, layer]);
  return layer;
}

/** Draws the current toast; `layer` is a sheet's (see useToastLayer), 0 for the app's own. */
export function Toaster({ layer = 0 }: { layer?: number }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const item = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const top = useSyncExternalStore(
    (l) => {
      layerListeners.add(l);
      return () => layerListeners.delete(l);
    },
    () => layers.at(-1) ?? 0,
  );
  // A toast stays current until it has faded out, so it's drawn straight from the store.
  const shown = item;
  const anim = useSharedValue(0);
  const fade = useAnimatedStyle(() => ({ opacity: anim.value, transform: [{ translateY: (anim.value - 1) * 8 }] }));

  useEffect(() => {
    if (!item) return;
    const clear = () => {
      if (current?.id === item.id) set(null);
    };
    anim.set(0);
    anim.set(withTiming(1, { duration: 180 }));
    const timer = setTimeout(() => {
      anim.set(
        withTiming(0, { duration: 200 }, (finished) => {
          if (finished) scheduleOnRN(clear);
        }),
      );
    }, item.duration);
    return () => clearTimeout(timer);
  }, [item, anim]);

  if (!shown || top !== layer) return null;
  const color = shown.error ? t.danger : t.isDark ? t.text : t.bg;
  const actions = [shown.cancel, shown.action].filter((a) => a !== undefined);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 56, left: 0, right: 0, alignItems: "center" }}>
      <Animated.View
        accessibilityLiveRegion="polite"
        pointerEvents={actions.length ? "auto" : "none"}
        style={[
          {
            maxWidth: "88%",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingLeft: 16,
            paddingRight: actions.length ? 6 : 16,
            paddingVertical: actions.length ? 4 : 10,
            borderRadius: 20,
            backgroundColor: t.isDark ? t.surface2 : t.text,
            elevation: 8,
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
          },
          fade,
        ]}
      >
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color, flexShrink: 1 }}>{shown.message}</Text>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => {
              a.onPress();
              if (current?.id === shown.id) set(null);
            }}
            style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: t.accent }}>{a.label}</Text>
          </Pressable>
        ))}
      </Animated.View>
    </View>
  );
}
