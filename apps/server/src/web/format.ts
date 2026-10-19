/** 1:02:03 or 2:03. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** 16h 10m, 42m, or 30s for very short spans. */
export function duration(sec: number | null | undefined): string {
  if (!sec || sec < 0) return "";
  const total = Math.round(sec / 60);
  if (total < 1) return `${Math.round(sec)}s`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function timeLeft(durationSec: number, positionSec: number): string {
  return `${duration(Math.max(0, durationSec - positionSec)) || "0m"} left`;
}

const DAY = 24 * 60 * 60 * 1000;

/** Today, Yesterday, Mon, 12 Mar, or 12 Mar 2023 for older years. */
export function shortDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = today.getTime() - new Date(d).setHours(0, 0, 0, 0);
  if (diff <= 0) return "Today";
  if (diff <= DAY) return "Yesterday";
  if (diff < 6 * DAY) return d.toLocaleDateString(undefined, { weekday: "short" });
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function seriesLabel(series: string | null, position: number | null): string | null {
  if (!series) return null;
  return position === null ? series : `${series} #${position}`;
}
