// Private feeds (paid, members-only, a company's or a family's own) are personal links, and their
// audio shouldn't leave the server, so they're never sent to the ad add-on (Groq and Gemini).
// Nobody marks them: the feed gives itself away, by a key in its URL or by asking directories not
// to list it. A private feed with a plain URL and no such tag still slips through; that's rare.

/** Query names that carry a subscriber's key, as private feed hosts use them. */
const KEY_PARAM = /^(auth|token|key|apikey|api_key|secret|sig|signature|access_token|pass|password|uid|user|member|subscriber)$/i;

/** Hosts whose feeds are all members-only. */
const PRIVATE_HOSTS = ["patreon.com", "supercast.com", "supercast.tech", "supportingcast.fm", "memberful.com", "glow.fm", "steadyhq.com"];

/** Whether a feed is a private one: by its URL alone, or also by what it says about itself. */
export function isPrivateFeed(feedUrl: string, unlisted = false): boolean {
  if (unlisted) return true;
  let url: URL;
  try {
    url = new URL(feedUrl);
  } catch {
    return false;
  }
  if (url.username || url.password) return true;
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  // Substack's paid feeds: /feed/podcast/<id>/private/<key>.rss
  if (/\/private\//i.test(url.pathname)) return true;
  return [...url.searchParams.keys()].some((name) => KEY_PARAM.test(name));
}
