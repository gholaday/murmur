"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { TITLE_SCROLL, titleScrollLap } from "@murmur/shared/client";

/**
 * Text on one line that scrolls sideways when it doesn't fit, for titles in tight rows. It moves at
 * a steady reading speed, starts after a short wait and rests longer between laps (`TITLE_SCROLL`, as the app). With
 * reduced motion it's cut off with an ellipsis instead.
 */
export function Marquee({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const check = () => setLong(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  useLayoutEffect(() => {
    const el = track.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!long || !el || !first) return;
    // One copy and its gap: after that the second copy sits where the first began, so a lap can
    // rest at its end, which looks the same as resting at the start.
    const distance = first.offsetWidth;
    const { durationMs, restShare } = titleScrollLap(distance);
    const lap = el.animate(
      [
        { transform: "translateX(0)", offset: 0 },
        { transform: `translateX(-${distance}px)`, offset: 1 - restShare },
        { transform: `translateX(-${distance}px)`, offset: 1 },
      ],
      { duration: durationMs, delay: TITLE_SCROLL.firstRestMs, iterations: Infinity, easing: "linear" },
    );
    return () => lap.cancel();
  }, [long, text]);
  return (
    <span ref={ref} className={`marquee${long ? " moving" : ""} ${className}`}>
      {long ? (
        <span ref={track} className="marquee-track">
          <span>{text}</span>
          <span aria-hidden="true">{text}</span>
        </span>
      ) : (
        text
      )}
    </span>
  );
}
