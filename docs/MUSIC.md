# Music plan

Music from a folder on the server, like books. It's optional: with no music folder, nothing about music shows anywhere. The mockup is the "Murmur music" design canvas (https://claude.ai/artifact/2vndPEBMb7HbRHpu4qLpze).

## What it looks like

- **Android tabs:** Books, Podcasts, Music, Listening, You.
  - Books is today's Library, renamed.
  - Listening holds Up Next and Downloaded as two tabs at the top.
  - You holds listening stats, library counts and the settings. Tabs is a settings row like Playback, and it opens a screen with switches for Podcasts and Music.
  - With both switched off, the bar shows three tabs: Books, Listening, You.
- **Music tab:** chips for Albums, Artists and Songs (Playlists comes later), a sort menu, and a grid of album covers. Shuffle and search sit at the top right.
- **Album:** the back arrow on its own row. Then the cover, title, artist (links to the artist), and pills for year, song count and length. Play, Shuffle and Download buttons come next, then the numbered song list with the playing song highlighted.
- **Up Next while an album plays:** "Rest of Currents" shows as one row that opens to show the songs. Your queued books and episodes come after it.

## Decisions to confirm

1. **Web nav (decided).** It's called Listening on the web too, to match the app. The web has no downloads, so it shows Up Next with no Downloaded tab.
2. **Where the tab switches are saved.** I'd save them in your account prefs (`/api/me/prefs`), so they follow you to every device the way the home shelves do.
3. **No resume for songs.** A song always starts from the beginning, plays at 1x whatever the book speed is, and is never marked finished.
4. **Play counts.** I'd count a song as played after 30 seconds or half its length, whichever comes first. Counts drive Most played and could later drive "Most played" sorting.
5. **Gapless (decided).**
   - The next song starts loading a few seconds before the current one ends, in a second player that's ready to go. When the first one ends, the second starts at once.
   - MP3s carry a little encoder silence at each end, so this is worth checking on a live album. If it's audible, trim using the gapless info in the file (the LAME header or iTunes tags), which `music-metadata` can read.

## Phase 1: listening stats (no music yet)

This ships before music, because the You screen needs it and the stats only start counting once it exists.

**Built (server, web player and Android player; no screen shows it yet):**

- Each device adds up its own listening per day and item with `ListeningTracker` in `packages/shared/src/stats.ts`. A tick counts the smaller of the real time that passed and how far playback moved, so seeks and a stalled player add nothing.
- The device sends running totals to `PUT /api/listening` along with progress. The server keeps the larger of what it had and what came in, so a resent report never counts twice.
- `GET /api/stats?period=&today=&tz=` returns the stats. The device sends its own today and time zone, so the server never guesses either.

What follows is the original design.

- New table `listening_days`: `user_id`, `day` (the user's local date, YYYY-MM-DD), `item_type`, `item_id`, `seconds`, with the primary key on all but `seconds`.
- Players already send progress every few seconds. The server adds the real time that passed since the last report (wall time, not position change, so 2x speed counts as time spent listening), capped so a stale report can't add hours.
  - Needs the device's timezone offset on progress reports, so "today" is your today.
  - The Android outbox sends progress late when offline; those reports carry their own timestamps so they land on the right day.
- `GET /api/stats?period=week|month|year|all` returns:
  - the total, plus the change from the last period
  - one bar per day (per month for year and all time)
  - the split between books, podcasts and music
  - streak, finished count, episodes played, and time saved by speed
  - most played: top book, top show and top artist
- Library counts on the same screen come from existing tables.

## Phase 2: nav restructure (Android and web, still no music)

**Built on the web:**
- The tabs are Books, Podcasts, Listening and You. `/listening` and `/you` replace `/up-next` and `/settings`, which redirect.
- You has the stats, Your library counts, the settings, and a Tabs section with a Podcasts switch. On the web the settings are sections, not rows.
- The Podcasts switch is saved as `prefs.tabs`.
- Android is with the Mobile Dev session.

- **Android:**
  - Rename Library to Books.
  - Merge Up Next and Downloads into Listening, with a segmented control at the top.
  - Replace Settings with You: stats at the top, settings rows below, and a new Tabs screen holding the Podcasts switch.
  - The tab bar reads the prefs and hides tabs that are switched off.
- **Web:** rename Library to Books, Up Next to Listening, and Settings to You, and add the stats to You.
- The Music switch appears on the Tabs screen only once the server has a music folder.

## Phase 3: server

**Built:**
- **Folders:** music folders (`library_folders.kind`, `MUSIC_DIR`), with overlap checks against the book folders.
- **Tables:** `artists`, `albums` and `tracks`. `play_context` and `track_plays` wait for playback in phase 4.
- **Scanner:** `music/scanner.ts`. It probes only changed files, has its own watcher, and takes folder covers, else embedded ones.
- **Parse rules:** `music/parse.ts`, with tests.
- **API:** `/api/music`, albums, artists and tracks, album covers, `/api/stream/track/[id]`, plus `/api/music/folders` and `/api/music/scan` for admins.
- **Settings:** web settings show the Music folders, and a Music tab switch once the server has music.
- **Not built yet:** queue and listening support for tracks.

### Folders

- Add `kind` ("books" | "music") to `library_folders`. Settings gets a Music folders list next to the book folders, reusing the same folder checks. The overlap check covers both kinds, so no folder is scanned twice.
- `MUSIC_DIR` seeds the first music folder, like `LIBRARY_DIR`. `docker-compose.yml` gets a commented-out `/music` mount.

### Schema

- **`artists`:** `id`, `name`, `sort_name` (drops a leading "The"), `cover_hash` (taken from the artist's newest album).
- **`albums`:**
  - `id`, `title`, `artist_id` (the album artist), `year`, `genre`, `cover_hash`
  - `track_count`, `duration_sec`
  - `added_at`, `updated_at`, `missing_since`
- **`tracks`:**
  - identity and tags: `id`, `album_id`, `artist_id` (the song's own artist, for compilations), `title`, `disc_no`, `track_no`, `duration_sec`
  - file: `folder_id`, `rel_path`, `size`, `mtime_ms`, `mime_type`, `scan_signature`
  - lifecycle: `added_at`, `missing_since`
- **`track_plays`:** `user_id`, `track_id`, `count`, `last_played_at`, kept per user.
- `queue_items.item_type` gains "track", for songs queued one by one.
- New table `play_context`, one row per user: `kind` (album, artist, songs or shuffle), `ref_id`, a JSON array of track ids in play order, and `index`. This is what "Rest of Currents" reads from.

### Scanning

- Music is scanned file by file, not folder by folder. Albums are grouped by tags: album artist plus album title, or the artist when there's no album artist.
  - **Files with no tags:** the folder name becomes the album and the parent folder becomes the artist. The file name becomes the title, with a leading "01 - " read as the track number.
- A file is probed only when its size or modified time changed. This reuses `probeFile`, the probe limiter and the network-mount-safe reader.
- **Covers:**
  1. `cover.jpg`, `folder.jpg` or `front.jpg` in the album folder (same rules as books)
  2. else the first track's embedded picture
  3. else none
  - Stored with the existing cover store.
- The watcher covers music folders too. Missing files get the same grace period as books before removal. Play counts survive, because `track_plays` has no foreign key, the same as `progress`.
- Unit tests only for the grouping and untagged-file rules (the parse step), like `parse.test.ts`.

### API

| Route | What it does |
| --- | --- |
| `GET /api/music/summary` | Album, artist and song counts. Also says whether music exists, which tells the apps whether to offer the Music tab. |
| `GET /api/music/albums?sort=added\|name\|artist\|year&cursor=` | Album grid, paged. |
| `GET /api/music/albums/[id]` | Album with its tracks. |
| `GET /api/music/albums/[id]/cover?size=` | Cover, same caching as book covers. |
| `GET /api/music/artists`, `GET /api/music/artists/[id]` | Artists, and one artist's albums plus a Songs list. |
| `GET /api/music/tracks?sort=&q=&cursor=` | Songs list and search. |
| `GET /api/stream/track/[id]` | Range-request streaming, reusing `stream.ts`. |
| `PUT /api/play-context` | Set the current album, artist or shuffle, and the position in it. |
| `GET /api/queue` | Also returns the context (current album and the songs left). |
| `POST /api/progress` | For tracks, records a play instead of a position. |

Nothing in this phase needs an admin-only page beyond the folder list.

### Matching and covers

Bought music is usually well tagged with embedded art, so matching mostly fills gaps: missing or small covers, artist photos, years and genres. It works on albums, not single songs, and follows the books pattern: a Match screen per album, and Match all with results to review.

**Providers**

All three below are free with no key, and every answer goes through the existing 30-day provider cache.

| Provider | Gives | Notes |
| --- | --- | --- |
| MusicBrainz, with covers from the Cover Art Archive | Album title and artist as published, first release year, genres, and the full track list with lengths. Front covers up to 1200px. | The most accurate source. One request per second, with our User-Agent. |
| Deezer | Albums with covers up to 1000px, track counts, and artist photos up to 1000px. | Fast, and the only free source of artist photos. |
| iTunes Search | Albums with covers, often 3000px. | Uses the server's region setting. A good fallback for covers. |

**Scoring**

Each candidate gets a score out of 100, the same as for books:

- album title similarity (with "Deluxe Edition", "Remastered" and similar left out)
- album artist similarity
- song count and total length (`durationScore` already exists)
- for MusicBrainz, how well each song's length lines up with yours, which tells editions and remasters apart

**What a match can change**

- Cover. As with books, only a bigger cover replaces the one in the files.
- Year and genre.
- The spelling of the album title and artist.
- Song titles and numbers, only when ticked. This is like chapters for books, and it's off by default.
- Never the files themselves. Changes go in an `album_overrides` table, so a rescan keeps them. A null column means "use what the files say", the same as `book_overrides`.

**Artist photos**

- Searched on Deezer by name. A match counts only when the normalised names are the same; with several, the one with the most fans wins.
- With no match, the newest album's cover is used.
- Each artist page has a Change photo option for when it picks the wrong person.

**Match all**

- Reuses the bulk match run and review screen. The run is generalised to take a kind (books or albums), so both share the server code and the web UI.
- The Music tab gets a Needs attention filter: albums with no cover, or a cover under 500px.

**Rejected**

- Audio fingerprinting (AcoustID). It needs the `fpcalc` program in the image and decoding every file, which is a lot of work for tags you already have.
- TheAudioDB and fanart.tv. Both need API keys, and Deezer covers artist photos.

## Phase 4: web

- Pages:
  - `/music`: albums, artists and songs, with sort and search.
  - `/music/album/[id]`
  - `/music/artist/[id]`
  - These follow the Pocket Casts look and use the same `Cover`, chips and list rows.
- **Player:**
  - `Playable` gains a "track" type.
  - Tracks show the artist as the subtitle, have no chapters or speed control, and use previous and next instead of the 30 second skips.
  - Ending a track moves to the next song in the context, then on to the Up Next queue.
  - Media Session gets previous and next track actions.
- **Up Next:** shows the context as one row that opens up, above the queue.

## Phase 5: Android

- **Screens:** the Music tab, Album, Artist and Songs list, built from the existing components (`Cover`, `PageTitle`, chips, list rows, skeletons).
- **Player:**
  - Same track rules as the web.
  - The island shows title and artist (the marquee already handles long titles), with play/pause, and previous and next in the full player.
  - The lock screen and notification get previous and next track.
  - Loads the next track a little early to keep the gap short.
- **Downloads:**
  - An album download fetches every track. It is one entry in Downloaded ("Album, 13 songs, 118 MB"), removed as a whole.
  - A single song can be downloaded on its own too.
  - Offline playback of a downloaded album works from the saved copy of its details, the same as books.
- **Listening:** the context row in Up Next, and a Music group in Downloaded.

## Later

- Playlists, read from `.m3u` files in the music folders and then made in the app.
- Artist photos from a metadata source.
- Smart mixes such as "most played" and "not played lately".
- Gapless playback.

## Order and who does what

Phases 1 and 2 stand alone and can ship first. The server part of phase 3 is in this session. Phase 5 goes to the Murmur Mobile Dev session once the API is in, and phase 4 can run alongside it. Each phase ends in its own release.
