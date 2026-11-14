// Every key the web player (localStorage) and the app (its JSON store) save under, in one place
// so two never collide and a rename reaches both.

export const storageKeys = {
  // ---------- Both ----------
  /** SavedPlace: what was playing, to put back on the next start. */
  nowPlaying: "murmur.nowPlaying",
  /** SkipSettings. */
  skip: "murmur.skip",
  /** AdPrefs. */
  adPrefs: "murmur.ads",
  /** BookSort. */
  librarySort: "murmur.librarySort",
  /** WatchSort. */
  watchSort: "murmur.watchSort",
  /** AlbumSort. */
  albumSort: "murmur.albumSort",
  /** The last few search terms, newest first. */
  recentSearches: "murmur.recentSearches",
  /** BookmarkDto[], and the changes not sent yet. */
  bookmarks: "murmur.bookmarks",
  bookmarkOutbox: "murmur.bookmarkOutbox",
  /** The fields last applied in Match, for books and albums. */
  matchFields: "murmur.matchFields",
  albumMatchFields: "murmur.albumMatchFields",
  /** Listening time gathered and not sent yet. */
  listening: "murmur.listening",
  /** A video's subtitle choice, by show or movie. */
  videoSubtitle: (key: string) => `murmur.videoSubtitle.${key}`,
  /** A video's audio language, by show or movie. */
  videoAudio: (key: string) => `murmur.videoAudio.${key}`,
  /** The version last played of a movie. */
  videoVersion: (movieId: string) => `murmur.videoVersion.${movieId}`,

  // ---------- Web ----------
  volume: "murmur.volume",
  /** SidePanel: whether the wide layout's side panel is open, and on which tab. */
  sidePanel: "murmur.sidePanel",
  /** NextPanel: whether the video player's Next episodes panel is open on wide screens. */
  videoPanel: "murmur.videoPanel",

  // ---------- App ----------
  server: "murmur.server",
  user: "murmur.user",
  token: "murmur.token",
  theme: "murmur.theme",
  haptics: "murmur.haptics",
  adDetection: "murmur.adDetection",
  /** Places and plays not sent yet. */
  progressOutbox: "murmur.progressOutbox",
  playOutbox: "murmur.playOutbox",
  /** What's downloaded to the phone. */
  downloads: "murmur.downloads",
  /** The saved query cache: lists, and the details opened. */
  queryCache: "murmur.queryCache",
  queryDetails: "murmur.queryDetails",
  /** Videos this phone can't play as they are. */
  videoUnplayable: "murmur.videoUnplayable",
} as const;
