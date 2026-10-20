import { useEffect, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { fonts, useTheme } from "@/theme";
import { Text } from "./ui";

// Short confirmations ("Added to Up Next") at the top centre, just below the top action row,
// like the web player's toasts. One can carry an action such as Undo.

type ToastAction = { label: string; onPress: () => void };
type ToastOptions = { action?: ToastAction; duration?: number };
type Toast = { id: number; message: string; error: boolean; action?: ToastAction; duration: number };

let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function set(t: Toast | null) {
  current = t;
  listeners.forEach((l) => l());
}

const VISIBLE_MS = 2200;

export const toast = {
  show: (message: string, opts: ToastOptions = {}) =>
    set({ id: nextId++, message, error: false, action: opts.action, duration: opts.duration ?? VISIBLE_MS }),
  error: (message: string) => set({ id: nextId++, message, error: true, duration: VISIBLE_MS }),
};

export function Toaster() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const item = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
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

  if (!shown) return null;
  const color = shown.error ? t.danger : t.isDark ? t.text : t.bg;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 56, left: 0, right: 0, alignItems: "center" }}>
      <Animated.View
        accessibilityLiveRegion="polite"
        pointerEvents={shown.action ? "auto" : "none"}
        style={[
          {
            maxWidth: "88%",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingLeft: 16,
            paddingRight: shown.action ? 6 : 16,
            paddingVertical: shown.action ? 4 : 10,
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
        {shown.action && (
          <Pressable
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => {
              shown.action?.onPress();
              if (current?.id === shown.id) set(null);
            }}
            style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: t.accent }}>{shown.action.label}</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}
