import { type PodcastBrowse, PODCAST_GENRES, type PodcastMoreLike, type PodcastSearchResult } from "@murmur/shared";
import type { AppContext } from "../context";
import type { Sqlite } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { createLogger, errorMessage } from "../log";
import { getPrefs } from "../prefs";
import { artworkLink } from "./artwork";
import { rankLike, subjectTerms, titleSubject } from "./more-like";

/**
 * The public podcast directory (Apple Podcasts): search, the top charts and the shows near one
 * you follow. Apple's endpoints need no key. Answers are kept in memory and shared by every user,
 * so Browse costs Apple a handful of requests a day.
 */

const log = createLogger("podcast-directory");
const COUNTRY = "us";
const TIMEOUT_MS = 8_000;
const SEARCH_MS = 10 * 60_000;
const CHART_MS = 24 * 60 * 60_000;
const LOOKUP_MS = 7 * 24 * 60 * 60_000;
const CHART_SIZE = 50;
const SHELF_SIZE = 12;
/** A More like shelf takes its day's pick from this many of its best matches. */
const SHELF_POOL = 18;
const TOP_SIZE = 10;
const MORE_LIKE_SHELVES = 3;
/** Shows on a show's More like tab. */
const MORE_LIKE_TAB_SIZE = 30;
/** Apple's "Podcasts" genre, which every show has; it says nothing about the show. */
const ALL_PODCASTS_GENRE = 26;

/** A show as the directory describes it. */
export interface DirectoryShow {
  title: string;
  author: string | null;
  artworkUrl: string | null;
  thumbUrl: string | null;
  feedUrl: string;
  episodeCount: number | null;
  /** Most specific first, without "Podcasts". */
  genreIds: number[];
  explicit: boolean;
}

interface AppleResult {
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  trackCount?: number;
  genreIds?: string[];
  collectionExplicitness?: string;
  contentAdvisoryRating?: string;
}

/** A directory answer as a show, or null when it has no RSS feed (Apple-only shows). */
export function toShow(r: AppleResult): DirectoryShow | null {
  if (!r.feedUrl || !r.collectionName) return null;
  return {
    title: r.collectionName,
    author: r.artistName ?? null,
    artworkUrl: r.artworkUrl600 ?? r.artworkUrl100 ?? null,
    thumbUrl: r.artworkUrl100 ?? r.artworkUrl600 ?? null,
    feedUrl: r.feedUrl,
    episodeCount: r.trackCount ?? null,
    genreIds: (r.genreIds ?? []).map(Number).filter((g) => Number.isInteger(g) && g !== ALL_PODCASTS_GENRE),
    explicit: r.collectionExplicitness === "explicit" || r.contentAdvisoryRating === "Explicit",
  };
}

/** The Apple ids in a top podcasts RSS answer, best first. One entry comes as an object, not a list. */
export function chartIds(body: unknown): string[] {
  const entry = (body as { feed?: { entry?: unknown } })?.feed?.entry;
  const list = Array.isArray(entry) ? entry : entry ? [entry] : [];
  return list
    .map((e) => (e as { id?: { attributes?: Record<string, string> } }).id?.attributes?.["im:id"])
    .filter((id): id is string => typeof id === "string" && /^\d+$/.test(id));
}

/** The items shuffled the same way for the same seed (a day, say), and differently for another. */
export function dailyOrder<T>(items: T[], seed: number): T[] {
  // mulberry32: small, fast and good enough to deal cards with.
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** What a list may show you: not what you marked Not interested, and explicit shows only if you allow them. */
export function keepFor(show: DirectoryShow, notInterested: Set<string>, explicitShows: boolean): boolean {
  return !notInterested.has(show.feedUrl) && (explicitShows || !show.explicit);
}

/** Apple asks for about 20 requests a minute, so at most a few go at once. */
const MAX_AT_ONCE = 3;
let running = 0;
const waiting: Array<() => void> = [];

async function getJson(url: string): Promise<unknown> {
  if (running >= MAX_AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": `Murmur/${env.version}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    return await res.json();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** A small time-limited cache that also shares an answer still on its way. */
function cached<T>(ms: number, max: number) {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.value;
    const value = load();
    entries.set(key, { at: Date.now(), value });
    // A failure isn't kept, so the next ask tries again.
    value.catch(() => entries.get(key)?.value === value && entries.delete(key));
    if (entries.size > max) entries.delete(entries.keys().next().value!);
    return value;
  };
}

const searchCache = cached<DirectoryShow[]>(SEARCH_MS, 300);
/** Searches made for More like shelves, which only need to change slowly. */
const subjectCache = cached<DirectoryShow[]>(LOOKUP_MS, 1000);
const chartCache = cached<DirectoryShow[]>(CHART_MS, 50);
const podrollCache = cached<DirectoryShow | null>(LOOKUP_MS, 500);
const lookupCache = new Map<string, { at: number; show: DirectoryShow | null }>();

async function fetchSearch(term: string): Promise<DirectoryShow[]> {
  const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&country=${COUNTRY}&term=${encodeURIComponent(term)}`;
  const body = (await getJson(url)) as { results?: AppleResult[] };
  const seen = new Set<string>();
  const out: DirectoryShow[] = [];
  for (const r of body.results ?? []) {
    const show = toShow(r);
    if (!show || seen.has(show.feedUrl)) continue;
    seen.add(show.feedUrl);
    out.push(show);
  }
  return out;
}

/** Shows by name, best match first. */
export function searchDirectory(term: string): Promise<DirectoryShow[]> {
  return searchCache(term.toLowerCase(), () => fetchSearch(term));
}

/** The same search for a More like shelf, kept a week. */
function subjectSearch(term: string): Promise<DirectoryShow[]> {
  return subjectCache(term.toLowerCase(), () => fetchSearch(term));
}

/** Apple ids to shows, asking only for the ones not looked up this week. */
async function lookup(ids: string[]): Promise<Map<string, DirectoryShow | null>> {
  const now = Date.now();
  const missing = ids.filter((id) => !(now - (lookupCache.get(id)?.at ?? 0) < LOOKUP_MS));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const body = (await getJson(`https://itunes.apple.com/lookup?entity=podcast&country=${COUNTRY}&id=${batch.join(",")}`)) as {
      results?: AppleResult[];
    };
    const found = new Map((body.results ?? []).map((r) => [String(r.collectionId), toShow(r)]));
    for (const id of batch) lookupCache.set(id, { at: now, show: found.get(id) ?? null });
  }
  if (lookupCache.size > 5000) {
    for (const [id, v] of lookupCache) if (now - v.at >= LOOKUP_MS) lookupCache.delete(id);
  }
  return new Map(ids.map((id) => [id, lookupCache.get(id)?.show ?? null]));
}

/** The top 50 shows, overall or in one category. */
export function chart(genreId: number | null): Promise<DirectoryShow[]> {
  return chartCache(String(genreId ?? "all"), async () => {
    const genre = genreId ? `/genre=${genreId}` : "";
    const ids = chartIds(await getJson(`https://itunes.apple.com/${COUNTRY}/rss/toppodcasts/limit=${CHART_SIZE}${genre}/json`));
    const shows = await lookup(ids);
    return ids.map((id) => shows.get(id)).filter((s): s is DirectoryShow => !!s);
  });
}

/** Whether two feed links are the same feed: the directory's copy can differ in http or a last slash. */
export function sameFeed(a: string, b: string): boolean {
  return feedKey(a) === feedKey(b);
}

const feedKey = (u: string) => u.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();

/**
 * A followed show's categories, found by searching its title and matching its feed link, and the
 * other shows that search found. Kept a week, found or not, so Browse searches for each show once
 * rather than on every visit.
 */
async function matchShow(title: string, feedUrl: string): Promise<{ genreIds: number[]; found: DirectoryShow[] }> {
  const found = await subjectSearch(title);
  return { genreIds: found.find((s) => sameFeed(s.feedUrl, feedUrl))?.genreIds ?? [], found };
}

/** A show a feed recommends, read from its own feed (the directory can't look up a feed link). */
function podrollShow(ctx: AppContext, feedUrl: string): Promise<DirectoryShow | null> {
  return podrollCache(feedUrl, async () => {
    const feed = await ctx.podcasts.preview(feedUrl);
    return {
      title: feed.title,
      author: feed.author,
      artworkUrl: feed.imageUrl,
      thumbUrl: feed.imageUrl,
      feedUrl,
      episodeCount: feed.episodes.length,
      genreIds: [],
      // A host's own pick, and feeds don't say; it isn't held back as explicit.
      explicit: false,
    };
  });
}

// ---------- Per person ----------

export function followedFeeds(sqlite: Sqlite, userId: number): Map<string, string> {
  return new Map(
    (
      sqlite
        .prepare("SELECT p.id, p.feed_url FROM podcasts p JOIN subscriptions s ON s.podcast_id = p.id AND s.user_id = ?")
        .all(userId) as Array<{ id: string; feed_url: string }>
    ).map((r) => [r.feed_url, r.id]),
  );
}

function notInterestedFeeds(sqlite: Sqlite, userId: number): Set<string> {
  return new Set(
    (sqlite.prepare("SELECT feed_url FROM podcast_not_interested WHERE user_id = ?").all(userId) as Array<{ feed_url: string }>).map(
      (r) => r.feed_url,
    ),
  );
}

export function setNotInterested(sqlite: Sqlite, userId: number, feedUrl: string, on: boolean) {
  if (on) {
    sqlite.prepare("INSERT OR REPLACE INTO podcast_not_interested (user_id, feed_url, at) VALUES (?, ?, ?)").run(userId, feedUrl, Date.now());
  } else {
    sqlite.prepare("DELETE FROM podcast_not_interested WHERE user_id = ? AND feed_url = ?").run(userId, feedUrl);
  }
}

type RecentShow = { id: string; title: string; feed_url: string; description: string | null; podroll: string | null };

/** Shows you follow, the ones you played most recently first, then the newest followed. */
function recentShows(sqlite: Sqlite, userId: number): RecentShow[] {
  return sqlite
    .prepare(
      `SELECT p.id, p.title, p.feed_url, p.description, p.podroll,
              (SELECT MAX(pr.updated_at) FROM progress pr JOIN episodes e ON e.id = pr.item_id
                WHERE pr.user_id = s.user_id AND pr.item_type = 'episode' AND e.podcast_id = p.id) AS played
         FROM subscriptions s JOIN podcasts p ON p.id = s.podcast_id
        WHERE s.user_id = ?
        ORDER BY played IS NULL, played DESC, s.created_at DESC
        LIMIT 8`,
    )
    .all(userId) as RecentShow[];
}

/** What a show talks about, for More like: its newest episode titles. */
function episodeTitles(sqlite: Sqlite, podcastId: string): string[] {
  return (sqlite.prepare("SELECT title FROM episodes WHERE podcast_id = ? ORDER BY published_at DESC LIMIT 60").all(podcastId) as Array<{
    title: string;
  }>).map((e) => e.title);
}

function podrollOf(show: RecentShow): string[] {
  try {
    const list = JSON.parse(show.podroll ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

export function asResult(sqlite: Sqlite, followed: Map<string, string>, s: DirectoryShow): PodcastSearchResult {
  return {
    title: s.title,
    author: s.author,
    artworkUrl: artworkLink(sqlite, s.artworkUrl),
    thumbUrl: artworkLink(sqlite, s.thumbUrl),
    feedUrl: s.feedUrl,
    episodeCount: s.episodeCount,
    subscribedId: followed.get(s.feedUrl) ?? null,
  };
}

function viewer(ctx: AppContext, userId: number) {
  const followed = followedFeeds(ctx.sqlite, userId);
  const notInterested = notInterestedFeeds(ctx.sqlite, userId);
  const { explicitShows } = getPrefs(ctx, userId);
  const keep = (s: DirectoryShow) => keepFor(s, notInterested, explicitShows);
  // A podroll or the directory can give a followed feed's link with http or a last slash, or at
  // another address altogether (a show's old feed, a mirror), so a followed title counts too.
  const followedKeys = new Set([...followed.keys()].map(feedKey));
  const followedTitles = new Set(
    (
      ctx.sqlite
        .prepare("SELECT p.title FROM podcasts p JOIN subscriptions s ON s.podcast_id = p.id AND s.user_id = ?")
        .all(userId) as Array<{ title: string }>
    ).map((r) => r.title.toLowerCase()),
  );
  const isFollowed = (s: DirectoryShow) => followedKeys.has(feedKey(s.feedUrl)) || followedTitles.has(s.title.toLowerCase());
  return { followed, keep, isFollowed, result: (s: DirectoryShow) => asResult(ctx.sqlite, followed, s) };
}

const unreachable = (err: unknown) => {
  log.warn("directory failed", { error: errorMessage(err) });
  return new HttpError(502, "Can't reach the podcast directory.");
};

/** A chart as you see it: shows you follow stay, marked, so the ranks hold. */
export async function chartFor(ctx: AppContext, userId: number, genreId: number | null): Promise<PodcastSearchResult[]> {
  if (genreId !== null && !PODCAST_GENRES.some((g) => g.id === genreId)) throw new HttpError(400, "No such category.");
  const shows = await chart(genreId).catch((err: unknown) => {
    throw unreachable(err);
  });
  const v = viewer(ctx, userId);
  return shows.filter(v.keep).map(v.result);
}

/** What a show is about, from your library or, for one you don't follow, its feed. */
type About = { title: string; feedUrl: string; description: string | null; podroll: string[]; episodeTitles: string[] };

const aboutFollowed = (sqlite: Sqlite, show: RecentShow): About => ({
  title: show.title,
  feedUrl: show.feed_url,
  description: show.description,
  podroll: podrollOf(show),
  episodeTitles: episodeTitles(sqlite, show.id),
});

/**
 * Shows like `about`: the ones its feed recommends (`podcast:podroll`), then shows found by
 * searching what it's about, ranked by how well they match (more-like.ts), with the category's
 * chart filling any gap. `genreIds` and `found` come from matchShow. Only shows `wanted` lets
 * through; a failed search or feed just leaves its part out.
 */
async function moreLikeShows(
  ctx: AppContext,
  about: About,
  { genreIds, found }: { genreIds: number[]; found: DirectoryShow[] },
  wanted: (s: DirectoryShow) => boolean,
): Promise<{ recommended: DirectoryShow[]; similar: DirectoryShow[] }> {
  const subject = titleSubject(about.title);
  const terms = subjectTerms(about);
  const [fromFeed, bySubject, byTerms, byChart] = await Promise.all([
    Promise.all(about.podroll.slice(0, 8).map((url) => podrollShow(ctx, url).catch(() => null))),
    subject ? subjectSearch(subject).catch(() => []) : Promise.resolve([]),
    Promise.all(terms.map((t) => subjectSearch(t).catch(() => []))),
    genreIds.length ? chart(genreIds[0]!).catch(() => []) : Promise.resolve([]),
  ]);
  // The show itself, even where the directory has its feed at another address.
  const itself = (s: DirectoryShow) => sameFeed(s.feedUrl, about.feedUrl) || s.title.toLowerCase() === about.title.toLowerCase();
  const recommended = fromFeed.filter((s): s is DirectoryShow => !!s && wanted(s) && !itself(s));
  const seen = new Set(recommended.map((s) => s.feedUrl));
  const similar = rankLike(
    { feedUrl: about.feedUrl, genreIds },
    [{ weight: 1, shows: found }, { weight: 1, shows: bySubject }, ...byTerms.map((shows) => ({ weight: 0.7, shows }))],
    byChart,
  ).filter((s) => wanted(s) && !seen.has(s.feedUrl) && !itself(s));
  return { recommended, similar };
}

/**
 * A show's More like tab, followed or not: the shows its feed recommends, then up to 30 in all,
 * best match first and the same from day to day. Shows you follow or aren't interested in are
 * left out. A show you don't follow is read from its feed (the preview just read it, so it's cached).
 */
export async function moreLikeFor(ctx: AppContext, userId: number, feedUrl: string): Promise<PodcastMoreLike> {
  const followed = ctx.sqlite
    .prepare(
      `SELECT p.id, p.title, p.feed_url, p.description, p.podroll FROM podcasts p
         JOIN subscriptions s ON s.podcast_id = p.id AND s.user_id = ? WHERE p.feed_url = ?`,
    )
    .get(userId, feedUrl) as RecentShow | undefined;
  let about: About;
  if (followed) {
    about = aboutFollowed(ctx.sqlite, followed);
  } else {
    const feed = await ctx.podcasts.preview(feedUrl);
    about = { title: feed.title, feedUrl, description: feed.description, podroll: feed.podroll, episodeTitles: feed.episodes.slice(0, 60).map((e) => e.title) };
  }
  const v = viewer(ctx, userId);
  const match = await matchShow(about.title, about.feedUrl).catch((err: unknown) => {
    throw unreachable(err);
  });
  const { recommended, similar } = await moreLikeShows(ctx, about, match, (s) => v.keep(s) && !v.isFollowed(s));
  const picks = recommended.slice(0, MORE_LIKE_TAB_SIZE);
  return { recommended: picks.map(v.result), similar: similar.slice(0, MORE_LIKE_TAB_SIZE - picks.length).map(v.result) };
}

/**
 * Browse: up to three More like shelves, then the top shows. Each shelf is for a show you follow,
 * one per category: the show you played last, then others in an order that changes daily. On it
 * go the shows its feed recommends (`podcast:podroll`), then shows found by searching what it's
 * about, ranked by how well they match (more-like.ts), with the category's chart filling any gap.
 * A shelf that can't be built is left off; only the top shows failing fails Browse.
 */
export async function browseFor(ctx: AppContext, userId: number): Promise<PodcastBrowse> {
  const v = viewer(ctx, userId);
  const failed = (show: { id: string }) => (err: unknown) => {
    log.warn("more like failed", { podcast: show.id, error: errorMessage(err) });
    return null;
  };
  // The top shows and every recent show's match load together. Each settles to a value, so one
  // failing neither stops the others nor goes unhandled, and a dead directory fails Browse as soon
  // as the top shows do.
  const topLoad = chart(null).then(
    (shows) => ({ shows, error: null }),
    (error: unknown) => ({ shows: [] as DirectoryShow[], error }),
  );
  const matchesLoad = Promise.all(
    recentShows(ctx.sqlite, userId).map((show) => matchShow(show.title, show.feed_url).then((match) => ({ show, ...match }), failed(show))),
  );
  const top = await topLoad;
  if (top.error) throw unreachable(top.error);
  const matches = await matchesLoad;

  // One candidate per category; a show with no category still counts if its feed recommends shows.
  const usedGenres = new Set<number>();
  const distinct = matches.filter((m) => {
    if (!m) return false;
    if (!m.genreIds.length) return podrollOf(m.show).length > 0;
    if (usedGenres.has(m.genreIds[0]!)) return false;
    usedGenres.add(m.genreIds[0]!);
    return true;
  }) as Array<NonNullable<(typeof matches)[number]>>;
  const today = Math.floor(Date.now() / 86_400_000);
  const candidates = [...distinct.slice(0, 1), ...dailyOrder(distinct.slice(1), today + userId)];
  const wanted = (s: DirectoryShow) => v.keep(s) && !v.isFollowed(s);

  const shelf = async (source: (typeof candidates)[number]) => {
    const { show } = source;
    const { recommended: picks, similar } = await moreLikeShows(ctx, aboutFollowed(ctx.sqlite, show), source, wanted);
    // A day's pick from the best matches, kept in their order, so the shelf changes from day to day.
    const pool = similar.slice(0, SHELF_POOL);
    const seed = today + [...show.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
    const daily = new Set(dailyOrder(pool, seed).slice(0, Math.max(SHELF_SIZE - picks.length, 0)));
    const shows = [...picks.slice(0, SHELF_SIZE), ...pool.filter((s) => daily.has(s))];
    return shows.length ? { podcastId: show.id, title: show.title, shows: shows.map(v.result) } : null;
  };
  // As many at a time as shelves are still wanted; an empty or failed one gives its place to the next.
  const moreLike: PodcastBrowse["moreLike"] = [];
  for (let i = 0; i < candidates.length && moreLike.length < MORE_LIKE_SHELVES; ) {
    const batch = candidates.slice(i, i + MORE_LIKE_SHELVES - moreLike.length);
    i += batch.length;
    const built = await Promise.all(batch.map((c) => shelf(c).catch(failed(c.show))));
    moreLike.push(...built.filter((s) => s !== null));
  }
  return { moreLike, top: top.shows.filter(v.keep).slice(0, TOP_SIZE).map(v.result) };
}
