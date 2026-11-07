// Numbers the code shares with the stylesheet live in base.css's :root and are read from there.

function rootVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** A duration custom property such as `--player-close`, in milliseconds. */
export function cssMs(name: string): number {
  const value = rootVar(name);
  const n = Number.parseFloat(value) || 0;
  return value.endsWith("ms") ? n : value.endsWith("s") ? n * 1000 : n;
}

/** The narrow layout (bottom tabs) is showing: base.css sets `--narrow` below its breakpoint. */
export const isNarrow = (): boolean => rootVar("--narrow") === "1";
