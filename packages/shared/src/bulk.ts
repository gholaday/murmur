import { plural } from "./format";

// Selecting several items and acting on them at once, the same on the web and in the app.

/**
 * What picking `id` does with shift held: every item between the last one picked (`anchor`) and
 * this one, in the list's order, is added. With no anchor, or one no longer in the list, it
 * toggles just this one.
 */
export function pickRange(order: readonly string[], picked: ReadonlySet<string>, anchor: string | null, id: string): Set<string> {
  const out = new Set(picked);
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(id);
  if (from < 0 || to < 0) {
    if (out.has(id)) out.delete(id);
    else out.add(id);
    return out;
  }
  const [lo, hi] = from < to ? [from, to] : [to, from];
  for (let i = lo; i <= hi; i++) out.add(order[i]!);
  return out;
}

/** Picks `id` or puts it back. */
export function togglePick(picked: ReadonlySet<string>, id: string): Set<string> {
  const out = new Set(picked);
  if (out.has(id)) out.delete(id);
  else out.add(id);
  return out;
}

/** The fields Edit changes on several books at once: the ones books tend to share. */
export const BULK_EDIT_FIELDS = [
  { id: "author", label: "Author" },
  { id: "narrator", label: "Narrator" },
  { id: "series", label: "Series" },
] as const;
export type BulkEditField = (typeof BULK_EDIT_FIELDS)[number]["id"];
export type BulkEditForm = Record<BulkEditField, string>;

/** A field whose books don't all agree: shown blank with "Mixed" as its placeholder until it's typed in. */
export const MIXED = "Mixed";

/**
 * Where several books' edit starts: each field's shared value, or null where they differ (Mixed).
 * A missing value counts as blank.
 */
export function bulkStart(books: ReadonlyArray<Partial<Record<BulkEditField, string | null>>>): Record<BulkEditField, string | null> {
  const out = {} as Record<BulkEditField, string | null>;
  for (const { id } of BULK_EDIT_FIELDS) {
    const values = new Set(books.map((b) => (b[id] ?? "").trim()));
    out[id] = values.size === 1 ? [...values][0]! : null;
  }
  return out;
}

/** The form a bulk edit opens with: the shared values, and blanks for Mixed fields. */
export function bulkForm(start: Record<BulkEditField, string | null>): BulkEditForm {
  return { author: start.author ?? "", narrator: start.narrator ?? "", series: start.series ?? "" };
}

/**
 * The fields to save: ones typed differently from where they started. A Mixed field left blank
 * isn't a change; it keeps each book's own value.
 */
export function bulkChanges(start: Record<BulkEditField, string | null>, form: BulkEditForm): Partial<BulkEditForm> {
  const out: Partial<BulkEditForm> = {};
  for (const { id } of BULK_EDIT_FIELDS) {
    const v = form[id].trim();
    if (start[id] === null ? v !== "" : v !== start[id]) out[id] = v;
  }
  return out;
}

/** The selection's count, for its bar: "5 selected", and "0 selected" (short enough for a phone's bar) with none. */
export function selectedLabel(count: number): string {
  return `${count} selected`;
}

/**
 * Remove from library's confirm, for one item or several: the files stay where they are, and the
 * next scan finds anything still in a library folder.
 */
export function removeConfirm(count: number, noun: string, title?: string): { title: string; message: string; action: string } {
  const what = count === 1 ? (title ?? `this ${noun}`) : plural(count, noun);
  return {
    title: `Remove ${what}?`,
    message:
      count === 1
        ? "The files stay on the server. The next scan adds it back unless you move them."
        : "The files stay on the server. The next scan adds them back unless you move them.",
    action: count === 1 ? "Remove" : `Remove ${plural(count, noun)}`,
  };
}
