import type {
  BookDetail,
  MatchApplyInput,
  MatchCandidate,
  MatchField,
  MatchPreview,
  MatchSearchResult,
  MatchValues,
} from "@murmur/shared";
import sharp from "sharp";
import { getBook, scannedChapters } from "../books";
import type { AppContext } from "../context";
import { env } from "../env";
import { HttpError } from "../http";
import { coverMeta, storeCover } from "../library/covers";
import { errorMessage } from "../log";
import { createProviders, type CandidateDetail, type ChapterList, type Providers } from "./providers";
import { cleanTitle, scoreCandidate, type LocalBook } from "./score";

const SUGGEST_AT = 90;
const LIST_AT = 1;
const CHAPTER_TOLERANCE = 0.01;
/** Covers whose original size we don't know are assumed to be this wide. */
const UNKNOWN_COVER_WIDTH = 500;

let providers: Providers | null = null;
function getProviders(ctx: AppContext): Providers {
  providers ??= createProviders(ctx.sqlite, {
    region: env.audibleRegion,
    userAgent: `Murmur/${env.version}`,
    googleApiKey: env.googleBooksApiKey,
  });
  return providers;
}

async function loadBook(ctx: AppContext, bookId: string): Promise<BookDetail> {
  const book = await getBook(ctx, bookId, 0);
  if (!book) throw new HttpError(404, "Book not found.");
  return book;
}

function localOf(book: BookDetail): LocalBook {
  return {
    title: book.title,
    author: book.author,
    narrator: book.narrator,
    series: book.series,
    seriesPosition: book.seriesPosition,
    durationSec: book.durationSec,
    asin: book.asin,
  };
}

/**
 * Finds and scores candidates. With an ASIN in the files it looks that up directly first;
 * Apple Books and Google Books are only asked when Audible has nothing usable.
 */
export async function searchMatches(
  ctx: AppContext,
  bookId: string,
  query: { title?: string; author?: string },
): Promise<MatchSearchResult> {
  const book = await loadBook(ctx, bookId);
  const p = getProviders(ctx);
  const custom = !!(query.title || query.author);
  const title = query.title?.trim() || cleanTitle(book.title) || book.title;
  const author = query.author?.trim() || (custom ? null : book.author);
  const local = localOf(book);
  const errors: string[] = [];
  const found = new Map<string, CandidateDetail>();
  const keep = (c: CandidateDetail) => found.set(`${c.provider}:${c.providerId}`, c);

  if (book.asin && !custom) {
    try {
      const hit = await p.audibleByAsin(book.asin);
      if (hit) keep(hit);
    } catch (err) {
      errors.push(`Audible: ${errorMessage(err)}`);
    }
  }
  try {
    for (const c of await p.audibleSearch(title, author)) keep(c);
  } catch (err) {
    errors.push(`Audible: ${errorMessage(err)}`);
  }

  let scored = [...found.values()].map((c) => scoreCandidate(local, c));
  if (!scored.some((c) => c.score >= 70)) {
    // Asked together; either can be down or out of quota without losing the other.
    const fallbacks = [
      { name: "Apple Books", search: p.itunesSearch },
      { name: "Google Books", search: p.googleSearch },
    ];
    const results = await Promise.allSettled(fallbacks.map((f) => f.search(title, author)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") for (const c of r.value) scored.push(scoreCandidate(local, c));
      else errors.push(`${fallbacks[i]!.name}: ${errorMessage(r.reason)}`);
    });
  }

  // Highest score first; ties broken by provider then id so the order never shuffles.
  scored = scored
    .filter((c) => c.score >= LIST_AT)
    .sort(
      (a, b) =>
        b.score - a.score || a.provider.localeCompare(b.provider) || a.providerId.localeCompare(b.providerId),
    )
    .slice(0, 12);
  const top = scored[0];
  return {
    // Show the book's own title in the search box; the cleaned form is only for searching.
    query: { title: custom ? title : book.title, author, asin: book.asin },
    candidates: scored.map(stripDetail),
    suggested: top && top.score >= SUGGEST_AT ? `${top.provider}:${top.providerId}` : null,
    errors: [...new Set(errors)],
  };
}

function stripDetail(c: MatchCandidate & { description?: string | null }): MatchCandidate {
  const { description: _description, ...rest } = c;
  return rest;
}

async function imageWidth(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await sharp(Buffer.from(await res.arrayBuffer()), { failOn: "none" }).metadata()).width ?? null;
  } catch {
    return null;
  }
}

function chaptersFit(list: ChapterList | null, durationSec: number): { ok: boolean; note: string | null } {
  if (!list) return { ok: false, note: "No online chapter list for this edition." };
  const off = Math.abs(list.runtimeSec - durationSec) / durationSec;
  if (off > CHAPTER_TOLERANCE) {
    const fmt = (s: number) => `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
    return {
      ok: false,
      note: `Online chapters add up to ${fmt(list.runtimeSec)} but your files are ${fmt(durationSec)}, so the marks would drift.`,
    };
  }
  return { ok: true, note: null };
}

async function detailFor(ctx: AppContext, provider: MatchApplyInput["provider"], providerId: string) {
  const p = getProviders(ctx);
  let detail: CandidateDetail | null;
  try {
    detail = await p.byId(provider, providerId);
  } catch (err) {
    throw new HttpError(502, `Couldn't load that result: ${errorMessage(err)}`);
  }
  if (!detail) throw new HttpError(404, "That result no longer exists.");
  let chapters: ChapterList | null = null;
  if (provider === "audible") {
    try {
      chapters = await p.audnexusChapters(providerId);
    } catch {
      chapters = null;
    }
  }
  return { detail, chapters };
}

/** Side-by-side current and proposed values, with sensible defaults for what to apply. */
export async function previewMatch(
  ctx: AppContext,
  bookId: string,
  provider: MatchApplyInput["provider"],
  providerId: string,
): Promise<MatchPreview> {
  const book = await loadBook(ctx, bookId);
  const { detail, chapters } = await detailFor(ctx, provider, providerId);
  const currentCoverWidth = book.coverHash ? ((await coverMeta(env.coversDir, book.coverHash))?.sourceWidth ?? null) : null;
  const proposedCoverWidth = detail.coverUrl ? await imageWidth(detail.coverUrl) : null;
  const fit = chaptersFit(chapters, book.durationSec);

  const current: MatchValues = {
    title: book.title,
    author: book.author,
    narrator: book.narrator,
    series: book.series,
    seriesPosition: book.seriesPosition,
    description: book.description,
    year: book.year,
    coverUrl: book.coverHash ? `/api/books/${book.id}/cover?size=200&h=${book.coverHash}` : null,
    coverWidth: currentCoverWidth,
    chapterCount: book.chapters.length,
  };
  const proposed: MatchValues = {
    title: detail.title,
    author: detail.author,
    narrator: detail.narrator,
    series: detail.series,
    seriesPosition: detail.seriesPosition,
    description: detail.description,
    year: detail.year,
    coverUrl: detail.coverUrl,
    coverWidth: proposedCoverWidth,
    chapterCount: chapters?.chapters.length ?? 0,
  };

  // Only fill what's missing or poorer locally; titles and authors are never changed by default.
  const recommended: MatchField[] = [];
  if (!current.narrator && proposed.narrator) recommended.push("narrator");
  if (!current.series && proposed.series) recommended.push("series");
  if (!current.year && proposed.year) recommended.push("year");
  if ((!current.description || current.description.length < 80) && proposed.description) recommended.push("description");
  if (
    proposed.coverUrl &&
    proposedCoverWidth &&
    (!book.coverHash || proposedCoverWidth > (currentCoverWidth ?? UNKNOWN_COVER_WIDTH))
  ) {
    recommended.push("cover");
  }
  // Chapters that are just one per file (or none) are worth replacing when the online ones fit.
  const scanned = scannedChapters(ctx, book.id);
  const numbersOnly = scanned.every((c) => /^\s*(chapter|track|part|ch\.?)?\s*\d+\s*$/i.test(c.title));
  const genericChapters =
    scanned.length <= 1 || numbersOnly || (book.files.length > 1 && scanned.length === book.files.length);
  if (fit.ok && genericChapters) recommended.push("chapters");

  return { provider, providerId, current, proposed, recommended, chaptersNote: fit.note };
}

interface OverrideRow {
  title: string | null;
  author: string | null;
  narrator: string | null;
  series: string | null;
  series_position: number | null;
  description: string | null;
  year: string | null;
  cover_hash: string | null;
  chapters: string | null;
}

/** Applies the chosen fields as overrides. Fields not chosen keep any earlier match. */
export async function applyMatch(ctx: AppContext, bookId: string, input: MatchApplyInput): Promise<void> {
  const book = await loadBook(ctx, bookId);
  const { detail, chapters } = await detailFor(ctx, input.provider, input.providerId);
  const existing = (ctx.sqlite.prepare("SELECT * FROM book_overrides WHERE book_id = ?").get(bookId) as OverrideRow | undefined) ?? {
    title: null,
    author: null,
    narrator: null,
    series: null,
    series_position: null,
    description: null,
    year: null,
    cover_hash: null,
    chapters: null,
  };
  const next: OverrideRow = { ...existing };
  const fields = new Set(input.fields);

  if (fields.has("title") && detail.title) next.title = detail.title;
  if (fields.has("author") && detail.author) next.author = detail.author;
  if (fields.has("narrator") && detail.narrator) next.narrator = detail.narrator;
  if (fields.has("series") && detail.series) {
    next.series = detail.series;
    next.series_position = detail.seriesPosition;
  }
  if (fields.has("description") && detail.description) next.description = detail.description;
  if (fields.has("year") && detail.year) next.year = detail.year;
  if (fields.has("chapters")) {
    const fit = chaptersFit(chapters, book.durationSec);
    if (!fit.ok || !chapters) throw new HttpError(400, fit.note ?? "No chapters to apply.");
    next.chapters = JSON.stringify(
      chapters.chapters.map((c, i) => ({
        index: i,
        title: c.title,
        startSec: c.startSec,
        // Stretch the last chapter to the real end so the timeline has no gap.
        endSec: i === chapters.chapters.length - 1 ? book.durationSec : c.endSec,
      })),
    );
  }
  if (fields.has("cover") && detail.coverUrl) {
    try {
      const res = await fetch(detail.coverUrl, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      next.cover_hash = await storeCover(env.coversDir, Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      throw new HttpError(502, `Couldn't download the cover: ${errorMessage(err)}`);
    }
  }

  ctx.sqlite
    .prepare(
      `INSERT INTO book_overrides (book_id, provider, provider_id, title, author, narrator, series, series_position,
         description, year, cover_hash, chapters, matched_at)
       VALUES (@bookId, @provider, @providerId, @title, @author, @narrator, @series, @series_position,
         @description, @year, @cover_hash, @chapters, @matchedAt)
       ON CONFLICT (book_id) DO UPDATE SET provider = excluded.provider, provider_id = excluded.provider_id,
         title = excluded.title, author = excluded.author, narrator = excluded.narrator, series = excluded.series,
         series_position = excluded.series_position, description = excluded.description, year = excluded.year,
         cover_hash = excluded.cover_hash, chapters = excluded.chapters, matched_at = excluded.matched_at`,
    )
    // next comes first: a row read with SELECT * also carries the old provider, which mustn't win.
    .run({ ...next, bookId, provider: input.provider, providerId: input.providerId, matchedAt: Date.now() });
}

export function removeMatch(ctx: AppContext, bookId: string) {
  ctx.sqlite.prepare("DELETE FROM book_overrides WHERE book_id = ?").run(bookId);
}
