import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, useTheme } from "@/theme";
import { Text } from "./ui";

// Short confirmations ("Added to Up Next") at the top centre, just below the top action row,
// like the web player's toasts.

type Toast = { id: number; message: string; error: boolean };

let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function set(t: Toast | null) {
  current = t;
  listeners.forEach((l) => l());
}

export const toast = {
  show: (message: string) => set({ id: nextId++, message, error: false }),
  error: (message: string) => set({ id: nextId++, message, error: true }),
};

const VISIBLE_MS = 2200;

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
  const [shown, setShown] = useState<Toast | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!item) return;
    setShown(item);
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        if (current?.id === item.id) set(null);
      });
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [item, anim]);

  if (!shown) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: insets.top + 56, left: 0, right: 0, alignItems: "center" }}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={{
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
          maxWidth: "88%",
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 20,
          backgroundColor: t.isDark ? t.surface2 : t.text,
          elevation: 8,
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: shown.error ? t.danger : t.isDark ? t.text : t.bg }}>{shown.message}</Text>
      </Animated.View>
    </View>
  );
}
