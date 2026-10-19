/* eslint-disable @next/next/no-img-element -- covers are pre-sized WebP from our own server */

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
  if (src) {
    return <img className={`cover ${className}`} style={style} src={src} alt="" loading="lazy" decoding="async" />;
  }
  return (
    <div className={`cover cover-fallback ${large ? "cover-fallback-large" : ""} ${className}`} style={style} aria-hidden="true">
      <span className="cover-fallback-title">{title}</span>
      {subtitle ? <span className="cover-fallback-sub">{subtitle}</span> : null}
    </div>
  );
}
