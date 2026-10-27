"use client";

import { useEffect, useRef, useState } from "react";

const DROP_MS = 180;
/** Distance from the top or bottom of the scroll area where dragging scrolls it. */
const EDGE = 90;

/** The nearest ancestor that scrolls, such as a sheet's list, or null when it's the page. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

const scrollTop = (scroller: HTMLElement | null) => (scroller ? scroller.scrollTop : window.scrollY);

interface Drag {
  from: number;
  over: number;
  /** How far the lifted row has moved from where it started. */
  dy: number;
  /** Height of the lifted row: how far the rows it passes slide to make room. */
  height: number;
  dropping: boolean;
}

/**
 * Drag-to-reorder for a vertical list. The lifted row follows the pointer and the rows it
 * passes slide out of the way; on release it settles into its slot before `onMove` runs.
 * Rows need `data-row` and the `rowProps(i)`; the drag handle gets `handleProps(i)`.
 */
export function useSortable(onMove: (from: number, to: number) => void) {
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // The latest drag for event handlers, which can run before a re-render.
  const dragRef = useRef(drag);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);
  const live = useRef<{
    startY: number;
    scroller: HTMLElement | null;
    startScroll: number;
    pointerY: number;
    rects: DOMRect[];
    raf: number;
  } | null>(null);

  useEffect(() => () => cancelAnimationFrame(live.current?.raf ?? 0), []);

  /** Moves the lifted row to the pointer and works out which slot it's over. */
  const follow = () => {
    const s = live.current;
    if (!s) return;
    setDrag((d) => {
      if (!d || d.dropping) return d;
      const dy = s.pointerY - s.startY + (scrollTop(s.scroller) - s.startScroll);
      const box = s.rects[d.from]!;
      const center = box.top + box.height / 2 + dy;
      let over = 0;
      s.rects.forEach((b, j) => {
        if (j !== d.from && b.top + b.height / 2 < center) over++;
      });
      return d.dy === dy && d.over === over ? d : { ...d, dy, over };
    });
  };

  /** Scrolls the page or sheet while the pointer is near its edge, faster the closer it gets. */
  const autoScroll = () => {
    const s = live.current;
    if (!s) return;
    const box = s.scroller?.getBoundingClientRect();
    const top = Math.max(box?.top ?? 0, 0);
    const bottom = Math.min(box?.bottom ?? window.innerHeight, window.innerHeight);
    const edge = Math.min(EDGE, (bottom - top) / 4);
    const step =
      s.pointerY < top + edge ? -Math.ceil((top + edge - s.pointerY) / 6) : s.pointerY > bottom - edge ? Math.ceil((s.pointerY - bottom + edge) / 6) : 0;
    if (step) {
      if (s.scroller) s.scroller.scrollBy(0, step);
      else window.scrollBy(0, step);
      follow();
    }
    s.raf = requestAnimationFrame(autoScroll);
  };

  const finish = () => {
    const s = live.current;
    const d = dragRef.current;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    live.current = null;
    if (!d) return;
    // Glide the row into the gap it opened, then commit the new order.
    const { from, over } = d;
    const between = from < over ? s.rects.slice(from + 1, over + 1) : s.rects.slice(over, from);
    const target = (from < over ? 1 : -1) * between.reduce((sum, b) => sum + b.height, 0);
    setDrag({ ...d, dy: target, dropping: true });
    setTimeout(() => {
      if (from !== over) onMove(from, over);
      setDrag(null);
    }, DROP_MS);
  };

  const handleProps = (i: number) => ({
    onPointerDown: (ev: React.PointerEvent<HTMLElement>) => {
      if (drag || ev.button !== 0) return;
      ev.preventDefault();
      ev.currentTarget.setPointerCapture(ev.pointerId);
      const rects = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])].map((r) => r.getBoundingClientRect());
      const scroller = scrollParent(listRef.current);
      live.current = { startY: ev.clientY, scroller, startScroll: scrollTop(scroller), pointerY: ev.clientY, rects, raf: 0 };
      setDrag({ from: i, over: i, dy: 0, height: rects[i]?.height ?? 0, dropping: false });
      live.current.raf = requestAnimationFrame(autoScroll);
    },
    onPointerMove: (ev: React.PointerEvent<HTMLElement>) => {
      if (!live.current) return;
      live.current.pointerY = ev.clientY;
      follow();
    },
    onPointerUp: finish,
    onPointerCancel: finish,
  });

  const rowProps = (i: number): { className: string; style?: React.CSSProperties } => {
    if (!drag) return { className: "" };
    const { from, over, dy, height, dropping } = drag;
    if (i === from) {
      return {
        className: dropping ? "lifted dropping" : "lifted",
        style: { transform: `translateY(${dy}px)`, transition: dropping ? `transform ${DROP_MS}ms ease, box-shadow ${DROP_MS}ms ease` : "none" },
      };
    }
    const shift = from < over && i > from && i <= over ? -height : from > over && i >= over && i < from ? height : 0;
    return { className: "", style: { transform: `translateY(${shift}px)` } };
  };

  return { listRef, sorting: drag !== null, rowProps, handleProps };
}
