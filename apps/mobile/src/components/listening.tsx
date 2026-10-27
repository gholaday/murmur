import { useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { selectHaptic } from "@/lib/haptics";
import { fonts, useTheme } from "@/theme";
import { NumberBadge, Text } from "./ui";

// The Listening tab holds Up Next and Downloaded, switched at the top. Which one shows is kept
// here, so another screen can open the tab on Up Next.

export type ListeningView = "up-next" | "downloaded";

let view: ListeningView = "up-next";
const listeners = new Set<() => void>();

export function setListeningView(next: ListeningView) {
  view = next;
  listeners.forEach((l) => l());
}

export function useListeningView(): ListeningView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => view,
  );
}

/** Opens the Listening tab on Up Next, e.g. from the player or a book's queue button. */
export function openUpNext() {
  setListeningView("up-next");
  router.navigate("/listening");
}

/** Two segments, each with a count; the selected one's count is accent. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; count: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 4, padding: 4, borderRadius: 12, backgroundColor: t.surface }}>
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${o.label}, ${o.count}`}
            onPress={() => {
              if (selected) return;
              selectHaptic();
              onChange(o.id);
            }}
            style={{
              flex: 1,
              height: 40,
              borderRadius: 9,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              backgroundColor: selected ? t.surface2 : "transparent",
            }}
          >
            <Text style={{ fontFamily: selected ? fonts.bold : fonts.semibold, fontSize: 14, color: selected ? t.text : t.muted }}>{o.label}</Text>
            <NumberBadge value={o.count} tone={selected ? "new" : "count"} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** A line under the switcher: a short summary on the left, an action on the right. */
export function ListMeta({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, marginTop: 4 }}>
      <Text variant="small">{text}</Text>
      {action}
    </View>
  );
}

export function Eyebrow({ children }: { children: string }) {
  return (
    <Text variant="caption" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>
      {children}
    </Text>
  );
}
