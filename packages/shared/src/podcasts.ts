import type { EpisodeCacheStatusDto, EpisodeDto, EpisodeWithShow, PodcastSearchResult, PodcastSummary } from "./index";

// Podcast lists and settings shared by the web player and the Android app.

// ---------- Podcasts tab ----------

export type PodcastSort = "latest" | "title" | "unplayed";
export const PODCAST_SORT_LABEL: Record<PodcastSort, string> = { latest: "Latest episode", title: "Title", unplayed: "Most unplayed" };

export function sortShows(shows: PodcastSummary[], sort: PodcastSort): PodcastSummary[] {
  const out = [...shows];
  if (sort === "title") return out.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "unplayed") return out.sort((a, b) => b.unplayedCount - a.unplayedCount || a.title.localeCompare(b.title));
  return out.sort((a, b) => (b.latestPublishedAt ?? 0) - (a.latestPublishedAt ?? 0));
}

export type PodcastTab = "home" | "shows" | "browse";
export const PODCAST_TABS: Array<{ id: PodcastTab; label: string }> = [
  { id: "home", label: "Home" },
  { id: "shows", label: "Shows" },
  { id: "browse", label: "Browse" },
];

// ---------- Browse ----------

/** Apple Podcasts' top-level categories, which Browse's charts are per. Names are shortened. */
export const PODCAST_GENRES: Array<{ id: number; name: string }> = [
  { id: 1301, name: "Arts" },
  { id: 1321, name: "Business" },
  { id: 1303, name: "Comedy" },
  { id: 1304, name: "Education" },
  { id: 1483, name: "Fiction" },
  { id: 1511, name: "Government" },
  { id: 1512, name: "Health" },
  { id: 1487, name: "History" },
  { id: 1305, name: "Kids and family" },
  { id: 1502, name: "Leisure" },
  { id: 1310, name: "Music" },
  { id: 1489, name: "News" },
  { id: 1314, name: "Religion" },
  { id: 1533, name: "Science" },
  { id: 1324, name: "Society and culture" },
  { id: 1545, name: "Sports" },
  { id: 1318, name: "Technology" },
  { id: 1488, name: "True crime" },
  { id: 1309, name: "TV and film" },
];

/** How many of the top shows Browse lists before its heading opens all of them. */
export const BROWSE_TOP_SIZE = 5;

/** Browse: "More like" shelves for shows you follow, then the top shows. */
export interface PodcastBrowse {
  moreLike: Array<{ podcastId: string; title: string; shows: PodcastSearchResult[] }>;
  top: PodcastSearchResult[];
}

/** A followed show's More like tab: the shows its feed recommends, then similar shows, best first. */
export interface PodcastMoreLike {
  recommended: PodcastSearchResult[];
  similar: PodcastSearchResult[];
}

/**
 * The feed link in Browse's box as an https address, or null when it's words to search for.
 * Takes "feed://", a bare host with a path, and "www." without a scheme.
 */
export function feedLinkIn(text: string): string | null {
  const t = text.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  if (/^feed:\/\/\S+$/i.test(t)) return `https://${t.slice(7)}`;
  if (/^www\.\S+$/i.test(t) || /^[\w-]+(\.[\w-]+)+\/\S*$/.test(t)) return `https://${t}`;
  return null;
}

/** Home's sections, each opening its full list from the heading. Every show is on the Shows tab. */
export type PodcastListId = "continue" | "new";
export const PODCAST_LIST_IDS: PodcastListId[] = ["continue", "new"];
export const PODCAST_LIST_TITLES: Record<PodcastListId, string> = {
  continue: "Continue listening",
  new: "New episodes",
};

/** How many rows New episodes shows on Home before its heading opens the full list. */
export const PODCAST_SECTION_SIZE = 6;
/** New episodes shown per page in the full list. */
export const NEW_EPISODES_PAGE = 10;

/** Each show's newest new episode, with how many new ones it has. Input is newest first. */
export function newByShow(episodes: EpisodeWithShow[]): { episode: EpisodeWithShow; count: number }[] {
  const groups = new Map<string, { episode: EpisodeWithShow; count: number }>();
  for (const e of episodes) {
    const g = groups.get(e.podcastId);
    if (g) g.count++;
    else groups.set(e.podcastId, { episode: e, count: 1 });
  }
  return [...groups.values()];
}

// ---------- A show's episodes ----------

/** Episodes shown before the rest load. */
export const EPISODE_PAGE = 20;

export type ShowTab = "episodes" | "unplayed" | "bookmarks" | "morelike";
/** The show page's tabs, in order. Bookmarks only shows when the show has some. */
export const SHOW_TABS: Array<{ id: ShowTab; label: string }> = [
  { id: "episodes", label: "Episodes" },
  { id: "unplayed", label: "Unplayed" },
  { id: "bookmarks", label: "Bookmarks" },
  { id: "morelike", label: "More like" },
];

/** The Unplayed tab: episodes not finished, in progress ones included, in the order given. */
export function unplayedEpisodes<T extends { progress: { finished: boolean } | null }>(episodes: T[]): T[] {
  return episodes.filter((e) => !e.progress?.finished);
}

/**
 * Episode search on a show: the title or the notes, ignoring case. `query` is already
 * trimmed and lowercased. Lists carry the start of the notes (`?short=1`), so that's what's searched.
 */
export function matchesEpisode(e: EpisodeDto, query: string): boolean {
  return e.title.toLowerCase().includes(query) || !!e.description?.toLowerCase().includes(query);
}

// ---------- Server settings ----------

/** Choices for how many recent episodes the server keeps ready per show. */
export const KEEP_PER_SHOW_OPTIONS = [0, 1, 3, 5, 10];

/** The add-on reports every minute or so; this long without a word counts as not connected. */
const ADDON_SILENT_MS = 15 * 60_000;

/** The ad detection lines in server settings. `now` is when the status was fetched. */
export function adScanStatus(ads: EpisodeCacheStatusDto["ads"], now: number) {
  const state = !ads.addon || now - ads.addon.seenAt > ADDON_SILENT_MS ? "missing" : ads.addon.state;
  const text =
    state === "missing"
      ? "Not connected. Check the add-on container is running."
      : state === "ok"
        ? "Working"
        : (ads.addon?.message ?? (state === "paused" ? "Paused" : "Stopped by an error"));
  const groq = state === "missing" ? null : ads.addon?.groq;
  const groqText = groq
    ? `Transcribing with Vosk${
        groq.until ? ` until ${new Date(groq.until).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""
      }. ${groq.problem}.`
    : null;
  const counts = [`${ads.done} scanned`, ads.queued ? `${ads.queued} waiting` : null, ads.failed ? `${ads.failed} failed` : null]
    .filter(Boolean)
    .join(", ");
  // A Groq problem with no end time (a bad key, say) won't clear up by itself.
  return { state, text, groqText, groqStuck: !!groq && !groq.until, counts };
}
