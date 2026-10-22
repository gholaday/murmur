import type { MatchProvider } from "@murmur/shared";
import type { Sqlite } from "../db";
import { createLogger, errorMessage } from "../log";
import { htmlToText } from "../podcasts/feed";
import type { UnscoredCandidate } from "./score";

const log = createLogger("metadata");
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export class ProviderError extends Error {}

/**
 * GET JSON through the 30-day provider cache. When a provider is down, a stale cached
 * answer is better than none, so it is used instead of failing. `fetchUrl` is what's
 * actually requested when it differs from `url`, the cache key: it can carry an API key,
 * which stays out of the database and the logs.
 */
async function cachedJson<T>(sqlite: Sqlite, url: string, userAgent: string, fetchUrl = url): Promise<T | null> {
  const row = sqlite.prepare("SELECT body, fetched_at FROM provider_cache WHERE url = ?").get(url) as
    | { body: string; fetched_at: number }
    | undefined;
  if (row && Date.now() - row.fetched_at < CACHE_TTL_MS) return JSON.parse(row.body) as T;
  try {
    const res = await fetch(fetchUrl, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (res.status === 429) throw new ProviderError("is limiting how often it can be searched. Try again in a while");
    if (res.status >= 500) throw new ProviderError("isn't answering right now. Try again in a while");
    if (!res.ok) throw new ProviderError(`answered ${res.status}`);
    const body = await res.text();
    JSON.parse(body); // don't cache garbage
    sqlite
      .prepare(
        "INSERT INTO provider_cache (url, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT (url) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at",
      )
      .run(url, body, Date.now());
    return JSON.parse(body) as T;
  } catch (err) {
    if (row) {
      log.warn("provider unreachable, using stale cache", { url, error: errorMessage(err) });
      return JSON.parse(row.body) as T;
    }
    throw new ProviderError(err instanceof ProviderError ? err.message : "couldn't be reached");
  }
}

export interface ChapterList {
  chapters: Array<{ title: string; startSec: number; endSec: number }>;
  runtimeSec: number;
}

/** Full details for applying a match: the candidate plus what only a detail lookup has. */
export interface CandidateDetail extends UnscoredCandidate {
  description: string | null;
}

// ---------- Audible (unofficial catalog API, the same one Audiobookshelf uses) ----------

const AUDIBLE_HOSTS: Record<string, string> = {
  us: "api.audible.com",
  uk: "api.audible.co.uk",
  ca: "api.audible.ca",
  au: "api.audible.com.au",
  de: "api.audible.de",
  fr: "api.audible.fr",
  it: "api.audible.it",
  es: "api.audible.es",
  in: "api.audible.in",
  jp: "api.audible.co.jp",
};

const AUDIBLE_GROUPS = "contributors,media,product_attrs,product_desc,product_extended_attrs,series";

interface AudibleProduct {
  asin: string;
  title?: string;
  subtitle?: string;
  authors?: Array<{ name: string }>;
  narrators?: Array<{ name: string }>;
  series?: Array<{ title: string; sequence?: string }>;
  runtime_length_min?: number;
  release_date?: string;
  issue_date?: string;
  language?: string;
  product_images?: Record<string, string>;
  publisher_summary?: string;
  merchandising_summary?: string;
}

function audibleCandidate(p: AudibleProduct): CandidateDetail {
  const images = p.product_images ?? {};
  const biggest = Object.keys(images).sort((a, b) => Number(b) - Number(a))[0];
  const seq = p.series?.[0]?.sequence ? Number.parseFloat(p.series[0].sequence) : NaN;
  const date = p.release_date ?? p.issue_date ?? null;
  return {
    provider: "audible",
    providerId: p.asin,
    title: p.title ?? "",
    subtitle: p.subtitle ?? null,
    author: p.authors?.map((a) => a.name).join(", ") || null,
    narrator: p.narrators?.map((n) => n.name).join(", ") || null,
    series: p.series?.[0]?.title ?? null,
    seriesPosition: Number.isFinite(seq) ? seq : null,
    year: date ? date.slice(0, 4) : null,
    durationSec: p.runtime_length_min ? p.runtime_length_min * 60 : null,
    language: p.language ?? null,
    coverUrl: biggest ? images[biggest]! : null,
    description: htmlToText(p.publisher_summary ?? p.merchandising_summary ?? "") || null,
  };
}

export function createProviders(sqlite: Sqlite, opts: { region: string; userAgent: string; googleApiKey?: string | null }) {
  const host = AUDIBLE_HOSTS[opts.region] ?? AUDIBLE_HOSTS.us!;
  const get = <T>(url: string) => cachedJson<T>(sqlite, url, opts.userAgent);
  // Without a key, Google Books shares a small quota between everyone on the same address.
  const googleGet = async <T>(url: string) => {
    const keyed = opts.googleApiKey ? `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(opts.googleApiKey)}` : url;
    try {
      return await cachedJson<T>(sqlite, url, opts.userAgent, keyed);
    } catch (err) {
      if (err instanceof ProviderError && !opts.googleApiKey && err.message.startsWith("is limiting")) {
        throw new ProviderError(`${err.message}, or set GOOGLE_BOOKS_API_KEY for a quota of your own`);
      }
      throw err;
    }
  };

  async function audibleSearch(title: string, author: string | null): Promise<CandidateDetail[]> {
    const run = async (params: Record<string, string>) => {
      const qs = new URLSearchParams({
        num_results: "10",
        products_sort_by: "Relevance",
        response_groups: AUDIBLE_GROUPS,
        image_sizes: "500,1024",
        ...params,
      });
      const data = await get<{ products?: AudibleProduct[] }>(`https://${host}/1.0/catalog/products?${qs}`);
      return (data?.products ?? []).filter((p) => p.title).map(audibleCandidate);
    };
    const found = author ? await run({ title, author }) : await run({ title });
    // Folder names often carry extra words; a looser keyword search catches those.
    return found.length ? found : run({ keywords: [title, author].filter(Boolean).join(" ") });
  }

  async function audibleByAsin(asin: string): Promise<CandidateDetail | null> {
    const qs = new URLSearchParams({ response_groups: AUDIBLE_GROUPS, image_sizes: "500,1024" });
    const data = await get<{ product?: AudibleProduct }>(`https://${host}/1.0/catalog/products/${encodeURIComponent(asin)}?${qs}`);
    return data?.product?.title ? audibleCandidate(data.product) : null;
  }

  /** Chapter marks from Audnexus, keyed by ASIN. */
  async function audnexusChapters(asin: string): Promise<ChapterList | null> {
    const data = await get<{
      chapters?: Array<{ title: string; startOffsetMs: number; lengthMs: number }>;
      runtimeLengthMs?: number;
    }>(`https://api.audnex.us/books/${encodeURIComponent(asin)}/chapters?region=${opts.region}`);
    if (!data?.chapters?.length || !data.runtimeLengthMs) return null;
    return {
      runtimeSec: data.runtimeLengthMs / 1000,
      chapters: data.chapters.map((c) => ({
        title: c.title,
        startSec: c.startOffsetMs / 1000,
        endSec: (c.startOffsetMs + c.lengthMs) / 1000,
      })),
    };
  }

  // ---------- Google Books (fallback: no lengths or narrators, but broad coverage) ----------

  interface GoogleVolume {
    id: string;
    volumeInfo?: {
      title?: string;
      subtitle?: string;
      authors?: string[];
      publishedDate?: string;
      description?: string;
      language?: string;
      imageLinks?: Record<string, string>;
    };
  }

  function googleCandidate(v: GoogleVolume): CandidateDetail {
    const info = v.volumeInfo ?? {};
    const links = info.imageLinks ?? {};
    const image = links.extraLarge ?? links.large ?? links.medium ?? links.thumbnail ?? null;
    return {
      provider: "google",
      providerId: v.id,
      title: info.title ?? "",
      subtitle: info.subtitle ?? null,
      author: info.authors?.join(", ") || null,
      narrator: null,
      series: null,
      seriesPosition: null,
      year: info.publishedDate?.slice(0, 4) ?? null,
      durationSec: null,
      language: info.language ?? null,
      coverUrl: image ? image.replace(/^http:/, "https:").replace(/&edge=curl/, "") : null,
      description: info.description ? htmlToText(info.description) : null,
    };
  }

  async function googleSearch(title: string, author: string | null): Promise<CandidateDetail[]> {
    const q = [`intitle:${title}`, author ? `inauthor:${author}` : null].filter(Boolean).join(" ");
    const qs = new URLSearchParams({ q, maxResults: "10", printType: "books" });
    const data = await googleGet<{ items?: GoogleVolume[] }>(`https://www.googleapis.com/books/v1/volumes?${qs}`);
    return (data?.items ?? []).filter((v) => v.volumeInfo?.title).map(googleCandidate);
  }

  async function googleById(id: string): Promise<CandidateDetail | null> {
    const data = await googleGet<GoogleVolume>(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}`);
    return data?.volumeInfo?.title ? googleCandidate(data) : null;
  }

  // ---------- iTunes (Apple Books audiobooks: no key or quota, audio editions, big covers) ----------

  interface ItunesAudiobook {
    collectionId: number;
    collectionName?: string;
    artistName?: string;
    releaseDate?: string;
    artworkUrl100?: string;
    description?: string;
  }

  // Apple's store codes match Audible's regions, except the UK.
  const itunesCountry = opts.region === "uk" ? "gb" : opts.region;

  function itunesCandidate(a: ItunesAudiobook): CandidateDetail {
    return {
      provider: "itunes",
      providerId: String(a.collectionId),
      title: (a.collectionName ?? "").replace(/\s*\((un)?abridged\)\s*$/i, ""),
      subtitle: null,
      author: a.artistName ?? null,
      narrator: null,
      series: null,
      seriesPosition: null,
      year: a.releaseDate?.slice(0, 4) ?? null,
      durationSec: null,
      language: null,
      // The artwork link names its size; Apple serves the same image at any size up to the original.
      coverUrl: a.artworkUrl100 ? a.artworkUrl100.replace(/\/100x100bb\./, "/1400x1400bb.") : null,
      description: a.description ? htmlToText(a.description) || null : null,
    };
  }

  async function itunesSearch(title: string, author: string | null): Promise<CandidateDetail[]> {
    const qs = new URLSearchParams({
      term: [title, author].filter(Boolean).join(" "),
      media: "audiobook",
      entity: "audiobook",
      country: itunesCountry,
      limit: "10",
    });
    const data = await get<{ results?: ItunesAudiobook[] }>(`https://itunes.apple.com/search?${qs}`);
    return (data?.results ?? []).filter((a) => a.collectionId && a.collectionName).map(itunesCandidate);
  }

  async function itunesById(id: string): Promise<CandidateDetail | null> {
    const qs = new URLSearchParams({ id, entity: "audiobook", country: itunesCountry });
    const data = await get<{ results?: ItunesAudiobook[] }>(`https://itunes.apple.com/lookup?${qs}`);
    const hit = data?.results?.find((a) => String(a.collectionId) === id && a.collectionName);
    return hit ? itunesCandidate(hit) : null;
  }

  async function byId(provider: MatchProvider, id: string): Promise<CandidateDetail | null> {
    if (provider === "audible") return audibleByAsin(id);
    if (provider === "itunes") return itunesById(id);
    return googleById(id);
  }

  return { audibleSearch, audibleByAsin, audnexusChapters, googleSearch, itunesSearch, byId };
}

export type Providers = ReturnType<typeof createProviders>;
