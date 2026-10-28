"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Text on one line that scrolls sideways when it doesn't fit, for titles in tight rows. With reduced
 * motion it's cut off with an ellipsis instead.
 */
export function Marquee({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
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
  return (
    <span ref={ref} className={`marquee${long ? " moving" : ""} ${className}`}>
      {long ? (
        <span className="marquee-track">
          <span>{text}</span>
          <span aria-hidden="true">{text}</span>
        </span>
      ) : (
        text
      )}
    </span>
  );
}
