import {
  type BulkMatchChange,
  type BulkMatchDto,
  type BulkMatchItem,
  type BulkMatchStartInput,
  type MatchCandidate,
  type MatchField,
  type MatchPreview,
  plural,
  seriesLabel,
} from "@murmur/shared";
import { listBooks } from "../books";
import type { AppContext } from "../context";
import { HttpError } from "../http";
import { createLogger, errorMessage } from "../log";
import { applyMatch, previewMatch, searchMatches } from "./match";

/**
 * Matches every unmatched book in one go. Each book is searched like a single Match and its
 * best result waits for review; nothing changes until you apply it. Runs in the background,
 * one book a second so the sources don't refuse us,
 * and lives in memory only: a restart forgets it, and applied books simply stay matched.
 */

const PAUSE_MS = 1000;
const log = createLogger("bulk-match");

/** Override columns for each field: a value there on an unmatched book is a hand edit. */
const COLUMN: Record<MatchField, string> = {
  title: "title",
  author: "author",
  narrator: "narrator",
  series: "series",
  description: "description",
  year: "year",
  cover: "cover_hash",
  chapters: "chapters",
};

interface Job {
  dto: BulkMatchDto;
  stop: boolean;
  /** Each applied book's override row from before, for undo; null when it had none. */
  before: Map<string, Record<string, unknown> | null>;
}

// Started by one request and read by others, which Next may give separate copies of this module.
declare global {
  var __murmurBulkMatch: { job: Job | null } | undefined;
}
const holder = (globalThis.__murmurBulkMatch ??= { job: null });

export function bulkMatchStatus(): BulkMatchDto | null {
  return holder.job?.dto ?? null;
}

export async function startBulkMatch(ctx: AppContext, userId: number, input: BulkMatchStartInput): Promise<BulkMatchDto> {
  if (holder.job?.dto.running) throw new HttpError(409, "A bulk match is already running.");
  const books = (await listBooks(ctx, userId)).filter((b) => !b.matched && b.missingSince === null);
  if (books.length === 0) throw new HttpError(400, "Every book is already matched.");
  const job: Job = {
    stop: false,
    before: new Map(),
    dto: {
      running: true,
      fields: [...new Set(input.fields)],
      total: books.length,
      done: 0,
      current: null,
      items: books.map((b) => ({
        bookId: b.id,
        title: b.title,
        author: b.author,
        coverHash: b.coverHash,
        coverColor: b.coverColor,
        durationSec: b.durationSec,
        status: "pending",
        candidate: null,
        applied: [],
        changes: [],
        message: null,
      })),
    },
  };
  holder.job = job;
  log.info("bulk match started", { books: books.length });
  void run(ctx, job);
  return job.dto;
}

/** Stops a running match after the current book, or clears a finished one. */
export function stopBulkMatch(): BulkMatchDto | null {
  const job = holder.job;
  if (!job) return null;
  if (job.dto.running) {
    job.stop = true;
    return job.dto;
  }
  holder.job = null;
  return null;
}

/** Applies the reviewed results for these books with the run's fields. */
export async function applyBulkMatches(ctx: AppContext, bookIds: string[]): Promise<BulkMatchDto> {
  const job = holder.job;
  if (!job) throw new HttpError(404, "There's no bulk match to apply.");
  const wanted = new Set(bookIds);
  const failures: string[] = [];
  let tried = 0;
  for (const item of job.dto.items) {
    if (!wanted.has(item.bookId) || item.status !== "review" || !item.candidate) continue;
    tried++;
    try {
      await applyItem(ctx, job, item, item.candidate);
    } catch (err) {
      item.message = `Couldn't apply: ${errorMessage(err)}`;
      failures.push(item.title);
    }
  }
  if (tried > 0 && failures.length === tried) throw new HttpError(502, `Couldn't apply ${failures.length === 1 ? "that match" : "those matches"}.`);
  return job.dto;
}

/** Puts a book applied by this run back the way it was, and back in review. */
export function undoBulkMatch(ctx: AppContext, bookId: string): BulkMatchDto {
  const job = holder.job;
  const item = job?.dto.items.find((i) => i.bookId === bookId);
  if (!job || !item || item.status !== "applied" || !job.before.has(bookId)) {
    throw new HttpError(404, "That book wasn't matched by this run.");
  }
  const row = job.before.get(bookId) ?? null;
  const tx = ctx.sqlite.transaction(() => {
    ctx.sqlite.prepare("DELETE FROM book_overrides WHERE book_id = ?").run(bookId);
    if (row) {
      const cols = Object.keys(row);
      ctx.sqlite
        .prepare(`INSERT INTO book_overrides (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`)
        .run(row);
    }
  });
  tx();
  job.before.delete(bookId);
  item.status = "review";
  item.applied = [];
  item.message = null;
  return job.dto;
}

async function run(ctx: AppContext, job: Job) {
  const { dto } = job;
  for (const item of dto.items) {
    if (job.stop) break;
    dto.current = item.title;
    try {
      const result = await searchMatches(ctx, item.bookId, {});
      const top = result.candidates[0] ?? null;
      item.candidate = top;
      if (!top) {
        item.status = "none";
        item.message = result.errors.length ? result.errors.join(" ") : "No results.";
      } else {
        item.changes = (await plan(ctx, job, item.bookId, top)).changes;
        item.status = "review";
      }
    } catch (err) {
      item.status = item.candidate ? "review" : "none";
      item.message = errorMessage(err);
    }
    dto.done++;
    if (dto.done < dto.total && !job.stop) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  // A stopped run keeps what it found; books it never reached drop out of the list.
  dto.items = dto.items.filter((i) => i.status !== "pending");
  dto.total = dto.items.length;
  dto.current = null;
  dto.running = false;
  log.info("bulk match finished", {
    applied: dto.items.filter((i) => i.status === "applied").length,
    review: dto.items.filter((i) => i.status === "review").length,
    none: dto.items.filter((i) => i.status === "none").length,
    stopped: job.stop,
  });
}

/**
 * What applying this result would do: the run's fields that aren't hand edited and where the
 * result has something better or different, plus the hand-edited ones it leaves alone.
 */
async function plan(ctx: AppContext, job: Job, bookId: string, c: MatchCandidate) {
  const preview = await previewMatch(ctx, bookId, c.provider, c.providerId);
  const row = (ctx.sqlite.prepare("SELECT * FROM book_overrides WHERE book_id = ?").get(bookId) ?? null) as
    | Record<string, unknown>
    | null;
  const changes: BulkMatchChange[] = [];
  for (const f of job.dto.fields) {
    if (!worthApplying(preview, f)) continue;
    changes.push({ field: f, from: shown(preview, "current", f), to: shown(preview, "proposed", f), edited: row?.[COLUMN[f]] != null });
  }
  return { row, changes, fields: changes.filter((x) => !x.edited).map((x) => x.field) };
}

async function applyItem(ctx: AppContext, job: Job, item: BulkMatchItem, c: MatchCandidate) {
  const { row, changes, fields } = await plan(ctx, job, item.bookId, c);
  await applyMatch(ctx, item.bookId, { provider: c.provider, providerId: c.providerId, fields });
  job.before.set(item.bookId, row);
  item.status = "applied";
  item.applied = fields;
  item.changes = changes;
  item.message = null;
}

/** A field's value as a line of text, for showing what a result changes. */
function shown(p: MatchPreview, side: "current" | "proposed", field: MatchField): string | null {
  const v = p[side];
  switch (field) {
    case "cover":
      return v.coverUrl ? (v.coverWidth ? `${v.coverWidth}px` : "Yes") : null;
    case "chapters":
      return v.chapterCount ? plural(v.chapterCount, "chapter") : null;
    case "series":
      return seriesLabel(v.series, v.seriesPosition);
    default:
      return v[field]?.trim() || null;
  }
}

function worthApplying(p: MatchPreview, field: MatchField): boolean {
  if (field === "cover") return p.recommended.includes("cover");
  if (field === "chapters") return !p.chaptersNote && p.proposed.chapterCount > 0;
  const now = (field === "series" ? p.current.series : p.current[field])?.trim() ?? "";
  const next = (field === "series" ? p.proposed.series : p.proposed[field])?.trim() ?? "";
  if (field === "series" && next && p.proposed.seriesPosition !== p.current.seriesPosition) return true;
  return next !== "" && next !== now;
}
