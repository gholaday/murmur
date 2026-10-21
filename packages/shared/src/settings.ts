import type { ServerVersionDto } from "./index";

// Settings shared by the web player and the Android app.

export type ThemeChoice = "system" | "dark" | "light";

export const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "System" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

/**
 * The line under "Murmur <version>" in Settings: a newer release, "Up to date" once GitHub
 * has been asked, else "Development build" for a dev server. `warn` marks an update.
 */
export function versionStatus(v: ServerVersionDto): { sub: string | null; dot: "ok" | "warn" | null } {
  const update = v.updates?.update;
  if (update) return { sub: `Version ${update.latest} is available`, dot: "warn" };
  if (v.updates?.checked) return { sub: "Up to date", dot: "ok" };
  return { sub: v.devBuild ? "Development build" : null, dot: null };
}
