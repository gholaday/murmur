import { z } from "zod";
import { clampSpeed } from "./player";
import type { TrackDto } from "./music";
import type { VideoStatus } from "./video-addon";
import { BOOK_SECTION_IDS } from "./shelves";

// ---------- Request schemas (validated on the server, reused by clients) ----------

/** A playback speed. Anything out of range, like one saved under the old 3× limit, is brought into it. */
const speedSchema = z.number().positive().transform(clampSpeed);

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
/** Everything the player plays: books and episodes keep a position, songs (tracks) don't. */
export const playTypeSchema = z.enum(["book", "episode", "track"]);
export type PlayType = z.infer<typeof playTypeSchema>;
/** What counts towards the stats: the audio player's items, and videos (a movie or a TV episode). */
export const statsTypeSchema = z.enum(["book", "episode", "track", "video"]);
export type StatsType = z.infer<typeof statsTypeSchema>;

export const progressItemSchema = z.object({
  /** "video" is a movie (by the movie's id) or a TV episode; GET /progress leaves those out, as Watch reads its own. */
  itemType: z.enum(["book", "episode", "video"]),
  itemId: z.string().min(1).max(64),
  positionSec: z.number().min(0),
  durationSec: z.number().min(0),
  finished: z.boolean(),
  /** Omit to keep the speed already saved (1× for a new item). */
  speed: speedSchema.optional(),
  /** Client timestamp (ms since epoch) of the change; the newest update wins. */
  updatedAt: z.number().int().positive(),
});
export type ProgressItem = z.input<typeof progressItemSchema>;

export const progressBatchSchema = z.object({
  items: z.array(progressItemSchema).min(1).max(500),
});
export type ProgressBatch = z.input<typeof progressBatchSchema>;

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD.");

/** One device's running listening totals per day and item; see ListeningTracker. */
export const listeningReportSchema = z.object({
  clientId: z.string().min(8).max(64),
  items: z
    .array(
      z.object({
        day: daySchema,
        itemType: statsTypeSchema,
        itemId: z.string().min(1).max(64),
        listenedSec: z.number().min(0).max(86_400),
        contentSec: z.number().min(0).max(86_400 * 4),
      }),
    )
    .min(1)
    .max(500),
});

export const statsQuerySchema = z.object({
  period: z.enum(["week", "month", "year", "all"]).default("week"),
  /** The listener's today, so periods follow their calendar. */
  today: daySchema,
  /** The listener's offset from UTC in minutes (east positive), for counting books finished. */
  tz: z.coerce.number().int().min(-14 * 60).max(14 * 60).default(0),
});

export const subscribeSchema = z.object({
  feedUrl: z.url({ protocol: /^https?$/ }).trim().max(2000),
});
export type SubscribeInput = z.input<typeof subscribeSchema>;

export const podcastSettingsSchema = z.object({
  /** Your own playback speed for the show. */
  speed: speedSchema.optional(),
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
/** Replaces the music folder list (admin). An empty list turns music off. */
export const musicFoldersSchema = z.object({
  paths: z.array(folderPathSchema).max(20),
});
export const albumSortSchema = z.enum(["added", "name", "artist", "year"]).catch("added");
/** Match for a movie or show: the TMDB title picked. */
export const watchMatchSchema = z.object({ tmdbId: z.number().int().positive() });
/** Stream a video remuxed: which audio track, whether its sound is copied or converted, and from where. */
export const watchStreamSchema = z.object({
  track: z.number().int().min(0).max(99),
  audio: z.enum(["copy", "aac"]),
  video: z.enum(["copy", "h264"]),
  quality: z.enum(["full", "light"]).default("full"),
  start: z.number().min(0).max(100 * 3600),
});
/** A made download (`POST /api/watch/videos/:id/download`): the same choices as a stream, from the start. */
export const watchDownloadSchema = z.object({
  track: z.number().int().min(0).max(99).default(0),
  audio: z.enum(["copy", "aac"]),
  video: z.enum(["copy", "h264"]),
  quality: z.enum(["full", "light"]).default("full"),
});
export type WatchDownloadQuery = z.input<typeof watchDownloadSchema>;
/** Lists default to everything, so older apps keep working. */
export const musicScopeSchema = z.enum(["mine", "all"]).catch("all");
/** What you're playing music from: an album, an artist, or a list of songs, in play order. */
/** The whole Up Next list, saved after every change (see up-next.ts). */
export const upNextSchema = z.object({
  items: z
    .array(z.object({ itemType: z.enum(["episode", "track"]), itemId: z.string().min(1).max(64), added: z.boolean() }))
    .max(5000),
  index: z.number().int().min(-1),
  source: z
    .object({ kind: z.enum(["album", "artist", "songs", "playlist"]), refId: z.string().max(64).nullable(), title: z.string().min(1).max(300) })
    .nullable(),
  originalIds: z.array(z.string().min(1).max(64)).max(5000),
  shuffled: z.boolean(),
});
export type UpNextInput = z.infer<typeof upNextSchema>;
export const upNextIndexSchema = z.object({ index: z.number().int().min(-1) });
export const trackPlaySchema = z.object({ trackId: z.string().min(1).max(64) });
export const musicMineSchema = z
  .object({
    trackIds: z.array(z.string().min(1).max(64)).max(5000).optional(),
    albumIds: z.array(z.string().min(1).max(64)).max(1000).optional(),
  })
  .refine((v) => v.trackIds?.length || v.albumIds?.length, "Pick at least one song or album.");
export const albumMatchApplySchema = z.object({
  provider: z.enum(["musicbrainz", "deezer", "itunes"]),
  providerId: z.string().min(1).max(64),
  fields: z.array(z.enum(["cover", "title", "year", "genre", "tracks"])).min(1),
});export type AlbumMatchApplyInput = z.input<typeof albumMatchApplySchema>;
export const albumMatchAllStartSchema = z.object({ fields: z.array(z.enum(["cover", "title", "year", "genre"])).min(1) });
export const albumMatchAllUndoSchema = z.object({ albumId: z.string().min(1).max(64) });
export const albumMatchAllApplySchema = z.object({ albumIds: z.array(z.string().min(1).max(64)).min(1).max(5000) });
const playlistNameSchema = z.string().trim().min(1, "Give the playlist a name.").max(200);
const trackIdsSchema = z.array(z.string().min(1).max(64)).max(5000);
/** A new playlist, optionally with its first songs. */
export const playlistCreateSchema = z.object({ name: playlistNameSchema, trackIds: trackIdsSchema.default([]) });
/** Rename, or replace the songs in their new order (reorder and remove are both this). */
export const playlistUpdateSchema = z.object({ name: playlistNameSchema.optional(), trackIds: trackIdsSchema.optional() });
/** Songs to add to the end of a playlist; ones already in it stay where they are. */
export const playlistAddSchema = z.object({ trackIds: trackIdsSchema.min(1) });
/** A photo picked from the options, or null for the newest album's cover. */
export const artistPhotoSchema = z.object({ providerId: z.string().min(1).max(64).nullable() });

export const folderCheckSchema = z.object({
  path: folderPathSchema,
  /** The other folders in the list, to catch overlaps before saving. */
  others: z.array(folderPathSchema).max(20).default([]),
});

/** Up Next holds episodes and songs; books line up on the Play next shelf instead. */
export const queueRefSchema = z.object({
  itemType: z.enum(["episode", "track"]),
  itemId: z.string().min(1).max(64),
});
export type QueueRef = z.infer<typeof queueRefSchema>;

/** "next" plays it after the item playing and anything added right after it; "last" appends. */
const addAtSchema = z.enum(["next", "last"]).default("last");

/** One item, or several in order (a whole album or playlist). */
export const queueAddSchema = z.union([
  queueRefSchema.extend({ at: addAtSchema }),
  z.object({ items: z.array(queueRefSchema).min(1).max(2000), at: addAtSchema }),
]);
export type QueueAddInput = z.input<typeof queueAddSchema>;

/** The Play next shelf in its new order; books not on it are ignored. */
export const playNextOrderSchema = z.object({ bookIds: z.array(z.string().min(1).max(64)).max(1000) });

export const archiveSchema = z.object({ archived: z.boolean() });

/** Your own settings, saved on the server so every device shows the same. Send only what changed. */
export const userPrefsSchema = z.object({
  /** The Books tab's sections, top to bottom. */
  bookSections: z
    .array(z.object({ id: z.enum(BOOK_SECTION_IDS), hidden: z.boolean() }))
    .max(BOOK_SECTION_IDS.length * 2),
  /** Optional tabs you've chosen to show. Books, Listening and You are always there; `watch` left out means shown. */
  tabs: z.object({ podcasts: z.boolean(), music: z.boolean().default(true), watch: z.boolean().optional() }),
  /** Music plays shuffled; stays on for the next album or list, like Spotify. */
  shuffle: z.boolean(),
  repeat: z.enum(["off", "all", "one"]),
  /** Converted video: full (up to 1080p) or light (up to 720p, easier on a small server). */
  videoQuality: z.enum(["full", "light"]),
  /** The next episode starts on its own when the countdown ends; off, the card waits for a tap. */
  autoplayNext: z.boolean(),
});
export type UserPrefs = z.infer<typeof userPrefsSchema>;
export const userPrefsPatchSchema = userPrefsSchema.partial();
export type UserPrefsPatch = z.input<typeof userPrefsPatchSchema>;

/** Server-wide settings, admin only. */
export const serverSettingsSchema = z.object({
  /** Newest episodes of each followed show kept on the server; 0 turns prefetching off. */
  episodesPerShow: z.number().int().min(0).max(20),
});
export type ServerSettings = z.infer<typeof serverSettingsSchema>;
export const serverSettingsPatchSchema = serverSettingsSchema.partial();

export const AD_KINDS = ["inserted", "host_read", "promo"] as const;
export type AdKind = (typeof AD_KINDS)[number];

export const adSpanSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  kind: z.enum(AD_KINDS).catch("inserted"),
  advertiser: z.string().max(200).nullable().optional(),
  firstWords: z.string().max(300).nullable().optional(),
});
export type AdSpan = z.infer<typeof adSpanSchema>;

/** What the ad detection add-on sends back about a file it is scanning. */
export const addonReportSchema = z.discriminatedUnion("status", [
  /** Ads so far (the whole list each time) and how many pieces are done; extends the lease. */
  z.object({ status: z.literal("progress"), piecesDone: z.number().int().min(0), ads: z.array(adSpanSchema).max(500) }),
  z.object({ status: z.literal("done"), piecesDone: z.number().int().min(0), ads: z.array(adSpanSchema).max(500) }),
  /** Can't finish now (Gemini paused or misconfigured); hand it out again after `retryAfterSec`. */
  z.object({ status: z.literal("deferred"), retryAfterSec: z.number().int().min(0).max(86_400 * 2), reason: z.string().max(500) }),
  z.object({ status: z.literal("failed"), error: z.string().max(500) }),
]);
export type AddonReport = z.infer<typeof addonReportSchema>;

export const addonStatusSchema = z.object({
  version: z.string().max(50),
  state: z.enum(["ok", "paused", "error"]),
  message: z.string().max(500).nullable(),
  geminiRequestsToday: z.number().int().min(0),
  /** Why pieces are going to Vosk instead of Groq right now, and until when (epoch ms) if known. */
  groq: z.object({ problem: z.string().max(300), until: z.number().nullable() }).nullable().optional(),
  /**
   * Sent on the add-on's first report after it starts: scans it was holding belong to the old run,
   * so they go back in the queue at once instead of waiting out their lease.
   */
  started: z.boolean().optional(),
});
export type AddonStatus = z.infer<typeof addonStatusSchema>;

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
  provider: z.enum(["audible", "google", "itunes"]),
  providerId: z.string().min(1).max(64),
  fields: z.array(matchFieldSchema).min(1),
});
export type MatchApplyInput = z.input<typeof matchApplySchema>;

export const bulkMatchStartSchema = z.object({
  fields: z.array(matchFieldSchema).min(1),
});
export type BulkMatchStartInput = z.input<typeof bulkMatchStartSchema>;

export const bulkMatchApplySchema = z.object({ bookIds: z.array(z.string().min(1).max(64)).min(1).max(5000) });
export const bulkMatchUndoSchema = z.object({ bookId: z.string().min(1).max(64) });

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
  /** Metadata was applied through Match, or an admin marked the book as needing none. */
  matched: boolean;
  /** An admin marked the book as matched by hand, so it isn't listed as Not matched. */
  markedMatched: boolean;
  /** The book's place on your Play next shelf, from 0; null when it isn't on it. */
  playNext: number | null;
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
  /** Artwork on the directory's CDN, 600px, for a preview page. */
  artworkUrl: string | null;
  /** The same artwork at 100px, for result rows. */
  thumbUrl: string | null;
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
  /**
   * Set when lists were asked for short notes (`?short=1`) and `description` was cut;
   * fetch `GET /api/episodes/:id` for the full text.
   */
  descriptionCut?: boolean;
  publishedAt: number;
  durationSec: number | null;
  /** The publisher's URL. Play through `episodeUrl`, which relays it through the server. */
  audioUrl: string;
  archived: boolean;
  imageUrl: string | null;
  season: number | null;
  episodeNumber: number | null;
  progress: Pick<ProgressDto, "positionSec" | "finished" | "speed" | "updatedAt"> | null;
  /** The server's copy has been checked for ads (always false with ad detection off). */
  adsChecked?: boolean;
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
  | { itemType: "episode"; itemId: string; episode: EpisodeWithShow }
  | { itemType: "track"; itemId: string; track: TrackDto };

export type MatchProvider = "audible" | "google" | "itunes";

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

/** One field a bulk match result changes, as text for both sides. */
export interface BulkMatchChange {
  field: MatchField;
  from: string | null;
  to: string | null;
  /** Edited by hand, so it's left alone. */
  edited: boolean;
}

/** Where one book stands in a bulk match. */
export type BulkMatchItemStatus = "pending" | "applied" | "review" | "none";

export interface BulkMatchItem {
  bookId: string;
  title: string;
  author: string | null;
  coverHash: string | null;
  coverColor: string | null;
  durationSec: number;
  status: BulkMatchItemStatus;
  /** The best result, for review or as applied. */
  candidate: MatchCandidate | null;
  /** Fields changed when it was applied. */
  applied: MatchField[];
  /** What applying the result changes, field by field, or changed when it was applied. */
  changes: BulkMatchChange[];
  /** Why there's no result, or why applying failed. */
  message: string | null;
}

/** The current or last bulk match. Kept in memory only, until it's cleared or the server restarts. */
export interface BulkMatchDto {
  running: boolean;
  fields: MatchField[];
  total: number;
  done: number;
  /** Title of the book being searched now. */
  current: string | null;
  items: BulkMatchItem[];
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
  /** Every series in the library as shown, for suggestions while typing. */
  knownSeries: KnownSeries[];
}

export interface KnownSeries {
  name: string;
  books: number;
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

/** The running version and, for admins, whether a newer release is out. */
export interface ServerVersionDto {
  version: string;
  /** Built without a release version, as in development. */
  devBuild: boolean;
  /** For admins only: whether GitHub has been asked yet, and any newer release it has. */
  updates: { checked: boolean; update: { latest: string; url: string } | null } | null;
}

/** What `GET /api/health` tells anyone: enough for Docker's check and to recognise a Murmur server. */
export interface HealthProbeDto {
  ok: boolean;
  version: string;
}

/** `GET /api/health` for someone signed in. */
export interface HealthDto extends HealthProbeDto {
  uptimeSec: number;
  database: boolean;
  library: { reachable: boolean; books: number };
  /** ADDON_SECRET is set, so players can offer ad marks and skipping. */
  adDetection: boolean;
  scan: {
    running: boolean;
    lastFinishedAt: number | null;
    lastDurationMs: number | null;
    lastError: string | null;
  };
  watcher: "events" | "polling" | "periodic-only";
  /** Movies and shows: null when no folder is set up. */
  watch: {
    movies: number;
    shows: number;
    /** The video add-on (murmur-video) answers; without it Watch stays empty. */
    addon: boolean;
    /** ffprobe and ffmpeg run in the add-on. */
    ffmpeg: boolean;
    /** What converts video: a GPU encoder (nvenc, qsv, vaapi, amf, videotoolbox) or the CPU. */
    encoder: string;
    /** Settings' Video row, worded by the server so the web and the app say the same. */
    status: VideoStatus;
    scan: { running: boolean; lastFinishedAt: number | null; lastError: string | null };
  } | null;
}

export interface ApiError {
  error: string;
}

/** `GET /api/episodes/:id/ads`. With `enabled` false the server has no ad detection; show nothing. */
export interface EpisodeAdsDto {
  enabled: boolean;
  /** none: not on the server yet, or not scanned. */
  status: "none" | "queued" | "scanning" | "done" | "failed";
  ads: AdSpan[];
}

/** A scan handed to the add-on by `POST /api/addon/ads/next`. */
export interface AddonJob {
  fileId: number;
  episodeId: string;
  /** Relative to the shared cache folder. */
  path: string;
  durationSec: number | null;
  title: string;
  podcastTitle: string;
  piecesDone: number;
}

/** The episode cache and ad detection, for the admin part of Settings. */
export interface EpisodeCacheStatusDto {
  available: boolean;
  /** Why the cache can't be used, when it can't. */
  error: string | null;
  usedBytes: number;
  maxBytes: number;
  episodes: number;
  downloading: number;
  settings: ServerSettings;
  ads: {
    /** ADDON_SECRET is set. */
    enabled: boolean;
    /** Last report from the add-on, if any. */
    addon: (AddonStatus & { seenAt: number }) | null;
    queued: number;
    done: number;
    failed: number;
  };
}

export * from "./ads";
export * from "./api-paths";
export * from "./changes";
export * from "./format";
export * from "./library";
export * from "./music";
export * from "./player";
export * from "./podcasts";
export * from "./proxied";
export * from "./settings";
export * from "./shelves";
export * from "./stats";
export * from "./up-next";
export * from "./video-addon";
export * from "./watch";
