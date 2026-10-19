import { z } from "zod";

// ---------- Request schemas (validated on the server, reused by clients) ----------

export const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const loginSchema = credentialsSchema.extend({
  /** "web" sets a session cookie; "app" returns a bearer token in the body. */
  client: z.enum(["web", "app"]).default("web"),
  deviceName: z.string().trim().max(100).optional(),
});
export type LoginInput = z.input<typeof loginSchema>;

export const setupSchema = credentialsSchema.extend({
  password: z.string().min(8).max(256),
});
export type SetupInput = z.input<typeof setupSchema>;

export const createUserSchema = setupSchema.extend({
  isAdmin: z.boolean().default(false),
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const itemTypeSchema = z.enum(["book", "episode"]);
export type ItemType = z.infer<typeof itemTypeSchema>;

export const progressItemSchema = z.object({
  itemType: itemTypeSchema,
  itemId: z.string().min(1).max(64),
  positionSec: z.number().min(0),
  durationSec: z.number().min(0),
  finished: z.boolean(),
  /** Omit to keep the speed already saved (1× for a new item). */
  speed: z.number().min(0.5).max(3).optional(),
  /** Client timestamp (ms since epoch) of the change; the newest update wins. */
  updatedAt: z.number().int().positive(),
});
export type ProgressItem = z.input<typeof progressItemSchema>;

export const progressBatchSchema = z.object({
  items: z.array(progressItemSchema).min(1).max(500),
});
export type ProgressBatch = z.input<typeof progressBatchSchema>;

export const subscribeSchema = z.object({
  feedUrl: z.url({ protocol: /^https?$/ }).trim().max(2000),
});
export type SubscribeInput = z.input<typeof subscribeSchema>;

export const podcastSettingsSchema = z.object({
  /** Your own playback speed for the show. */
  speed: z.number().min(0.5).max(3).optional(),
});
export type PodcastSettingsInput = z.input<typeof podcastSettingsSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

const folderPathSchema = z.string().trim().min(1).max(1024);
/** Replaces the library folder list (admin). */
export const libraryFoldersSchema = z.object({
  paths: z.array(folderPathSchema).min(1, "Keep at least one library folder.").max(20),
});
export const folderCheckSchema = z.object({
  path: folderPathSchema,
  /** The other folders in the list, to catch overlaps before saving. */
  others: z.array(folderPathSchema).max(20).default([]),
});

export const queueRefSchema = z.object({
  itemType: itemTypeSchema,
  itemId: z.string().min(1).max(64),
});
export type QueueRef = z.infer<typeof queueRefSchema>;

/** Replaces the whole queue: reorder, remove and clear are all this one call. */
export const queueReplaceSchema = z.object({ items: z.array(queueRefSchema).max(500) });
export type QueueReplaceInput = z.input<typeof queueReplaceSchema>;

export const queueAddSchema = queueRefSchema.extend({
  /** "next" plays it after the current item; "last" appends. */
  at: z.enum(["next", "last"]).default("last"),
});
export type QueueAddInput = z.input<typeof queueAddSchema>;

export const archiveSchema = z.object({ archived: z.boolean() });

export const matchFieldSchema = z.enum([
  "title",
  "author",
  "narrator",
  "series",
  "description",
  "year",
  "cover",
  "chapters",
]);
export type MatchField = z.infer<typeof matchFieldSchema>;

export const matchApplySchema = z.object({
  provider: z.enum(["audible", "google"]),
  providerId: z.string().min(1).max(64),
  fields: z.array(matchFieldSchema).min(1),
});
export type MatchApplyInput = z.input<typeof matchApplySchema>;

/**
 * A book's details as edited by an admin. Every field is sent; a value equal to what the
 * files say is stored as "use the files", and an empty string clears the field.
 */
export const bookEditSchema = z.object({
  title: z.string().max(500),
  author: z.string().max(500),
  narrator: z.string().max(500),
  series: z.string().max(500),
  seriesPosition: z.number().min(0).max(100_000).nullable(),
  year: z.string().max(20),
  description: z.string().max(20_000),
});
export type BookEditInput = z.input<typeof bookEditSchema>;

/** Hand-edited chapters, or null to go back to the files' chapters. */
export const chaptersEditSchema = z.object({
  chapters: z
    .array(z.object({ title: z.string().trim().min(1).max(500), startSec: z.number().min(0) }))
    .min(1)
    .max(5000)
    .nullable(),
});
export type ChaptersEditInput = z.input<typeof chaptersEditSchema>;

export const coverUrlSchema = z.object({ url: z.url({ protocol: /^https?$/ }).trim().max(2000) });

// ---------- Response shapes ----------

export interface UserDto {
  id: number;
  username: string;
  isAdmin: boolean;
}

export interface LoginResponse {
  user: UserDto;
  /** Only present for client "app". */
  token?: string;
}

export interface ProgressDto {
  itemType: ItemType;
  itemId: string;
  positionSec: number;
  durationSec: number;
  finished: boolean;
  speed: number;
  updatedAt: number;
}

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  seriesPosition: number | null;
  durationSec: number;
  /** Changes whenever the cover changes; append as `?h=` to the cover URL for permanent caching. */
  coverHash: string | null;
  /** Dominant cover colour (#rrggbb) for tinted headers and placeholders. */
  coverColor: string | null;
  addedAt: number;
  /** Set when the book's folder disappeared; it is hidden after 7 days. */
  missingSince: number | null;
  /** Metadata was applied from Audible or Google Books. */
  matched: boolean;
  progress: Pick<ProgressDto, "positionSec" | "finished" | "speed" | "updatedAt"> | null;
}

export interface BookFileDto {
  index: number;
  durationSec: number;
  /** Where this file starts on the book's continuous timeline. */
  startSec: number;
  mimeType: string;
}

export interface ChapterDto {
  index: number;
  title: string;
  startSec: number;
  endSec: number;
}

export interface BookDetail extends BookSummary {
  description: string | null;
  year: string | null;
  asin: string | null;
  files: BookFileDto[];
  chapters: ChapterDto[];
  /** Set when metadata was applied through Match; those values win over the files. */
  match: { provider: MatchProvider; providerId: string; matchedAt: number } | null;
}

export interface PodcastSummary {
  id: string;
  title: string;
  author: string | null;
  /** Locally cached artwork; null until fetched, then use the cover URL helper. */
  coverHash: string | null;
  coverColor: string | null;
  episodeCount: number;
  /** Unfinished episodes published since a week before you subscribed. */
  unplayedCount: number;
  latestPublishedAt: number | null;
  /** Your playback speed for this show. */
  speed: number;
  lastError: string | null;
}

/** A podcast found by name in the public directory (Apple Podcasts search). */
export interface PodcastSearchResult {
  title: string;
  author: string | null;
  /** Artwork on the directory's CDN, shown as-is in results. */
  artworkUrl: string | null;
  feedUrl: string;
  episodeCount: number | null;
  /** Your podcast's id when you already follow this feed. */
  subscribedId: string | null;
}

/** An episode in a feed you're looking at before subscribing. Not saved, so it has no id. */
export interface PodcastPreviewEpisode {
  guid: string;
  title: string;
  description: string | null;
  publishedAt: number;
  durationSec: number | null;
}

/** A feed read live so you can look before subscribing. */
export interface PodcastPreview {
  feedUrl: string;
  title: string;
  author: string | null;
  description: string | null;
  link: string | null;
  /** The feed's own artwork URL, shown as-is. */
  artworkUrl: string | null;
  episodeCount: number;
  latestPublishedAt: number | null;
  /** Newest first, at most the latest 100. */
  episodes: PodcastPreviewEpisode[];
  /** Your podcast's id when you already follow this feed. */
  subscribedId: string | null;
}

export interface PodcastDetail extends PodcastSummary {
  description: string | null;
  link: string | null;
  feedUrl: string;
  lastCheckedAt: number | null;
}

export interface EpisodeDto {
  id: string;
  podcastId: string;
  title: string;
  /** Plain text; feed HTML is stripped on the server. */
  description: string | null;
  publishedAt: number;
  durationSec: number | null;
  /** The publisher's URL. Play through `episodeUrl`, which relays it through the server. */
  audioUrl: string;
  archived: boolean;
  imageUrl: string | null;
  season: number | null;
  episodeNumber: number | null;
  progress: Pick<ProgressDto, "positionSec" | "finished" | "speed" | "updatedAt"> | null;
}

/** An episode listed outside its show page, so it carries the show's details. */
export interface EpisodeWithShow extends EpisodeDto {
  podcastTitle: string;
  podcastCoverHash: string | null;
  podcastCoverColor: string | null;
  /** Your playback speed for the show. */
  speed: number;
}

export type QueueEntry =
  | { itemType: "book"; itemId: string; book: BookSummary }
  | { itemType: "episode"; itemId: string; episode: EpisodeWithShow };

export type MatchProvider = "audible" | "google";

export interface MatchCandidate {
  provider: MatchProvider;
  providerId: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  series: string | null;
  seriesPosition: number | null;
  year: string | null;
  durationSec: number | null;
  language: string | null;
  coverUrl: string | null;
  /** 0 to 100; the same book always gets the same score. */
  score: number;
  /** Why it scored that way, one short line per signal. */
  reasons: string[];
}

export interface MatchSearchResult {
  query: { title: string; author: string | null; asin: string | null };
  candidates: MatchCandidate[];
  /** Pre-selected candidate when one scored 90 or more. */
  suggested: string | null;
  /** Providers that failed; results from the others are still listed. */
  errors: string[];
}

export interface MatchPreview {
  provider: MatchProvider;
  providerId: string;
  current: MatchValues;
  proposed: MatchValues;
  /** Fields worth applying by default: empty or poorer locally. */
  recommended: MatchField[];
  /** Why chapters can't be applied, when they can't. */
  chaptersNote: string | null;
}

export interface MatchValues {
  title: string | null;
  author: string | null;
  narrator: string | null;
  series: string | null;
  seriesPosition: number | null;
  description: string | null;
  year: string | null;
  coverUrl: string | null;
  coverWidth: number | null;
  chapterCount: number;
}

export interface OpmlImportResult {
  added: number;
  alreadySubscribed: number;
  failed: Array<{ feedUrl: string; error: string }>;
}

export type EditableField = keyof BookEditInput;

/** What the files say, before any match or edit. */
export interface BookEditValues {
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  seriesPosition: number | null;
  year: string | null;
  description: string | null;
}

export interface BookFileInfo {
  /** Path inside the book's folder. */
  name: string;
  size: number;
  durationSec: number;
  mimeType: string;
}

/** Everything the admin edit dialog needs for one book. */
export interface BookEditInfo {
  book: BookDetail;
  scanned: BookEditValues;
  /** Fields whose shown value differs from the files (edited or matched). */
  edited: EditableField[];
  chaptersEdited: boolean;
  scannedChapters: ChapterDto[];
  /** "custom" covers both uploaded and matched covers. */
  coverSource: "files" | "custom" | "none";
  scannedCoverHash: string | null;
  /** Absolute folder path as the server sees it; null once its library folder was removed. */
  folder: string | null;
  files: BookFileInfo[];
}

export interface LibraryFolderDto {
  id: number;
  path: string;
  books: number;
  reachable: boolean;
}

export interface FolderCheckDto {
  path: string;
  ok: boolean;
  message: string;
  subfolders: number;
}

export interface FolderBrowseDto {
  path: string;
  parent: string | null;
  folders: string[];
}

export interface HealthDto {
  ok: boolean;
  version: string;
  uptimeSec: number;
  database: boolean;
  library: { reachable: boolean; books: number };
  scan: {
    running: boolean;
    lastFinishedAt: number | null;
    lastDurationMs: number | null;
    lastError: string | null;
  };
  watcher: "events" | "polling" | "periodic-only";
}

export interface ApiError {
  error: string;
}

// ---------- URL helpers shared by web and app ----------

export const apiPaths = {
  coverUrl: (bookId: string, coverHash: string, size: 200 | 600) =>
    `/api/books/${bookId}/cover?size=${size}&h=${coverHash}`,
  bookFileUrl: (bookId: string, fileIndex: number) =>
    `/api/stream/book/${bookId}/${fileIndex}`,
  podcastCoverUrl: (podcastId: string, coverHash: string, size: 200 | 600) =>
    `/api/podcasts/${podcastId}/cover?size=${size}&h=${coverHash}`,
  /** Relays the publisher's audio through the server; supports range requests. */
  episodeUrl: (episodeId: string) => `/api/stream/episode/${episodeId}`,
};
export * from "./format";
export * from "./library";
export * from "./shelves";
