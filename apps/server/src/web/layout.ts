"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";

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

/** When Back or Forward was last pressed. */
let poppedAt = -Infinity;

/**
 * On wide screens the page area scrolls instead of the window, so it takes on two jobs the
 * browser does for the window: it gets the keyboard focus when a page opens (so Space, Page
 * Down and the arrows scroll it without a click first), and Back and Forward return it to where
 * that page was scrolled to.
 */
export function usePageArea(wide: boolean) {
  const pathname = usePathname();

  // After Next's own scroll on navigation (it lines the new page up under its top padding).
  useLayoutEffect(() => {
    const page = document.querySelector<HTMLElement>(".shell > .page");
    if (!wide || !page) return;
    // A new page opens at the top; Back and Forward are restored below.
    if (performance.now() - poppedAt > 1000) page.scrollTop = 0;
    const at = document.activeElement;
    // Not while typing in the sidebar's search box, or anywhere else focus was put on purpose.
    if (!at || at === document.body || (at.closest("nav.tabs") && !at.closest("input"))) page.focus({ preventScroll: true });
  }, [wide, pathname]);

  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".shell > .page");
    if (!wide || !page) return;
    const here = () => location.pathname + location.search;
    const saved = new Map<string, number>();
    const onScroll = () => saved.set(here(), page.scrollTop);
    let frame = 0;
    const onPop = () => {
      poppedAt = performance.now();
      // Read it now: the old page's height can clamp the scroll (and save that) before the page swaps.
      const target = saved.get(here()) ?? 0;
      cancelAnimationFrame(frame);
      let tries = 0;
      // Set it once the page has drawn and is tall enough; give up after about half a second.
      const restore = () => {
        page.scrollTop = target;
        if (Math.abs(page.scrollTop - target) > 1 && ++tries < 30) frame = requestAnimationFrame(restore);
      };
      frame = requestAnimationFrame(restore);
    };
    page.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPop);
    return () => {
      cancelAnimationFrame(frame);
      page.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPop);
    };
  }, [wide]);
}
