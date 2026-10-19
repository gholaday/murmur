"use client";
/* eslint-disable @next/next/no-img-element -- covers are pre-sized WebP from our own server */

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Square cover art. Without artwork it falls back to a tinted tile with the title,
 * like the mockups, so a book never shows as a blank box.
 */
export function Cover({
  src,
  color,
  title,
  subtitle,
  className = "",
  large = false,
}: {
  src: string | null;
  color: string | null;
  title: string;
  subtitle?: string | null;
  className?: string;
  large?: boolean;
}) {
  const style = { "--tint": color ?? "#3b4a6e" } as React.CSSProperties;
  if (src) return <CoverImage key={src} src={src} className={className} style={style} />;
  return (
    <div className={`cover cover-fallback ${large ? "cover-fallback-large" : ""} ${className}`} style={style} aria-hidden="true">
      <span className="cover-fallback-title">{title}</span>
      {subtitle ? <span className="cover-fallback-sub">{subtitle}</span> : null}
    </div>
  );
}

/** Fades in once loaded. Images already in the cache, or loaded before hydration, show at once. */
function CoverImage({ src, className, style }: { src: string; className: string; style: React.CSSProperties }) {
  const ref = useRef<HTMLImageElement>(null);
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    if (ref.current && !ref.current.complete) setPending(true);
  }, []);
  return (
    <img
      ref={ref}
      className={`cover ${pending ? "pending" : ""} ${className}`}
      style={style}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={() => setPending(false)}
      onError={() => setPending(false)}
    />
  );
}
