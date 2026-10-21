import { useColorScheme } from "react-native";
import { useSyncExternalStore } from "react";
import type { ThemeChoice } from "@murmur/shared/client";
import { getJson, setJson } from "./lib/storage";

// Colours follow docs/mockups and the web player's tokens.

export const dark = {
  bg: "#111214",
  surface: "#1c1d21",
  surface2: "#26272c",
  chip: "#212226",
  line: "#222327",
  track: "#2b2c31",
  text: "#f3f1ec",
  text2: "#d6d4cf",
  muted: "#a9a7a2",
  faint: "#7e7c78",
  accent: "#8e9bff",
  onAccent: "#141833",
  danger: "#ff8a8a",
  nav: "#17181b",
  tabInactive: "#9a9aa0",
  isDark: true,
};

export const light: typeof dark = {
  bg: "#fafaf8",
  surface: "#ffffff",
  surface2: "#edece8",
  chip: "#edece8",
  line: "#e4e3de",
  track: "#e4e3de",
  text: "#17171a",
  text2: "#3a3936",
  muted: "#6b6a66",
  faint: "#8a8984",
  accent: "#4f5bd5",
  onAccent: "#ffffff",
  danger: "#c43c3c",
  nav: "#ffffff",
  tabInactive: "#8a8984",
  isDark: false,
};

export type Theme = typeof dark;
export type ThemeMode = ThemeChoice;

export const fonts = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  extrabold: "PlusJakartaSans_800ExtraBold",
};

/** Blends two #rrggbb colours; `amount` is the share of `a`. Falls back to `b` if `a` isn't hex. */
export function mixColor(a: string, b: string, amount: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return b;
  return `#${pa.map((v, i) => Math.round(v * amount + pb[i]! * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

const MODE_KEY = "murmur.theme";
const listeners = new Set<() => void>();
let mode: ThemeMode = getJson<ThemeMode>(MODE_KEY) ?? "dark";

export function setThemeMode(next: ThemeMode) {
  mode = next;
  setJson(MODE_KEY, next);
  listeners.forEach((l) => l());
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => mode,
  );
}

/** Dark by default, like the spec; Profile can switch to light or follow the system. */
export function useTheme(): Theme {
  const m = useThemeMode();
  const system = useColorScheme();
  if (m === "system") return system === "light" ? light : dark;
  return m === "light" ? light : dark;
}
