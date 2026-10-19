export type ThemeChoice = "system" | "dark" | "light";

export const THEME_COOKIE = "murmur_theme";

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === "system" || v === "dark" || v === "light";
}

/** Applies a theme now and remembers it in a cookie, so the server renders it next time. */
export function applyTheme(choice: ThemeChoice) {
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=${400 * 24 * 60 * 60}; samesite=lax`;
}

export function currentTheme(): ThemeChoice {
  const match = /(?:^|; )murmur_theme=(\w+)/.exec(document.cookie);
  return isThemeChoice(match?.[1]) ? match[1] : "system";
}
