import type { EpisodeCacheStatusDto, EpisodeDto, EpisodeWithShow, PodcastSummary } from "./index";

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

export type PodcastListId = "continue" | "new" | "podcasts";
export const PODCAST_LIST_IDS: PodcastListId[] = ["continue", "new", "podcasts"];
export const PODCAST_LIST_TITLES: Record<PodcastListId, string> = {
  continue: "Continue listening",
  new: "New episodes",
  podcasts: "Your podcasts",
};

/** How many rows each section on the Podcasts tab shows before its heading opens the full list. */
export const PODCAST_SECTION_SIZE = 3;
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
export const ADDON_SILENT_MS = 15 * 60_000;

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
