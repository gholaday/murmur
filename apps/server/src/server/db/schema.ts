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
  kind: text("kind", { enum: ["books", "music", "movies", "shows"] }).notNull().default("books"),
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
    /** When matching on its own was tried; null means not yet. */
    matchTriedAt: integer("match_tried_at"),
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
    /** When matching on its own was tried; null means not yet. */
    matchTriedAt: integer("match_tried_at"),
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

/**
 * Plays the app already sent, by the id it gave each one, so a play retried from the outbox
 * counts once. Kept for a month, longer than a phone stays offline.
 */
export const trackPlayIds = sqliteTable(
  "track_play_ids",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playId: text("play_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.playId] }), index("track_play_ids_created_idx").on(t.createdAt)],
);

/**
 * The albums and playlists each person played from, for Jump back in. No foreign key, since
 * refId points at either table; rows for ones that are gone drop out when read.
 */
export const recentSources = sqliteTable(
  "recent_sources",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["album", "playlist"] }).notNull(),
    refId: text("ref_id").notNull(),
    lastPlayedAt: integer("last_played_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.refId] }), index("recent_sources_played_idx").on(t.userId, t.lastPlayedAt)],
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
  /**
   * A private feed (podcasts/private-feed.ts), worked out from its URL and itunes:block on every
   * check. Shown on the show page, and never sent to the ad add-on.
   */
  privateFeed: integer("private_feed", { mode: "boolean" }).notNull().default(false),
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
    /** The feed's Podcasting 2.0 chapters file (`<podcast:chapters>`), fetched when the chapters are first wanted. */
    chaptersUrl: text("chapters_url"),
    /**
     * The chapters once found, as JSON `RawChapter[]` (podcasts/chapters.ts): from the feed, its
     * chapters file or the audio's ID3 tags. `[]` when the episode has none; null until looked up.
     */
    chapters: text("chapters"),
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
    itemType: text("item_type", { enum: ["book", "episode", "video"] }).notNull(),
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
    itemType: text("item_type", { enum: ["book", "episode", "track", "video"] }).notNull(),
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
  /**
   * JSON array of Audible genre ladders ("A > B > C"), for More like. Null until fetched;
   * '[]' once fetched with none, so the backfill doesn't ask again.
   */
  genres: text("genres"),
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

// ---------- Watch ----------
// Movies and shows come from their own folder kinds, so the scanner never guesses which a file
// is. Like music, a file is probed again only when its size or modified time changes.

/** What TMDB matching keeps on a movie or show. Rescans never rewrite these rows, so a match stays. */
const matchColumns = () => ({
  tmdbId: integer("tmdb_id"),
  /** When matching was tried; null means not yet. Tried without a good result leaves tmdbId null. */
  matchedAt: integer("matched_at"),
  /** An .nfo gave the title and description, so a match leaves them alone. */
  detailsLocal: integer("details_local", { mode: "boolean" }).notNull().default(false),
  /** The picture came from TMDB, so another match may replace it; a local one never is. */
  posterTmdb: integer("poster_tmdb", { mode: "boolean" }).notNull().default(false),
  backdropTmdb: integer("backdrop_tmdb", { mode: "boolean" }).notNull().default(false),
  /** An admin chose the picture in Edit; removing it brings back the files' or TMDB's. */
  posterChosen: integer("poster_chosen", { mode: "boolean" }).notNull().default(false),
  backdropChosen: integer("backdrop_chosen", { mode: "boolean" }).notNull().default(false),
});

/** What TMDB says about a matched movie, for its collection and More like. */
const movieTmdbColumns = () => ({
  collectionId: integer("collection_id"),
  collectionName: text("collection_name"),
  /** YYYY-MM-DD, for ordering a collection. */
  releaseDate: text("release_date"),
  /** JSON array of genre names. Null until fetched; '[]' once fetched with none. */
  genres: text("genres"),
});

export const shows = sqliteTable(
  "shows",
  {
    id: text("id").primaryKey(),
    /** Null once its shows folder is removed; the next scan then removes the show. */
    folderId: integer("folder_id").references(() => libraryFolders.id, { onDelete: "set null" }),
    /** The show's folder, relative to the shows folder. */
    relPath: text("rel_path").notNull(),
    title: text("title").notNull(),
    /** For sorting: lower case, without a leading "The". */
    sortTitle: text("sort_title").notNull(),
    year: text("year"),
    description: text("description"),
    posterHash: text("poster_hash"),
    backdropHash: text("backdrop_hash"),
    ...matchColumns(),
    addedAt: integer("added_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("shows_folder_path_idx").on(t.folderId, t.relPath), index("shows_sort_idx").on(t.sortTitle)],
);

/**
 * A movie: its folder, or the file itself when it sits loose at the top. Every video file in a
 * movie's folder is a version of it (a director's cut, a 4K copy), like Plex.
 */
export const movies = sqliteTable(
  "movies",
  {
    id: text("id").primaryKey(),
    folderId: integer("folder_id").references(() => libraryFolders.id, { onDelete: "set null" }),
    /** The movie's folder, or its file when loose, relative to the movies folder. */
    relPath: text("rel_path").notNull(),
    title: text("title").notNull(),
    sortTitle: text("sort_title").notNull(),
    year: text("year"),
    description: text("description"),
    posterHash: text("poster_hash"),
    backdropHash: text("backdrop_hash"),
    ...matchColumns(),
    ...movieTmdbColumns(),
    addedAt: integer("added_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("movies_folder_path_idx").on(t.folderId, t.relPath),
    index("movies_sort_idx").on(t.sortTitle),
    index("movies_collection_idx").on(t.collectionId),
  ],
);

/** One row per video file: a version of a movie, or an episode. */
export const videos = sqliteTable(
  "videos",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["movie", "episode"] }).notNull(),
    folderId: integer("folder_id").references(() => libraryFolders.id, { onDelete: "set null" }),
    /** The file, relative to its movies or shows folder, forward slashes. */
    relPath: text("rel_path").notNull(),
    movieId: text("movie_id").references(() => movies.id, { onDelete: "cascade" }),
    /** A movie version's edition from its file name ("Director's Cut"), to tell versions apart. */
    edition: text("edition"),
    showId: text("show_id").references(() => shows.id, { onDelete: "cascade" }),
    /** Episodes only; 0 is Specials. */
    season: integer("season"),
    episode: integer("episode"),
    title: text("title").notNull(),
    sortTitle: text("sort_title").notNull(),
    year: text("year"),
    description: text("description"),
    durationSec: real("duration_sec").notNull(),
    size: integer("size").notNull(),
    mtimeMs: integer("mtime_ms").notNull(),
    /** ffprobe's format name, like "matroska,webm" or "mov,mp4,m4a,3gp,3g2,mj2". */
    container: text("container").notNull(),
    /** RFC 6381 string (avc1.640028), or ffprobe's codec name when there's no such form. */
    videoCodec: text("video_codec"),
    width: integer("width"),
    height: integer("height"),
    hdr: text("hdr", { enum: ["hdr10", "hlg", "dolby-vision"] }),
    /** JSON array of VideoAudioTrack. */
    audioTracks: text("audio_tracks").notNull().default("[]"),
    /** JSON array of VideoSubtitleTrack, recorded now for the subtitles step. */
    subtitleTracks: text("subtitle_tracks").notNull().default("[]"),
    /** A 16:9 picture: an episode's -thumb image, else a frame from the video. "" once a grab failed. */
    stillHash: text("still_hash"),
    /** The still is the episode's own -thumb picture, which TMDB's never replaces. */
    stillFromFile: integer("still_from_file", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("added_at").notNull(),
    missingSince: integer("missing_since"),
  },
  (t) => [
    uniqueIndex("videos_folder_path_idx").on(t.folderId, t.relPath),
    index("videos_show_idx").on(t.showId, t.season, t.episode),
    index("videos_movie_idx").on(t.movieId),
    index("videos_kind_added_idx").on(t.kind, t.addedAt),
  ],
);

/**
 * TMDB's details for each episode of a matched show, by season and number rather than by file,
 * so a file changing or being replaced keeps them.
 */
export const tmdbEpisodes = sqliteTable(
  "tmdb_episodes",
  {
    showId: text("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    season: integer("season").notNull(),
    episode: integer("episode").notNull(),
    title: text("title"),
    overview: text("overview"),
    airDate: text("air_date"),
    /** Stored like any still; null when TMDB has none or it couldn't be fetched. */
    stillHash: text("still_hash"),
  },
  (t) => [primaryKey({ columns: [t.showId, t.season, t.episode] })],
);

/** Raw provider responses, kept for 30 days so repeat lookups are instant and polite. */
export const providerCache = sqliteTable("provider_cache", {
  url: text("url").primaryKey(),
  body: text("body").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});
