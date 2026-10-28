# Watch

The plan for movies and TV shows in Murmur. It covers what the first version does, how it fits the server, the web player and the app, and what comes after. Once a step lands, its rules move into [SPEC.md](SPEC.md) and [DESIGN.md](DESIGN.md), and this doc keeps only what's still to come.

Mockup: [Murmur video mockup](https://claude.ai/artifact/8sYB2hgDqaBGVeMjL5YcoW) (the Watch tab, movie and show pages, the can't-play sheet, and the portrait and landscape players).

## Goals

- Play your own movies and shows on the phone and in the browser, with progress synced across devices, like books.
- Files are played as they are where the device can. Otherwise Murmur streams them the way Plex does, converting only what won't play: the container alone (remuxed), the sound, or the picture to H.264 on the server's CPU.
- Watch is optional and fails on its own. With no video folder it doesn't show anywhere, and if ffmpeg is missing or a scan breaks, books, podcasts and music carry on.
- The same small, quiet design as the rest of Murmur: the screens reuse the book and show pages, chips, list rows and sheets.

**Not in the first version:** subtitles, Chromecast and downloads. Each one is its own later step (see Later steps). Android TV is out of scope.

## Library

**Folders.** Two new folder kinds under You > Library, beside books and music: `movies` and `shows`. Keeping them apart, as Plex does, means the scanner never has to guess whether a file is a movie or an episode. `MOVIES_DIR` (`/movies`) and `SHOWS_DIR` (`/shows`) are added on their own once something is mounted there, like `MUSIC_DIR`. They're read-only, and no folder of any kind may sit inside another.

**Layout** (Plex naming):

```
/movies/The Long Field (2019)/The Long Field (2019).mkv
/movies/The Long Field (2019)/poster.jpg            optional
/movies/The Long Field (2019)/fanart.jpg            optional
/movies/The Long Field (2019)/movie.nfo             optional

/shows/Night Ferry (2021)/poster.jpg                optional
/shows/Night Ferry (2021)/Season 02/Night Ferry - S02E04 - The Crossing.mkv
/shows/Night Ferry (2021)/Season 02/Night Ferry - S02E04 - The Crossing-thumb.jpg   optional
```

**Parsing rules** (`watch/parse.ts`, with unit tests):

- A movie is a folder named `Title (Year)`. A loose file named `Title (Year).ext` also counts, at the top or in a folder of loose movies ("Sci-fi"). A folder counts as a movie's own when it has a year, or its files are named after it.
- **Versions:** every video in a movie's folder is a version of that movie (a director's cut, a 4K copy), as in Plex. Each version's edition comes from Plex's `{edition-Director's Cut}` in the file name, else a known edition name ("Despecialized Edition", "Extended Cut", "IMAX"). Versions are listed biggest picture first, and the first is the one Play starts. Progress belongs to the movie, so switching versions keeps your place. Extra files whose names end in `-trailer`, `-sample` or `-behindthescenes`, and anything under `Extras`, `Featurettes` or `Samples`, are skipped.
- A show is a top-level folder in a shows folder. An episode's season and number come from `S02E04` in the file name, else `2x04`, else the `Season 02` folder and a leading `04`. A double episode (`S02E04E05`) is one row with the first number. `Specials` and `Season 00` are season 0, listed last.
- The episode title is whatever follows the `SxxEyy` part, without the show name; with none it's "Episode 4".
- Video files: `.mkv`, `.mp4`, `.m4v`, `.mov`, `.webm`, `.avi`, `.ts`.

**Probing.** Each file is read with `ffprobe -show_format -show_streams -of json`. We keep the length, container, video codec and profile (including 10-bit and HDR), resolution, and each audio track (codec, channels, language, title, default flag). Subtitle tracks are recorded too, for the subtitles step. Like music, a file is probed again only when its size or modified time changes, at `PROBE_CONCURRENCY`, with the same watcher, safety-net rescan and missing-file grace period.

**Local metadata, no network:**

- **Title and year** from the folder name. A Kodi-style `.nfo` beside the file (`movie.nfo`, `tvshow.nfo`, `<episode>.nfo`) overrides them and adds the description, read with `fast-xml-parser`, which we already use.
- **Posters:** `poster.jpg`, `folder.jpg` or `cover.jpg` in the folder, or `<file name>-poster.jpg`. Show seasons can have `season02-poster.jpg`. With no poster, the existing tinted cover with the title stands in.
- **Backdrops:** `fanart.jpg` or `backdrop.jpg`; without one, the header tints from the poster, like books.
- **Episode stills:** `<file name>-thumb.jpg`, else a frame grabbed by ffmpeg at 10% of the episode's length, saved once in `/data/covers`. Movies in Continue watching do the same, so every 16:9 card has a picture.
- Images go through the existing `sharp` cover pipeline (resized copies, cached by file hash).

## Data model

| Table | Holds |
| --- | --- |
| `library_folders` | `kind` gains `movies` and `shows` |
| `movies` | Folder, path (the movie's folder, or its file when loose), title, year, description, poster and backdrop hashes, added date |
| `shows` | The same for a show's folder |
| `videos` | One row per file, a movie version or an episode: `kind`, folder and path, movie id and edition, or show id with season and episode numbers, title, description, length, size and modified time, container, video codec, resolution, HDR, audio and subtitle tracks (JSON), the 16:9 still, added and missing dates |
| `progress` | `item_type` gains `video`, keyed by the movie's id or the episode's: position, finished and speed, the same as books. A video counts as watched past 92%, or once the credits start when chapter marks say where |
| `listening_days` | `item_type` gains `video`, so watch time is recorded the same way. It's kept out of the listening totals and shown as its own stats |
| `users.prefs` | `tabs.watch`, on by default. Remembered audio track per movie and per show (`watchTracks`) |

Watched state for a whole season or show is worked out from its episodes, so nothing else is stored, the same as albums.

## API

| Area | Endpoints |
| --- | --- |
| Library | `GET /watch` (Continue watching, Next episodes, Recently added), `GET /watch/movies`, `GET /watch/movies/:id` (with its versions), `GET /watch/shows`, `GET /watch/shows/:id` (seasons and episodes with progress), `GET /watch/movies/:id/poster` and `/backdrop`, the same for shows, `GET /watch/videos/:id/still` |
| Admin | `GET/PUT /watch/folders` (movies and shows), `POST /watch/scan` |
| State | `POST /videos/:id/watched`, `DELETE /videos/:id/watched`; `POST /shows/:id/seasons/:n/watched` |
| Streaming | `GET /stream/video/:id` (the file as it is, with range requests, through the existing `streamFile`), `POST /videos/:id/remux?audio=N` (starts or finds a remux, returns its status), `GET /stream/video/:id/remux?audio=N` (the remuxed MP4, with range requests) |
| Progress | The existing `PUT /progress`, with `itemType: "video"` |

The video's details list its codecs as RFC 6381 strings (`avc1.640028`, `hvc1.2.4.L150`, `mp4a.40.2`, `ec-3`), which is what the player checks against what the device can play.

## Playback

**Choosing how to play** (shared rules in `packages/shared/src/watch.ts`, with tests):

1. The player checks the codecs and the container. On the web that's `MediaSource.isTypeSupported` and `canPlayType`; on Android, Media3 plays nearly everything, so the app tries the file and only stops on a decode error.
2. The video codec won't play (HEVC on a desktop without hardware support, AV1 on older phones): the picture is converted to H.264 on the server (transcoded) while the sound follows rule 4.
3. Container fine, the chosen audio track plays, and it's the file's default track: stream the file directly.
4. Otherwise stream it remuxed, the way Plex's Direct Stream does: the browser can't read the container (MKV in Safari, AVI or TS anywhere), the sound won't play (Dolby Digital in Chrome and Firefox, DTS, TrueHD), or another audio track was picked (only Safari can switch tracks in a `<video>`). The sound is copied when the browser plays it, and converted to AAC stereo when it doesn't.
5. A file played directly that turns out not to open (MKV is a guess outside Safari) is streamed remuxed instead, without asking.

**Streaming.** Nothing is prepared ahead and nothing big is kept. Each viewing is a stream session:

- `ffmpeg -ss <start> -i file -map 0:v:0 -map 0:a:N -c:v copy|libx264 -c:a copy|aac` writes HLS with fMP4 pieces of about 6 seconds into a temporary folder, with a playlist that grows as it goes (`EVENT`). HEVC is tagged `hvc1` so Safari plays it. `-readrate 3` keeps it about three times faster than real time after a 30-second burst, so it stays ahead of playback without reading the whole film off the disk at once.
- The player opens a master playlist that names the codecs (`CODECS="hvc1.2.4.L120.B0,mp4a.40.2"`), since browsers guess wrong from the pieces alone. Playback starts once the first pieces exist, in a second or two. Safari plays HLS natively; Chrome, Firefox and Edge use hls.js, loaded only on the player. (Chrome says it "maybe" plays HLS itself, and then can't.)
- A copied picture starts on the keyframe at or before the start point (a one-seek ffprobe); a converted one starts exactly there. The player adds that start to the stream's own clock for the time shown and the place saved.
- Seeking inside what's been made is instant. Seeking past it, or back before the start, ends the session and starts a new one at the new point, which takes a second or two, as in Plex.
- Pieces are served only from their session, only to the person who started it. A piece not written yet is waited for, briefly; still not there, it gets a 503 with `Retry-After`, and the player asks again (hls.js retries for up to a minute) rather than starting over. A session nobody has asked anything of for five minutes is stopped and its folder deleted (a paused player asks for the playlist every two minutes to keep its session); each person keeps at most two, and folders left from before a restart are deleted at boot.
- **The folder stays small.** Every few seconds, pieces more than 30 behind the newest one the player has fetched (three minutes) are deleted, and asking for one of those gets a 404, so the player starts a new session there. On Linux and Mac, ffmpeg is also paused once it's 100 pieces ahead of the player and carries on at 50; Windows can't pause a process, and `-readrate` alone keeps it in check there.
- **Slow starts.** A GPU encoder that ends with no pieces is dropped and the stream restarts on the CPU. One that's still running but hasn't written its first piece after a minute is stopped and the stream moves to the CPU without dropping the encoder, since a cold NAS disk can be that slow too.

**Converting the picture** (`apps/server/src/server/watch/encoders.ts`). H.264 High profile level 4.2 with keyframes forced on the piece boundaries, at one of two qualities: **1080p** (full) or **720p** (light, about a third of the work, for a small server). Bigger pictures are scaled down. Your setting (You > Playback > Converted video) is the starting point; like Plex, each viewing can differ: when the picture will be converted on this device, a quality button sits beside Play on the movie and show pages (`?q=` on the player's address), and the player's More sheet has Quality, which starts the stream again from the same spot. The sheet lists just 1080p and 720p. Picks there are for that video only; the "too slow" note's Lower quality link also saves 720p as your setting.

- **Where it runs.** The first conversion probes the GPU encoders with a short test encode, in order: NVENC (NVIDIA), Quick Sync (`h264_qsv`), VAAPI (Intel and AMD on Linux, the usual route on a NAS), AMF (AMD on Windows) and VideoToolbox (Mac); the first that works is used from then on, else `libx264` on the CPU (`veryfast` CRF 22, or `ultrafast` CRF 26 for light). `WATCH_HW` names one or turns them off. The GPU decodes the file too where it can (`-hwaccel`), and the frames stay on it for scaling; a file it can't decode is decoded on the CPU and uploaded. A GPU encoder that passed the probe but stops on a particular file before its first piece is dropped for the rest of the run and the stream restarts on the CPU from the same spot (see Slow starts above). `/api/health` reports the encoder in use.
- **HDR** is tone mapped down to ordinary colour on the CPU with the same zimg chain as the frame grabs (the GPU filters for it are patchy), then handed to whichever encoder is in use.
- **Too slow.** A CPU-only NAS may not keep up with 1080p. When a converted stream has run dry three times the player says "Converting slower than it plays" in the times row, with a Lower quality link that saves the light setting and starts the stream again from the same spot.

**Audio tracks.** With more than one track, an Audio tile sits with speed, pop out and full screen (and an Audio button in the top row sideways). Its sheet lists each track's language, title, codec and channels. The pick is remembered per movie or show, by language, and switching keeps your place.

**The player** (web and app, the audio player's layout):

- **Portrait:** laid out like the audio player, tinted by the poster. The top row has the down arrow, "Playing from Movies" or "Shows", and More (Go to movie or show, Mark as watched, Start from the beginning, Stop watching). The video sits where the cover goes, at 16:9 with rounded corners, nothing over it. Under it: the title (and the show and episode), the scrubber with the time and the time left, then start over, skip back, play, skip forward and next episode, at the audio player's sizes, then the next episodes, scrolling in the space left (no description: the movie and show pages have it), and stuck to the bottom the tiles: speed, audio (with more than one track), pop out (picture in picture) and full screen. This is how it opens on a phone held upright, and on a computer, where it sits in the page's column. Pulling the top row down on a phone minimises it, as does Escape on a computer. It starts playing when you pressed Play to get there; a reloaded or pasted player address shows the first frame and waits. The play button shows a turning ring while the next piece is awaited. On the web, a speaker beside the title (and at the bottom right sideways) slides out a short volume slider on hover; it's the same volume as the audio player's and phones don't get one.
- **Landscape** (a phone on its side, or full screen anywhere): the video fills the screen, the down arrow and title along the top, the same scrubber and buttons along the bottom with speed, volume, audio, picture in picture and full screen at the bottom right, all fading after three seconds of no movement, or when the mouse leaves, and coming back on a tap.
- **Mini player:** leaving the player's page keeps the video playing in the mini player, the picture where the cover goes, with skip back, play and a close button. A tap opens the player again where it is. The next episode doesn't start on its own from there. Double-tap either side skips back 10 or forward 30, using the same skip settings as books. Turning the phone, or the full screen button, switches between the two.
- Speed from 0.5× to 2×, remembered per movie and per show. Picture in picture on both. Media keys and the lock screen show play, pause and the skips.
- When an episode's credits start (or 30 seconds before the end), a card counts down from 10 to the next episode. A tap starts it now; a tap anywhere else cancels it.
- Starting a video stops whatever audio was on: its place is saved and the video takes the mini player. Playing audio later ends the video the same way. Video doesn't go in Up Next.
- Progress is saved every few seconds and on pause, the same as books, so a movie resumes on any device.

**Web:** one `<video>` element kept in the shell by a small video session beside the audio engine, so it plays on between pages. The `/watch/play/[kind]/[id]` route only opens its video in the session; the shell shows the player full screen there and as the mini player everywhere else. On a phone browser, full screen uses the Fullscreen API with `screen.orientation.lock("landscape")` where it's allowed. On wide screens the page sits in the centred column and full screen fills the window.

**App:** `expo-video` (Media3 underneath, like `expo-audio`) on a full-screen route. The player screen unlocks rotation with `expo-screen-orientation`, and the rest of the app stays portrait. Picture in picture uses `expo-video`'s support and needs `supportsPictureInPicture` in the config plugin.

## Screens

These follow the mockup and reuse what's already there.

- **Watch tab:** fifth in the tab bar, after Music, with a play-in-a-square icon. Chips: Home, Movies, Shows, Watched. Home has Continue watching (16:9 stills, about a quarter bigger, with the time left), Next episodes (the next unwatched episode of each show you've started), then Recently added movies and Recently added shows (poster shelves, like the book shelves). Search and filter sit at the top right, as on every tab.
- **Movie page:** the book header with a 2:3 poster and a backdrop tint. Pills for the year, length and resolution. Play, or Resume with the time left, and a round Mark watched. The description, a Version row when there's more than one ("Despecialized Edition 720p"), an Audio row when there's more than one track, and the file's details at the bottom.
- **Show page:** the same header with pills for the year and the number of seasons. Resume with the episode number, then a chip per season, opening on the one you're in. Episode rows: still with the progress line, the title, then "S1 E2" with the length or time left, the accent check once watched. The round button marks the season watched.
- **Can't-play sheet:** what won't play, as pills (the one at fault in `danger`), one plain sentence, and the way out (another audio track, Play without sound, or Close).
- **You:** a Watch section in the stats, with its own total and chart, and Watch under Tabs to hide it.
- Posters are a new card shape (2:3, 8px corners). The rest are existing components.

## Image and dependencies

- `ffmpeg` and `ffprobe` in the runtime image (`apk add ffmpeg`, roughly 80 MB more), with the VAAPI drivers (`intel-media-driver`, `libva-intel-driver`, `mesa-va-gallium`) so an Intel or AMD GPU can convert video once `/dev/dri` is passed in (`devices:` in `docker-compose.yml`); the entrypoint joins the device's group. `FFMPEG_PATH` and `FFPROBE_PATH` point elsewhere when needed.
- **Development on Windows:** install ffmpeg (for example `winget install Gyan.FFmpeg`) or set the two paths. Without them, Watch reports that ffmpeg is missing under You > Library and stays empty. Nothing else is affected.
- App: `expo-video` and `expo-screen-orientation`, pinned to the SDK's versions.
- `/api/health` reports whether ffmpeg is there and the video scan status.

## Steps

Each step ships on its own and leaves the app working.

1. **Library** (done on the `watch` branch): folder kinds, parsing (with tests), ffprobe scanning, the tables and migration, local artwork, frame grabs (black bars trimmed, HDR tone mapped), the library API, and Watch in `/api/health`. Folders are set under You > Library, or with `PUT /api/watch/folders/movies` and `/shows`. In development, `MOVIES_DIR` and `SHOWS_DIR` point at `data/videos/movies` and `data/videos/shows`. Watch stays hidden until step 2.
2. **Web player and screens** (done on the `watch` branch): the tab, movie and show pages, the portrait and landscape player, progress, the can't-play check, Mark watched, the next-episode countdown, and Movie folders, Show folders and the Watch tab switch under You. Posters without art take their tint from a frame of the film.
3. **Match** (done on the `watch` branch): online details from TMDB, automatic like Plex (see Match below), and a Rescan button for admins at the top right of the Watch tab, which spins until the scan and its matching finish. `TMDB_API_KEY` goes in the README's settings table with the rest of Watch's in step 6.
4. **Streaming** (done on the `watch` branch): HLS stream sessions with the picture copied or converted to H.264 and the sound copied or converted to AAC, audio track choice, and seeking that restarts the session. `POST /api/watch/videos/:id/stream` with `{ track, audio: "copy"|"aac", video: "copy"|"h264", start }` starts one and returns `{ sessionId, playlistUrl, start }`; `DELETE /api/watch/streams/:session` ends it, and `/api/watch/streams/:session/:file` serves `master.m3u8`, `index.m3u8`, `init.mp4` and the pieces. A first version prepared whole MP4 files ahead, which took minutes for a long film; it was replaced.
5. **App:** the same screens and player with `expo-video`, rotation and picture in picture. Done by the Mobile Dev session.
6. **Stats and polish** (done on the `watch` branch, web and app):
   - **Watch time on You.** The video players feed the same `ListeningTracker` as audio, as `statsTypeSchema`'s `video` (the audio player's `PlayType` is unchanged), so watching lands in `listening_days`. Watching counts towards the streak. The stats screen was then redesigned for four kinds (see the Stats card in DESIGN): a chart stacked by kind, a legend that picks one, a count per kind and top cards; Watch is pink (`--stat-4`).
   - **Next episode setting.** "Play next episode" (`autoplayNext`) under You > Playback, on by default. Off, the card near the end reads "Next episode" with no countdown, and nothing starts at the end.
   - **Brighter stills.** The frame grab tries a tenth, a quarter and two fifths of the way in, stopping at the first bright enough frame, else keeping the brightest. Stills already grabbed stay until the file changes.
   - **Cleanup.** `getPrepareSource` becomes `getStreamSource`, and the comments left from the old prepare design go.
   - **Docs.** Finished steps move into SPEC and DESIGN; README and Getting started cover Watch folders, `TMDB_API_KEY`, `WATCH_HW` and passing `/dev/dri`.
7. **Downloads** (done on the `watch` branch; app only, as with books):
   - **What's saved.** A file the phone plays as it is downloads as it is, from `/api/stream/video/:id`, byte for byte. Anything else (an MKV with DTS, a picture the phone can't show) is first made into an MP4 on the server, with the stream's encoder and CPU fallback, and then downloaded.
   - **Making it.** `POST /api/watch/videos/:id/download` with `{ track, audio, video, quality }` starts the job, or reports on the one already running for those choices (`VideoDownloadDto`: preparing with progress, ready with its size, or failed). The phone asks every few seconds and shows Preparing. ffmpeg writes to `cache/watch/downloads` with the index at the front (`+faststart`).
   - **Fetching it.** Once ready, `GET /api/watch/downloads/:id` serves it like any file, with a length and range requests, so the phone shows real progress and resumes a cut-off download. `DELETE` cancels a job or removes the file; the phone calls it once it has the file. A finished file is otherwise kept 6 hours after it was last asked for, a job nobody has asked about for 10 minutes is dropped, and the folder is cleared on start.
   - **Why not a pipe.** A first version piped a fragmented MP4 straight into the response with nothing kept. Android's player can't seek in an MP4 written that way (it needs a `sidx` index, which can't be written to a pipe), so downloads played but couldn't skip or resume.
   - **Limits.** One converting job per person at a time; another gets a 429, so the app downloads videos one after another. Copying the picture runs far faster than real time; converting runs at the encoder's speed, so a film on a NAS takes a while.
   - **Quality.** A converted download uses the quality picked on the page (1080p or 720p), else your setting. A copied picture keeps its own.
   - **Audio track.** The track picked for the show or movie, else the default one. One track per download.
   - **Where.** A round Download button beside Play on the movie page, a download icon on each episode row, and Download season in the show's More menu (shown to everyone; Match… stays admin only). Same states as an album: download, progress (tap to cancel), downloaded (tap to remove, asking first). Making the file fills the first 90% of the bar, fetching it the rest. Videos download one at a time; the next waits at 0%.
   - **Downloads screen.** Movies, then a section per show, beside books, episodes and music, with their size.
   - **Offline.** The player plays the saved file when there is one, even online. Video progress and watch time go through the audio engine's outbox, so offline watching syncs later. Offline, the Watch tab, the show page, Resume and the player's next list show only what's downloaded, with the saved details and pictures; the "watch" queries are persisted.
   - **Storage.** The `downloads.ts` index gains `movie` and `show` (a TV episode, keyed `show:<id>`), with a saved copy of their details, poster, backdrop and still; a podcast episode's type is now `podcast`. An interrupted download starts again, as for books. While the server makes a file the row reads "Preparing N%", then "Downloading N%"; a fetch that fails (an expired file) prepares it once more.

## Match

Unlike books and music, Watch matches on its own, the way Plex does: rips rarely carry good details, and a wall of folder names isn't worth looking at. A Match button fixes the ones it gets wrong.

- **Source:** TMDB, with a free API key (the v3 "API Key" from themoviedb.org's API settings) in `TMDB_API_KEY`. Without one, Watch works as before on local files only. `TMDB_LANGUAGE` picks the language (default `en-US`). Answers go through the same 30-day cache as book and album lookups, with the key kept out of it.
- **When:** after each scan, for every movie and show not tried yet. One request at a time. A failed request (TMDB down) leaves it to try on the next scan; no good result marks it tried, so it isn't searched every time.
- **Finding it:** a TMDB id in the folder or file name (`{tmdb-603}`, Plex and Jellyfin's `[tmdbid-603]`) is used as it is. Otherwise the title and year are searched, and the top result is taken only when its title matches closely and its year is within one of the folder's. Without a year, only an exact title match counts. Anything less stays unmatched, ready for Match.
- **What it fills:**
  - Movies and shows: title, year and description, unless an .nfo gave them. A poster and backdrop only where there's no local picture, so your own art always wins.
  - Episodes: title, description and still, for every season you have. Episode details are kept in their own table, keyed by show, season and episode, so a file changing doesn't lose them. A TMDB still replaces a grabbed frame, but not a `-thumb` picture.
- **Match (admins):** Match… in the More menu at the top right of the movie and show pages, as on a book. It opens a sheet with the title and year to search, results with poster, year and the start of the description, and picking one applies it at once, replacing details and pictures that came from TMDB. Your own files' details and pictures are kept.
- **Data:** `movies` and `shows` gain `tmdb_id`, `matched_at` (when it was tried; null means not yet), `details_local` (the .nfo gave the details), and `poster_tmdb` and `backdrop_tmdb` (the picture came from TMDB, so a new match may replace it). New table `tmdb_episodes`: show, season, episode, title, overview, air date and still hash.
- **API:** `GET /api/watch/match?kind=movie|show&q=&year=` searches; `POST /api/watch/movies/:id/match` and `/shows/:id/match` with `{ tmdbId }` apply one. Both admin only.

## Later steps

- **Subtitles:** `.srt` and `.vtt` beside the file, turned into WebVTT on the fly; text subtitles inside the file pulled out once with ffmpeg and cached. Picked in the player's side panel and remembered per show. Image subtitles (PGS, VobSub) need transcoding, so they wait for that.
- **Chromecast:** casting from the web and the app.

## Open questions

- **Seeking in a stream:** a long seek restarts the stream, a second or two. Knowing each file's keyframes (read once at scan time, as Jellyfin does) would allow a full-length playlist up front, so any seek is a plain request for one piece.
- **Dark stills:** a frame a tenth of the way in is sometimes a dark scene. Trying a few frames and keeping the brightest would help.
- **Does watching count towards your streak,** or does Watch keep its own? The plan says it counts, as any time with Murmur does.
- **Dark stills** above are handled in step 6.
