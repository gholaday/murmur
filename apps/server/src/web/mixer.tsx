"use client";

import { useLayoutEffect, useRef } from "react";
import { PlayIcon } from "./icons";

/** Where each bar settles while paused, as a share of its full height: the app icon's shape. */
const REST = [1, 0.75, 0.54, 0.75, 1];

/**
 * The five bouncing bars. Pausing lets each bar ease from wherever it was into the app icon's
 * shape and stay there; playing again starts the bounce. A CSS animation can't hand its current
 * value to a transition, so the settle copies each bar's live transform first.
 */
function Bars({ playing, className }: { playing: boolean; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const bars = Array.from(ref.current?.children ?? []) as HTMLElement[];
    if (playing) {
      for (const b of bars) b.style.cssText = "";
    } else if (!mounted.current) {
      // Already paused when it appeared: rest at once.
      bars.forEach((b, i) => (b.style.cssText = `animation: none; transform: scaleY(${REST[i]})`));
    } else {
      for (const b of bars) b.style.cssText = `animation: none; transform: ${getComputedStyle(b).transform}`;
      void ref.current?.offsetHeight; // start the transition from there
      bars.forEach(
        (b, i) => (b.style.cssText = `animation: none; transform: scaleY(${REST[i]}); transition: transform 0.5s cubic-bezier(0.3, 0, 0.2, 1)`),
      );
    }
    mounted.current = true;
  }, [playing]);
  return (
    <span ref={ref} className={className}>
      {REST.map((_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

/** Just the bars, in the text colour: they stand in for the playing song's number in a track list. */
export function MixerBars({ playing }: { playing: boolean }) {
  return (
    <span aria-hidden="true">
      <Bars playing={playing} className="mixer-bars inline" />
    </span>
  );
}

/**
 * Bouncing bars on a dark disc, centered on the cover of whatever is playing. `thumb` fills a list
 * thumbnail instead. `resume` shows Play while paused, for the Up Next row that resumes when tapped.
 */
export function Mixer({ playing, thumb = false, resume = false }: { playing: boolean; thumb?: boolean; resume?: boolean }) {
  return (
    <span className={`mixer${thumb ? " thumb-mixer" : ""}`} aria-hidden="true">
      {resume && !playing ? <PlayIcon size={18} /> : <Bars playing={playing} className="mixer-bars" />}
    </span>
  );
}
