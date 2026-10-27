import type { AlbumCandidate, AlbumMatchAllDto, AlbumMatchAllItem, AlbumMatchChange, AlbumMatchField, AlbumMatchPreview } from "@murmur/shared";
import type { AppContext } from "../context";
import { HttpError } from "../http";
import { createLogger, errorMessage } from "../log";
import { applyAlbumMatch, previewAlbumMatch, searchAlbumMatches } from "./match";
import { listAlbums } from "./queries";

/**
 * Matches every unmatched album in one go, like books' bulk match. Each album is searched like
 * a single Match and its best result waits for review; nothing changes until you apply it.
 * Runs in the background, one album at a time (MusicBrainz allows a request a second), and
 * lives in memory only: a restart forgets it, and applied albums simply stay matched.
 */

const log = createLogger("album-match-all");

interface Job {
  dto: AlbumMatchAllDto;
  stop: boolean;
  /** Each applied album's override row from before, for undo; null when it had none. */
  before: Map<string, Record<string, unknown> | null>;
}

// Started by one request and read by others, which Next may give separate copies of this module.
declare global {
  var __murmurAlbumMatchAll: { job: Job | null } | undefined;
}
const holder = (globalThis.__murmurAlbumMatchAll ??= { job: null });

export function albumMatchAllStatus(): AlbumMatchAllDto | null {
  return holder.job?.dto ?? null;
}

export async function startAlbumMatchAll(ctx: AppContext, fields: AlbumMatchField[]): Promise<AlbumMatchAllDto> {
  if (holder.job?.dto.running) throw new HttpError(409, "A match is already running.");
  const albums = (await listAlbums(ctx, 0, "all", "artist")).filter((a) => !a.matched);
  if (albums.length === 0) throw new HttpError(400, "Every album is already matched.");
  const job: Job = {
    stop: false,
    before: new Map(),
    dto: {
      running: true,
      fields: [...new Set(fields)],
      total: albums.length,
      done: 0,
      current: null,
      items: albums.map((a) => ({
        albumId: a.id,
        title: a.title,
        artist: a.artist,
        coverHash: a.coverHash,
        coverColor: a.coverColor,
        status: "pending",
        candidate: null,
        applied: [],
        changes: [],
        message: null,
      })),
    },
  };
  holder.job = job;
  log.info("album match started", { albums: albums.length });
  void run(ctx, job);
  return job.dto;
}

/** Stops a running match after the current album, or clears a finished one. */
export function stopAlbumMatchAll(): AlbumMatchAllDto | null {
  const job = holder.job;
  if (!job) return null;
  if (job.dto.running) {
    job.stop = true;
    return job.dto;
  }
  holder.job = null;
  return null;
}

/** Applies the reviewed results for these albums with the run's fields. */
export async function applyAlbumMatchAll(ctx: AppContext, albumIds: string[]): Promise<AlbumMatchAllDto> {
  const job = holder.job;
  if (!job) throw new HttpError(404, "There's no match to apply.");
  const wanted = new Set(albumIds);
  const failures: string[] = [];
  for (const item of job.dto.items) {
    if (!wanted.has(item.albumId) || item.status !== "review" || !item.candidate) continue;
    try {
      await applyItem(ctx, job, item, item.candidate);
    } catch (err) {
      item.message = `Couldn't apply: ${errorMessage(err)}`;
      failures.push(item.title);
    }
  }
  if (failures.length === wanted.size) throw new HttpError(502, `Couldn't apply ${failures.length === 1 ? "that match" : "those matches"}.`);
  return job.dto;
}

/** Puts an album applied by this run back the way it was, and back in review. */
export function undoAlbumMatchAll(ctx: AppContext, albumId: string): AlbumMatchAllDto {
  const job = holder.job;
  const item = job?.dto.items.find((i) => i.albumId === albumId);
  if (!job || !item || item.status !== "applied" || !job.before.has(albumId)) {
    throw new HttpError(404, "That album wasn't matched by this run.");
  }
  const row = job.before.get(albumId) ?? null;
  ctx.sqlite.transaction(() => {
    ctx.sqlite.prepare("DELETE FROM album_overrides WHERE album_id = ?").run(albumId);
    if (row) {
      const cols = Object.keys(row);
      ctx.sqlite.prepare(`INSERT INTO album_overrides (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`).run(row);
    }
  })();
  job.before.delete(albumId);
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
      const result = await searchAlbumMatches(ctx, item.albumId, {});
      const top = result.candidates[0] ?? null;
      item.candidate = top;
      if (!top) {
        item.status = "none";
        item.message = result.errors.length ? result.errors.join(" ") : "No results.";
      } else {
        item.changes = (await plan(ctx, job, item.albumId, top)).changes;
        item.status = "review";
      }
    } catch (err) {
      item.status = item.candidate ? "review" : "none";
      item.message = errorMessage(err);
    }
    dto.done++;
  }
  // A stopped run keeps what it found; albums it never reached drop out of the list.
  dto.items = dto.items.filter((i) => i.status !== "pending");
  dto.total = dto.items.length;
  dto.current = null;
  dto.running = false;
  log.info("album match finished", {
    applied: dto.items.filter((i) => i.status === "applied").length,
    review: dto.items.filter((i) => i.status === "review").length,
    none: dto.items.filter((i) => i.status === "none").length,
    stopped: job.stop,
  });
}

/** What applying this result would do: the run's fields where the result has something better or different. */
async function plan(ctx: AppContext, job: Job, albumId: string, c: AlbumCandidate) {
  const preview = await previewAlbumMatch(ctx, albumId, c.provider, c.providerId);
  const row = (ctx.sqlite.prepare("SELECT * FROM album_overrides WHERE album_id = ?").get(albumId) ?? null) as Record<string, unknown> | null;
  const changes: AlbumMatchChange[] = job.dto.fields
    .filter((f) => worthApplying(preview, f))
    .map((f) => ({ field: f, from: shown(preview, "current", f), to: shown(preview, "proposed", f) }));
  return { row, changes };
}

async function applyItem(ctx: AppContext, job: Job, item: AlbumMatchAllItem, c: AlbumCandidate) {
  const { row, changes } = await plan(ctx, job, item.albumId, c);
  const fields = changes.map((x) => x.field);
  // Nothing worth changing still marks the album matched, so it leaves the list.
  await applyAlbumMatch(ctx, item.albumId, { provider: c.provider, providerId: c.providerId, fields });
  job.before.set(item.albumId, row);
  item.status = "applied";
  item.applied = fields;
  item.changes = changes;
  item.message = null;
}

/** A field's value as a line of text, for showing what a result changes. */
function shown(p: AlbumMatchPreview, side: "current" | "proposed", field: AlbumMatchField): string | null {
  const v = p[side];
  if (field === "cover") return v.coverUrl ? (v.coverWidth ? `${v.coverWidth}px` : "Yes") : null;
  return v[field]?.trim() || null;
}

/**
 * Bought music is tagged well, and sources often give a reissue's year or a broader genre, so
 * Match all only fills a missing year or genre. Covers only when bigger; titles when different.
 */
function worthApplying(p: AlbumMatchPreview, field: AlbumMatchField): boolean {
  if (field === "cover" || field === "year" || field === "genre") return p.recommended.includes(field);
  const now = p.current[field]?.trim() ?? "";
  const next = p.proposed[field]?.trim() ?? "";
  return next !== "" && next !== now;
}
