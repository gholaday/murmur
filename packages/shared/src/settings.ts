// Per-device settings shared by the web player and the Android app.

export type ThemeChoice = "system" | "dark" | "light";

export const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "System" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];
