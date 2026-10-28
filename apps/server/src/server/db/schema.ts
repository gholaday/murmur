import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  /** Your settings as JSON (UserPrefs), shared by every device you sign in on. */
  prefs: text("prefs").notNull().default("{}"),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the token; the raw token is never stored. */
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["web", "app"] }).notNull(),
    deviceName: text("device_name"),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Folders the scanners read books or music from; set by an admin in Settings. */
export const libraryFolders = sqliteTable("library_folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Absolute path as the server sees it (inside the container when run in Docker). */
  path: text("path").notNull().unique(),
  kind: text("kind", { enum: ["books", "music"] }).notNull().default("books"),
  createdAt: integer("created_at").notNull(),
});

export const books = sqliteTable(
  "books",
  {
    id: text("id").primaryKey(),
    /** The library folder this book was found in; null once that folder is removed. */
    libraryFolderId: integer("library_folder_id").references(() => libraryFolders.id, { onDelete: "set null" }),
    /** Folder relative to its library folder, always with forward slashes. */
    folderPath: text("folder_path").notNull(),
    /** Hash of file names and sizes; used to recognise a book whose folder was moved. */
    contentKey: text("content_key").notNull(),
    /** Hash of names, sizes and modified times of every relevant file; unchanged means no re-probe. */
    scanSignature: text("scan_signature").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    narrator: text("narrator"),
    series: text("series"),
    seriesPosition: real("series_position"),
    description: text("description"),
    year: text("year"),
    asin: text("asin"),
    durationSec: real("duration_sec").notNull().default(0),
    coverHash: text("cover_hash"),
    addedAt: integer("added_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    missingSince: integer("missing_since"),
  },
  (t) => [
    uniqueIndex("books_folder_idx").on(t.libraryFolderId, t.folderPath),
    index("books_content_key_idx").on(t.contentKey),
    index("books_added_idx").on(t.addedAt),
    index("books_author_idx").on(t.author),
    index("books_series_idx").on(t.series),
  ],
);

export const bookFiles = sqliteTable(
  "book_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    /** Relative to the book's library folder, forward slashes. */
    relPath: text("rel_path").notNull(),
    size: integer("size").notNull(),
    mtimeMs: integer("mtime_ms").notNull(),
    durationSec: real("duration_sec").notNull(),
    startSec: real("start_sec").notNull(),
    mimeType: text("mime_type").notNull(),
  },
  (t) => [uniqueIndex("book_files_book_idx").on(t.bookId, t.idx)],
);

export const chapters = sqliteTable(
  "chapters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    title: text("title").notNull(),
    startSec: real("start_sec").notNull(),
    endSec: real("end_sec").notNull(),
  },
  (t) => [uniqueIndex("chapters_book_idx").on(t.bookId, t.idx)],
);

// ---------- Music ----------
// Albums are grouped by their tags, not by folder: album artist plus album title. `name_key`
// and `title_key` are the lower-cased, space-collapsed forms used to match them.

export const artists = sqliteTable(
  "artists",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull().unique(),
    /** For sorting: without a leading "The". */
    sortName: text("sort_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("artists_sort_idx").on(t.sortName)],
);

export const albums = sqliteTable(
  "albums",
  {
    id: text("id").primaryKey(),
    /** The album artist ("Various Artists" for compilations). */
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    titleKey: text("title_key").notNull(),
    year: text("year"),
    genre: text("genre"),
    coverHash: text("cover_hash"),
    addedAt: integer("added_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("albums_artist_title_idx").on(t.artistId, t.titleKey), index("albums_added_idx").on(t.addedAt)],
);

export const tracks = sqliteTable(
  "tracks",
  {
    id: text("id").primaryKey(),
    albumId: text("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    /** The song's own artist, which differs from the album's on compilations and features. */
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    /** Null once its music folder is removed; the next scan then removes the track. */
    folderId: integer("folder_id").references(() => libraryFolders.id, { onDelete: "set null" }),
    /** Relative to the music folder, forward slashes. */
    relPath: text("rel_path").notNull(),
    title: text("title").notNull(),
    discNo: integer("disc_no"),
    trackNo: integer("track_no"),
    durationSec: real("duration_sec").notNull(),
    size: integer("size").notNull(),
    mtimeMs: integer("mtime_ms").notNull(),
    mimeType: text("mime_type").notNull(),
    hasEmbeddedCover: integer("has_embedded_cover", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("added_at").notNull(),
    missingSince: integer("missing_since"),
  },
  (t) => [
    uniqueIndex("tracks_folder_path_idx").on(t.folderId, t.relPath),
    index("tracks_album_idx").on(t.albumId),
    index("tracks_artist_idx").on(t.artistId),
  ],
);

/**
 * The songs each person added to their music. Albums and artists in "your music" are worked
 * out from these: an album is in it when any of its songs is.
 */
export const userTracks = sqliteTable(
  "user_tracks",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.trackId] }), index("user_tracks_track_idx").on(t.trackId)],
);

/** Each person's own playlists. */
export const playlists = sqliteTable(
  "playlists",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("playlists_user_idx").on(t.userId)],
);

/** A playlist's songs in order. A song is in a playlist once; it leaves when its file does, like your music. */
export const playlistTracks = sqliteTable(
  "playlist_tracks",
  {
    playlistId: text("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.playlistId, t.trackId] }), index("playlist_tracks_order_idx").on(t.playlistId, t.position)],
);

/** Song titles and numbers chosen through an album's Match, kept apart from the tags like album_overrides. */
export const trackOverrides = sqliteTable("track_overrides", {
  trackId: text("track_id")
    .primaryKey()
    .references(() => tracks.id, { onDelete: "cascade" }),
  title: text("title"),
  discNo: integer("disc_no"),
  trackNo: integer("track_no"),
});

/** Each person's Up Next: one running list of songs and episodes, with the one playing (see shared up-next.ts). */
export const upNext = sqliteTable("up_next", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** JSON array of { itemType, itemId, added }, played first, then the one playing, then what's next. */
  items: text("items").notNull(),
  /** The item playing; -1 when it isn't in the list (a book). */
  index: integer("idx").notNull(),
  sourceKind: text("source_kind", { enum: ["album", "artist", "songs", "playlist"] }),
  sourceRef: text("source_ref"),
  sourceTitle: text("source_title"),
  /** JSON array of the source's song ids in its own order. */
  originalIds: text("original_ids").notNull(),
  shuffled: integer("shuffled", { mode: "boolean" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Replaced by `up_next`; read once per person to carry their album over, then left alone. */
export const playContext = sqliteTable("play_context", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["album", "artist", "songs", "playlist"] }).notNull(),
  refId: text("ref_id"),
  title: text("title").notNull(),
  /** JSON array of track ids in play order. */
  trackIds: text("track_ids").notNull(),
  /** JSON array of the same ids in the album's or list's own order; null means the play order is it. */
  originalIds: text("original_ids"),
  index: integer("idx").notNull(),
  shuffled: integer("shuffled", { mode: "boolean" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * An album's details chosen through Match, kept apart from the tags so a rescan keeps them.
 * A null column means "use what the files say", as for books.
 */
export const albumOverrides = sqliteTable("album_overrides", {
  albumId: text("album_id")
    .primaryKey()
    .references(() => albums.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerId: text("provider_id").notNull(),
  title: text("title"),
  year: text("year"),
  genre: text("genre"),
  coverHash: text("cover_hash"),
  matchedAt: integer("matched_at").notNull(),
});

/**
 * Artist photos, keyed by the artist's name key so they outlive the artist row (a rescan can
 * drop and recreate it). `source` is "auto" (found by name), "chosen" (picked by an admin; no
 * photo means they chose the album cover) or "none" (looked and found nothing, which is
 * looked up again after a while).
 */
export const artistPhotos = sqliteTable("artist_photos", {
  nameKey: text("name_key").primaryKey(),
  source: text("source", { enum: ["auto", "chosen", "none"] }).notNull(),
  photoHash: text("photo_hash"),
  providerId: text("provider_id"),
  checkedAt: integer("checked_at").notNull(),
});

/** How often each person played each song. No foreign key, so counts outlive a rescan, like progress. */
export const trackPlays = sqliteTable(
  "track_plays",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: text("track_id").notNull(),
    count: integer("count").notNull(),
    lastPlayedAt: integer("last_played_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.trackId] })],
);

/** One row per feed, shared by every user subscribed to it. */
export const podcasts = sqliteTable("podcasts", {
  id: text("id").primaryKey(),
  feedUrl: text("feed_url").notNull().unique(),
  title: text("title").notNull(),
  author: text("author"),
  description: text("description"),
  link: text("link"),
  imageUrl: text("image_url"),
  coverHash: text("cover_hash"),
  etag: text("etag"),
  lastModified: text("last_modified"),
  lastCheckedAt: integer("last_checked_at"),
  lastSuccessAt: integer("last_success_at"),
  lastError: text("last_error"),
  failureCount: integer("failure_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    /** Playback speed this user prefers for the show. */
    speed: real("speed").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.userId, t.podcastId] })],
);

export const episodes = sqliteTable(
  "episodes",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    guid: text("guid").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    publishedAt: integer("published_at").notNull(),
    durationSec: real("duration_sec"),
    audioUrl: text("audio_url").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    imageUrl: text("image_url"),
    season: integer("season"),
    episodeNumber: integer("episode_number"),
    firstSeenAt: integer("first_seen_at").notNull(),
  },
  (t) => [
    uniqueIndex("episodes_podcast_guid_idx").on(t.podcastId, t.guid),
    index("episodes_podcast_published_idx").on(t.podcastId, t.publishedAt),
  ],
);

/**
 * Listening progress. Deliberately has no foreign key to books or episodes:
 * if a book disappears and comes back, the listener's place comes back with it.
 */
export const progress = sqliteTable(
  "progress",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemType: text("item_type", { enum: ["book", "episode"] }).notNull(),
    itemId: text("item_id").notNull(),
    positionSec: real("position_sec").notNull(),
    durationSec: real("duration_sec").notNull(),
    finished: integer("finished", { mode: "boolean" }).notNull().default(false),
    speed: real("speed").notNull().default(1),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.itemType, t.itemId] }),
    index("progress_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);

/** Each user's Play next shelf: books lined up to start, in their order. */
export const playNext = sqliteTable(
  "play_next",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bookId: text("book_id").notNull(),
    position: integer("position").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bookId] })],
);

/** Replaced by `up_next`; read once per person to carry their queue over, then left alone. */
export const queueItems = sqliteTable(
  "queue_items",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemType: text("item_type", { enum: ["episode", "track"] }).notNull(),
    itemId: text("item_id").notNull(),
    position: integer("position").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemType, t.itemId] }), index("queue_user_pos_idx").on(t.userId, t.position)],
);

/**
 * Listening time per calendar day (the listener's own), item and device. Each device sends its
 * running totals and the larger value is kept, so a resent report never counts twice. Like
 * `progress`, no foreign key to books or episodes, so stats outlive a removed book.
 */
export const listeningDays = sqliteTable(
  "listening_days",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    day: text("day").notNull(),
    itemType: text("item_type", { enum: ["book", "episode", "track"] }).notNull(),
    itemId: text("item_id").notNull(),
    listenedSec: real("listened_sec").notNull(),
    contentSec: real("content_sec").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.clientId, t.day, t.itemType, t.itemId] }),
    index("listening_days_user_day_idx").on(t.userId, t.day),
  ],
);

export const episodeArchives = sqliteTable(
  "episode_archives",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    archivedAt: integer("archived_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.episodeId] })],
);

/**
 * Metadata chosen through Match or edited by an admin. Stored apart from the scanned values
 * so a rescan never undoes it; a null column means "use what the files say".
 */
export const bookOverrides = sqliteTable("book_overrides", {
  bookId: text("book_id")
    .primaryKey()
    .references(() => books.id, { onDelete: "cascade" }),
  /** Set once a match was applied; null when only edited by hand. */
  provider: text("provider"),
  providerId: text("provider_id"),
  title: text("title"),
  author: text("author"),
  narrator: text("narrator"),
  series: text("series"),
  seriesPosition: real("series_position"),
  description: text("description"),
  year: text("year"),
  coverHash: text("cover_hash"),
  /** JSON array of { title, startSec, endSec }. */
  chapters: text("chapters"),
  matchedAt: integer("matched_at"),
  editedAt: integer("edited_at"),
  /** An admin said the book needs no match, so it isn't listed as Not matched. */
  markedMatched: integer("marked_matched", { mode: "boolean" }).notNull().default(false),
});

/** Server-wide settings an admin can change, as JSON values by key. */
export const serverSettings = sqliteTable("server_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * The server's copy of an episode. Dynamically inserted ads differ per download, so one
 * copy is shared by everyone and its ad times belong to this file, not to the episode.
 */
export const episodeFiles = sqliteTable(
  "episode_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    episodeId: text("episode_id")
      .notNull()
      .unique()
      .references(() => episodes.id, { onDelete: "cascade" }),
    /** Relative to the cache folder, forward slashes. */
    relPath: text("rel_path").notNull(),
    mimeType: text("mime_type").notNull(),
    /** Full size once known (from the download's Content-Length or when it finishes). */
    size: integer("size"),
    status: text("status", { enum: ["downloading", "ready", "failed"] }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    readyAt: integer("ready_at"),
    lastPlayedAt: integer("last_played_at"),
  },
  (t) => [index("episode_files_status_idx").on(t.status)],
);

export const episodeAds = sqliteTable(
  "episode_ads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fileId: integer("file_id")
      .notNull()
      .references(() => episodeFiles.id, { onDelete: "cascade" }),
    startSec: real("start_sec").notNull(),
    endSec: real("end_sec").notNull(),
    kind: text("kind").notNull(),
    advertiser: text("advertiser"),
    firstWords: text("first_words"),
  },
  (t) => [index("episode_ads_file_idx").on(t.fileId)],
);

/** Where the ad detection add-on is with each cached file. */
export const adScans = sqliteTable(
  "ad_scans",
  {
    fileId: integer("file_id")
      .primaryKey()
      .references(() => episodeFiles.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["queued", "scanning", "done", "failed"] }).notNull(),
    piecesDone: integer("pieces_done").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    leaseUntil: integer("lease_until"),
    /** A queued scan isn't handed out before this (after a failure or a deferral). */
    notBefore: integer("not_before"),
    /** Last time someone was playing this episode, which moves it to the front. */
    wantedAt: integer("wanted_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("ad_scans_status_idx").on(t.status)],
);

/** Raw provider responses, kept for 30 days so repeat lookups are instant and polite. */
export const providerCache = sqliteTable("provider_cache", {
  url: text("url").primaryKey(),
  body: text("body").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});
