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
  /** Shared by everyone subscribed; admin only. */
  autoDownload: z.boolean().optional(),
  keepLatest: z.number().int().min(1).max(50).optional(),
  /** Your own playback speed for the show. */
  speed: z.number().min(0.5).max(3).optional(),
});
export type PodcastSettingsInput = z.input<typeof podcastSettingsSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

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
  autoDownload: boolean;
  keepLatest: number;
  /** Your playback speed for this show. */
  speed: number;
  lastError: string | null;
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
  /** The publisher's URL. Play through `episodeUrl`, which uses the server's copy when there is one. */
  audioUrl: string;
  downloaded: boolean;
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
  /** Serves the server's copy if downloaded, otherwise relays the publisher's audio. */
  episodeUrl: (episodeId: string) => `/api/stream/episode/${episodeId}`,
};
