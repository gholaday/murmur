"use client";

import { useEffect } from "react";

const ROWS = ".shelf, .row-scroll";
/** How far the mouse moves before a press becomes a drag rather than a click. */
const THRESHOLD = 6;

/**
 * Lets a mouse drag sideways rows (shelves, Continue listening) the way a finger swipes them.
 * Touch already scrolls natively, so only mouse presses are handled. A press that turns into
 * a drag swallows the click that follows, so letting go over a book doesn't open it.
 */
export function useDragToScroll() {
  useEffect(() => {
    let row: HTMLElement | null = null;
    let startX = 0;
    let startScroll = 0;
    let dragged = false;

    const swallowClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest("button, input, [role=menu]")) return;
      const found = target.closest<HTMLElement>(ROWS);
      if (!found || found.scrollWidth <= found.clientWidth) return;
      row = found;
      startX = e.clientX;
      startScroll = found.scrollLeft;
      dragged = false;
    };

    const move = (e: PointerEvent) => {
      if (!row) return;
      const dx = e.clientX - startX;
      if (!dragged) {
        if (Math.abs(dx) < THRESHOLD) return;
        dragged = true;
        row.classList.add("drag-scrolling");
      }
      row.scrollLeft = startScroll - dx;
    };

    const up = () => {
      if (!row) return;
      row.classList.remove("drag-scrolling");
      if (dragged) {
        window.addEventListener("click", swallowClick, { capture: true, once: true });
        // If no click follows (released outside the row), stop waiting for one.
        setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
      }
      row = null;
    };

    // Links and images are draggable by default, which would hijack the gesture.
    const noNativeDrag = (e: DragEvent) => {
      if ((e.target as Element | null)?.closest?.(ROWS)) e.preventDefault();
    };

    document.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    document.addEventListener("dragstart", noNativeDrag);
    return () => {
      document.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.removeEventListener("dragstart", noNativeDrag);
    };
  }, []);
}
