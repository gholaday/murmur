"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Styled tooltips for icon buttons, shown on mouse hover and keyboard focus (not touch).
 * Any element with `data-tip`, or an icon-only button with an aria-label, gets one, so
 * buttons don't need extra markup.
 */
const TARGETS = "[data-tip], .icon-btn[aria-label], .btn-round[aria-label], .mini-skip[aria-label], .skip-btn[aria-label], .play-btn[aria-label], .ring-btn[aria-label]";
const DELAY_MS = 450;
const GAP = 8;
const EDGE = 8;

type Tip = { text: string; x: number; y: number; below: boolean };

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hide = () => {
      if (timer.current) clearTimeout(timer.current);
      target.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement, delay: number) => {
      if (timer.current) clearTimeout(timer.current);
      target.current = el;
      timer.current = setTimeout(() => {
        const text = el.dataset.tip ?? el.getAttribute("aria-label");
        if (!text || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 48;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + GAP : r.top - GAP, below });
      }, delay);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(TARGETS);
      if (el === target.current) return;
      if (el) show(el, DELAY_MS);
      else hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>(TARGETS);
      if (el?.matches(":focus-visible")) show(el, 0);
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("keydown", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("keydown", hide);
      window.removeEventListener("scroll", hide, true);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Keep it on screen: shift sideways if it would run past an edge (before it paints).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(EDGE, tip.x - w / 2), window.innerWidth - w - EDGE);
    el.style.left = `${left}px`;
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={box}
      role="tooltip"
      className={`tooltip ${tip.below ? "below" : ""}`}
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  );
}
