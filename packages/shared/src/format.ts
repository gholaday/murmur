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
  // Rounded, since a day with a daylight saving change is 23 or 25 hours long.
  const days = Math.round((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 6) return d.toLocaleDateString(undefined, { weekday: "short" });
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** 3.2 GB, or 12 GB from 10 GB up. */
export function gigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 1 : 0)} GB`;
}

/** An error's message for showing to the user, with a fallback for anything else thrown: say what failed, like "Couldn't save the playlist." */
export function errorText(err: unknown, fallback = "Something went wrong."): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

/** How many of an edit form's fields differ from what's saved. */
export function changedFields<T extends object>(form: T, saved: T): number {
  return (Object.keys(form) as Array<keyof T>).filter((k) => JSON.stringify(form[k]) !== JSON.stringify(saved[k])).length;
}

/**
 * How many rows of an edited list were added, removed or changed, each counting once: the fewest
 * such edits that turn `saved` into `rows`. Removing one chapter is one change, not one for every
 * chapter after it.
 */
export function changedRows<T>(rows: T[], saved: T[], same: (a: T, b: T) => boolean): number {
  // Rows untouched at either end don't count and needn't be compared with every other row: this
  // runs on each keystroke, and a long book's chapters would otherwise cost their number squared.
  let start = 0;
  while (start < rows.length && start < saved.length && same(rows[start]!, saved[start]!)) start++;
  let rowsEnd = rows.length;
  let savedEnd = saved.length;
  while (rowsEnd > start && savedEnd > start && same(rows[rowsEnd - 1]!, saved[savedEnd - 1]!)) {
    rowsEnd--;
    savedEnd--;
  }
  // Edit distance over what's left, one row of the table at a time.
  let prev = Array.from({ length: savedEnd - start + 1 }, (_, j) => j);
  for (let i = start; i < rowsEnd; i++) {
    const next = [i - start + 1];
    for (let j = start; j < savedEnd; j++) {
      const at = j - start;
      const keep = prev[at]! + (same(rows[i]!, saved[j]!) ? 0 : 1);
      next.push(Math.min(keep, prev[at + 1]! + 1, next[at]! + 1));
    }
    prev = next;
  }
  return prev[savedEnd - start]!;
}

/** An edit sheet's full-width Save: "Save" (greyed out) until something changes, then how many. */
export function saveLabel(changes: number): string {
  return changes ? `Save ${plural(changes, "change")}` : "Save";
}

/**
 * Match's full-width button for the picked result (with nothing picked there's no button): what
 * it would change, once its comparison has loaded (`changes` is null until then).
 */
export function reviewLabel(changes: number | null): string {
  if (changes === null) return "Review changes";
  return changes ? `Review ${plural(changes, "change")}` : "No changes";
}

export function seriesLabel(series: string | null, position: number | null): string | null {
  if (!series) return null;
  return position === null ? series : `${series} #${position}`;
}
