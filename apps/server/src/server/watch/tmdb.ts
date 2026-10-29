import type { Sqlite } from "../db";
import { cachedJson, ProviderError } from "../metadata/providers";
import type { TmdbResult } from "./match-score";

const API = "https://api.themoviedb.org/3";
const IMAGES = "https://image.tmdb.org/t/p";
const TIMEOUT_MS = 15_000;

export type TmdbKind = "movie" | "show";

/** A search result with what the Match sheet shows. */
export interface TmdbSearchResult extends TmdbResult {
  overview: string | null;
  posterPath: string | null;
}

export interface TmdbDetails {
  id: number;
  title: string;
  year: string | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  /** Shows: the seasons TMDB knows, by number. */
  seasons: number[];
}

export interface TmdbEpisode {
  season: number;
  episode: number;
  title: string | null;
  overview: string | null;
  airDate: string | null;
  stillPath: string | null;
}

interface RawResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  seasons?: Array<{ season_number: number }>;
}

const yearOf = (date: string | undefined) => (date && /^\d{4}/.test(date) ? date.slice(0, 4) : null);
const text = (s: string | undefined | null) => (s?.trim() ? s.trim() : null);

/**
 * TMDB through the shared 30-day cache. The key only goes on the request itself, so it stays
 * out of the cache and the logs. Errors are ProviderErrors, worded to follow "TMDB".
 */
export function createTmdb(sqlite: Sqlite, opts: { apiKey: string; language: string; userAgent: string }) {
  const get = <T>(pathAndQuery: string) => {
    const url = `${API}${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}language=${encodeURIComponent(opts.language)}`;
    return cachedJson<T>(sqlite, url, opts.userAgent, `${url}&api_key=${encodeURIComponent(opts.apiKey)}`);
  };

  async function search(kind: TmdbKind, query: string, year: string | null): Promise<TmdbSearchResult[]> {
    const q = encodeURIComponent(query.trim());
    const y = year && /^\d{4}$/.test(year) ? year : null;
    const yearParam = y ? (kind === "movie" ? `&year=${y}` : `&first_air_date_year=${y}`) : "";
    const body = await get<{ results?: RawResult[] }>(`/search/${kind === "movie" ? "movie" : "tv"}?query=${q}${yearParam}&include_adult=false`);
    return (body?.results ?? []).map((r) => {
      const title = r.title ?? r.name ?? "";
      const y = yearOf(r.release_date ?? r.first_air_date);
      return {
        id: r.id,
        title,
        originalTitle: r.original_title ?? r.original_name ?? title,
        year: y ? Number(y) : null,
        overview: text(r.overview),
        posterPath: r.poster_path ?? null,
      };
    });
  }

  async function details(kind: TmdbKind, id: number): Promise<TmdbDetails | null> {
    const r = await get<RawResult>(`/${kind === "movie" ? "movie" : "tv"}/${id}`);
    if (!r) return null;
    return {
      id: r.id,
      title: r.title ?? r.name ?? "",
      year: yearOf(r.release_date ?? r.first_air_date),
      overview: text(r.overview),
      posterPath: r.poster_path ?? null,
      backdropPath: r.backdrop_path ?? null,
      seasons: (r.seasons ?? []).map((s) => s.season_number),
    };
  }

  async function season(showId: number, number: number): Promise<TmdbEpisode[]> {
    const body = await get<{
      episodes?: Array<{ season_number: number; episode_number: number; name?: string; overview?: string; air_date?: string; still_path?: string | null }>;
    }>(`/tv/${showId}/season/${number}`);
    return (body?.episodes ?? []).map((e) => ({
      season: e.season_number,
      episode: e.episode_number,
      title: text(e.name),
      overview: text(e.overview),
      airDate: text(e.air_date),
      stillPath: e.still_path ?? null,
    }));
  }

  /** A picture's bytes, at a size a little over what Murmur stores. */
  async function image(imagePath: string, size: "w780" | "w1280"): Promise<Buffer> {
    const res = await fetch(`${IMAGES}/${size}${imagePath}`, {
      headers: { "User-Agent": opts.userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new ProviderError(`answered ${res.status} for a picture`);
    return Buffer.from(await res.arrayBuffer());
  }

  return { search, details, season, image };
}

export type Tmdb = ReturnType<typeof createTmdb>;

/** A small poster for the Match sheet, loaded straight from TMDB. */
export const tmdbThumbUrl = (posterPath: string | null) => (posterPath ? `${IMAGES}/w185${posterPath}` : null);
