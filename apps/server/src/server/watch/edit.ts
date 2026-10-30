import { type WatchArtOption, watchArtSchema, type WatchDetailsInput } from "@murmur/shared";
import { bumpChanges } from "../changes";
import type { AppContext } from "../context";
import { env } from "../env";
import { HttpError, readJson } from "../http";
import { ProviderError } from "../metadata/providers";
import { readCapped, safeFetch } from "../safe-fetch";
import { storeArt } from "./art";
import { sortTitle } from "./parse";
import { tmdbThumbUrl } from "./tmdb";

// Edit for movies and shows. What an admin types or picks counts as local, like an .nfo or a
// poster beside the files: a later match leaves it alone.

export type WatchKind = "movie" | "show";
export type ArtKind = "poster" | "backdrop";

const MAX_ART_BYTES = 20 * 1024 * 1024;
const tableOf = (kind: WatchKind) => (kind === "movie" ? "movies" : "shows");
const notFound = (kind: WatchKind) => new HttpError(404, kind === "movie" ? "Movie not found." : "Show not found.");

export function saveWatchDetails(ctx: AppContext, kind: WatchKind, id: string, input: WatchDetailsInput) {
  const info = ctx.sqlite
    .prepare(
      `UPDATE ${tableOf(kind)} SET title = ?, sort_title = ?, year = ?, description = ?, details_local = 1, updated_at = ? WHERE id = ?`,
    )
    .run(input.title, sortTitle(input.title), input.year || null, input.description || null, Date.now(), id);
  if (info.changes === 0) throw notFound(kind);
  bumpChanges("watch");
}

/** Puts an image on as the poster or backdrop, kept as your own so a match never replaces it. */
export async function setWatchArt(ctx: AppContext, kind: WatchKind, id: string, which: ArtKind, image: Buffer) {
  if (image.length > MAX_ART_BYTES) throw new HttpError(400, "That image is over 20 MB.");
  let hash: string;
  try {
    hash = await storeArt(env.coversDir, image, which === "poster" ? "poster" : "wide");
  } catch {
    throw new HttpError(400, "That isn't an image Murmur can read.");
  }
  const info = ctx.sqlite
    .prepare(`UPDATE ${tableOf(kind)} SET ${which}_hash = ?, ${which}_tmdb = 0, ${which}_chosen = 1, updated_at = ? WHERE id = ?`)
    .run(hash, Date.now(), id);
  if (info.changes === 0) throw notFound(kind);
  bumpChanges("watch");
}

/**
 * Takes off a picture chosen in Edit. TMDB's goes back on straight away when it's matched, and a
 * rescan puts back one beside the files, which wins over TMDB's as always.
 */
export async function removeWatchArt(ctx: AppContext, kind: WatchKind, id: string, which: string) {
  if (which !== "poster" && which !== "backdrop") throw new HttpError(404, "Not found.");
  const table = tableOf(kind);
  const row = ctx.sqlite.prepare(`SELECT tmdb_id FROM ${table} WHERE id = ?`).get(id) as { tmdb_id: number | null } | undefined;
  if (!row) throw notFound(kind);
  let hash: string | null = null;
  if (row.tmdb_id && ctx.watch.tmdb) {
    try {
      const d = await ctx.watch.tmdb.details(kind, row.tmdb_id);
      const path = which === "poster" ? d?.posterPath : d?.backdropPath;
      if (path) hash = await storeArt(env.coversDir, await ctx.watch.tmdb.image(path, which === "poster" ? "w780" : "w1280"), which === "poster" ? "poster" : "wide");
    } catch {
      // TMDB can't be reached: left empty, and the next match or scan fills it.
    }
  }
  ctx.sqlite
    .prepare(`UPDATE ${table} SET ${which}_hash = ?, ${which}_tmdb = ?, ${which}_chosen = 0, updated_at = ? WHERE id = ?`)
    .run(hash, hash ? 1 : 0, Date.now(), id);
  bumpChanges("watch");
  void ctx.watch.scanner.scan();
}

export async function setWatchArtFromUrl(ctx: AppContext, kind: WatchKind, id: string, which: ArtKind, url: string) {
  let res: Response;
  try {
    res = await safeFetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": `Murmur/${env.version}` } });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Couldn't download that image.");
  }
  if (!res.ok) throw new HttpError(400, `Couldn't download that image (the site answered ${res.status}).`);
  await setWatchArt(ctx, kind, id, which, await readCapped(res, MAX_ART_BYTES, "That image"));
}

export async function setWatchArtFromTmdb(ctx: AppContext, kind: WatchKind, id: string, which: ArtKind, tmdbPath: string) {
  const tmdb = requireTmdb(ctx);
  try {
    await setWatchArt(ctx, kind, id, which, await tmdb.image(tmdbPath, which === "poster" ? "w780" : "w1280"));
  } catch (err) {
    if (err instanceof ProviderError) throw new HttpError(502, `TMDB ${err.message}.`);
    throw err;
  }
}

/** An uploaded image (multipart field "image"), `{ url }` to download, or `{ tmdbPath }`. */
export async function setWatchArtFromRequest(ctx: AppContext, req: Request, kind: WatchKind, id: string, which: string) {
  if (which !== "poster" && which !== "backdrop") throw new HttpError(404, "Not found.");
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const file = (await req.formData()).get("image");
    if (!(file instanceof File)) throw new HttpError(400, "No image was uploaded.");
    return setWatchArt(ctx, kind, id, which, Buffer.from(await file.arrayBuffer()));
  }
  const body = await readJson(req, watchArtSchema);
  if ("url" in body) return setWatchArtFromUrl(ctx, kind, id, which, body.url);
  return setWatchArtFromTmdb(ctx, kind, id, which, body.tmdbPath);
}

/** TMDB's posters or backdrops for a matched title; none when it isn't matched or TMDB isn't set up. */
export async function watchArtOptions(ctx: AppContext, kind: WatchKind, id: string, which: ArtKind): Promise<WatchArtOption[]> {
  const row = ctx.sqlite.prepare(`SELECT tmdb_id FROM ${tableOf(kind)} WHERE id = ?`).get(id) as { tmdb_id: number | null } | undefined;
  if (!row) throw notFound(kind);
  if (!row.tmdb_id || !ctx.watch.tmdb) return [];
  try {
    const paths = await ctx.watch.tmdb.images(kind, row.tmdb_id, which);
    return paths.slice(0, 24).map((p) => ({ tmdbPath: p, thumbUrl: tmdbThumbUrl(p)! }));
  } catch (err) {
    if (err instanceof ProviderError) throw new HttpError(502, `TMDB ${err.message}.`);
    throw err;
  }
}

function requireTmdb(ctx: AppContext) {
  if (!ctx.watch.tmdb) throw new HttpError(400, "TMDB isn't set up on this server.");
  return ctx.watch.tmdb;
}
