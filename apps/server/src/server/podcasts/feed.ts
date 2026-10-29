import { XMLParser } from "fast-xml-parser";

export interface ParsedEpisode {
  guid: string;
  title: string;
  description: string | null;
  publishedAt: number;
  durationSec: number | null;
  audioUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  imageUrl: string | null;
  season: number | null;
  episodeNumber: number | null;
}

export interface ParsedFeed {
  title: string;
  author: string | null;
  description: string | null;
  link: string | null;
  imageUrl: string | null;
  episodes: ParsedEpisode[];
}

// A feed can declare its own entities; a few small ones only, so references can't balloon into
// gigabytes. The limits count only those: ordinary &amp; and &#39; in a long feed's descriptions
// run into the thousands. (`appliesTo` is missing from the parser's types.)
const entityLimits = { maxEntityCount: 16, maxEntitySize: 1024, maxTotalExpansions: 1000, maxExpandedLength: 100_000, appliesTo: "external" };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: entityLimits,
  htmlEntities: true,
  isArray: (name) => name === "item" || name === "outline",
});

/** Types an episode's audio may be served as. Anything else a feed claims is served as MP3 instead of trusted. */
const AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/aac",
  "audio/aacp",
  "audio/ogg",
  "audio/opus",
  "audio/flac",
  "audio/x-flac",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
]);

/** The feed's enclosure type if it's an audio type Murmur knows, else null. Also applied when serving older rows. */
export function audioMimeType(type: string | null | undefined): string | null {
  const clean = type?.split(";")[0]?.trim().toLowerCase() ?? "";
  return AUDIO_TYPES.has(clean) ? clean : null;
}

/** An http(s) address from a feed, or null for anything else (javascript:, data:, a bare path). */
function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export function parseXml(xml: string): unknown {
  return parser.parse(xml);
}

type Node = Record<string, unknown>;

/** Text content of a node that may be a string, a number, or `{ "#text": … }` with attributes. */
function text(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") return text((value as Node)["#text"]);
  const s = String(value).trim();
  return s ? s : null;
}

function attr(value: unknown, name: string): string | null {
  if (Array.isArray(value)) return attr(value[0], name);
  if (value && typeof value === "object") return text((value as Node)[`@_${name}`]);
  return null;
}

function int(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/** itunes:duration comes as "1:02:03", "62:03", "3723" or "3723.5". */
export function parseDuration(value: string | null): number | null {
  if (!value) return null;
  const parts = value.trim().split(":").map(Number);
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  const sec = parts.reduce((acc, p) => acc * 60 + p, 0);
  return sec > 0 ? sec : null;
}

/** Feed descriptions are HTML; we keep plain text so no client ever renders untrusted markup. */
export function htmlToText(html: string | null, max = 20_000): string | null {
  if (!html) return null;
  const out = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  return out ? out.slice(0, max) : null;
}

export class FeedParseError extends Error {}

export function parseFeed(xml: string): ParsedFeed {
  let doc: Node;
  try {
    doc = parseXml(xml) as Node;
  } catch (err) {
    throw new FeedParseError(`Not valid XML: ${err instanceof Error ? err.message : String(err)}`);
  }
  const channel = (doc.rss as Node | undefined)?.channel as Node | undefined;
  if (!channel) throw new FeedParseError("This URL isn't a podcast RSS feed.");

  const title = text(channel.title);
  if (!title) throw new FeedParseError("The feed has no title.");

  const items = (channel.item as Node[] | undefined) ?? [];
  const episodes: ParsedEpisode[] = [];
  for (const item of items) {
    const audioUrl = httpUrl(attr(item.enclosure, "url"));
    if (!audioUrl) continue; // not an audio episode
    const published = Date.parse(text(item.pubDate) ?? "");
    const itemTitle = text(item.title) ?? text(item["itunes:title"]) ?? "Untitled episode";
    episodes.push({
      guid: text(item.guid) ?? audioUrl,
      title: itemTitle,
      description: htmlToText(text(item["content:encoded"]) ?? text(item.description) ?? text(item["itunes:summary"])),
      publishedAt: Number.isFinite(published) ? published : 0,
      durationSec: parseDuration(text(item["itunes:duration"])),
      audioUrl,
      mimeType: audioMimeType(attr(item.enclosure, "type")),
      sizeBytes: int(attr(item.enclosure, "length")) || null,
      imageUrl: httpUrl(attr(item["itunes:image"], "href")),
      season: int(text(item["itunes:season"])),
      episodeNumber: int(text(item["itunes:episode"])),
    });
  }

  return {
    title,
    author: text(channel["itunes:author"]) ?? text(channel.author) ?? text(channel.managingEditor),
    description: htmlToText(text(channel.description) ?? text(channel["itunes:summary"])),
    link: httpUrl(text(channel.link)),
    imageUrl: httpUrl(attr(channel["itunes:image"], "href") ?? text((channel.image as Node | undefined)?.url)),
    episodes,
  };
}

// ---------- OPML ----------

export interface OpmlFeed {
  title: string | null;
  feedUrl: string;
}

export function parseOpml(xml: string): OpmlFeed[] {
  const doc = parseXml(xml) as Node;
  const body = ((doc.opml as Node | undefined)?.body as Node | undefined) ?? {};
  const out: OpmlFeed[] = [];
  const walk = (outlines: unknown) => {
    for (const o of (outlines as Node[] | undefined) ?? []) {
      const url = attr(o, "xmlUrl");
      if (url) out.push({ title: attr(o, "title") ?? attr(o, "text"), feedUrl: url });
      walk(o.outline);
    }
  };
  walk(body.outline);
  return out;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildOpml(feeds: OpmlFeed[]): string {
  const lines = feeds.map((f) => {
    const t = escapeXml(f.title ?? f.feedUrl);
    return `    <outline type="rss" text="${t}" title="${t}" xmlUrl="${escapeXml(f.feedUrl)}"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Murmur subscriptions</title></head>
  <body>
${lines.join("\n")}
  </body>
</opml>
`;
}
