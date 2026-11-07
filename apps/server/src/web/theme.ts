import type { ThemeChoice } from "@murmur/shared/client";

export type { ThemeChoice };

export const THEME_COOKIE = "murmur_theme";

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === "system" || v === "dark" || v === "light";
}

/**
 * Runs in the page's head before anything paints. `data-theme` is always "light" or "dark", so the
 * stylesheet writes each light rule once: a chosen theme comes from the server, and "System" (no
 * `data-theme` yet) follows the device, now and when it changes. `data-theme-choice` says which.
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement,m=matchMedia("(prefers-color-scheme: light)");function f(){if(d.dataset.themeChoice==="system")d.dataset.theme=m.matches?"light":"dark"}f();m.addEventListener("change",f)})()`;

/** Applies a theme now and remembers it in a cookie, so the server renders it next time. */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  root.dataset.themeChoice = choice;
  root.dataset.theme = choice === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : choice;
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=${400 * 24 * 60 * 60}; samesite=lax`;
}

export function currentTheme(): ThemeChoice {
  const match = /(?:^|; )murmur_theme=(\w+)/.exec(document.cookie);
  return isThemeChoice(match?.[1]) ? match[1] : "system";
}
