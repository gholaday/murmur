"use client";

import { useSyncExternalStore } from "react";

/**
 * The wide layout: sidebar, page and player bar instead of bottom tabs. The stylesheets say
 * the same with `@media (min-width: 900px)` (and `max-width: 899px` below it); CSS can't read
 * a variable in a media query, so keep the number in step with them.
 */
const WIDE = "(min-width: 900px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The window is at the wide layout's width; false on the server and in the first render. */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** Back to the top of the page: the window scrolls on phones, the page area on wide screens. */
export function scrollPageToTop() {
  window.scrollTo(0, 0);
  document.querySelector(".shell > .page")?.scrollTo(0, 0);
}
