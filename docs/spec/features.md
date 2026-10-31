# Features

## Audiobooks

- Library with covers, sorted and filtered by author, series, recently added and progress
- Home shelves: Continue listening, Play next, Next in series, More like, Short listens, Recently added and Not started, each opening a full list. Users can reorder and hide them, saved on the server so web and app match
- More like *book*: unstarted books like the last one you finished that has genres (or at least an author), not on Play next. Short listens: unstarted books under 5 hours with a known length, shortest first, leaving out Play next and Next in series books. Both rules live in `packages/shared` (`shelves.ts`, `similar.ts`), and a shelf whose rule fails shows nothing instead of breaking the tab
- Ranking (`rankSimilar`): book genres are Audible's ladders ("A > B > C"), saved in `book_overrides.genres` when a book is matched on Audible, whatever fields were ticked. Every prefix two or more levels deep is a key, weighted by depth (two levels 1, three 2, and so on) times its rarity in the library (`1 / log(1 + n)`), so deep, rare matches count most and a shared root counts for nothing. Ties go to shared authors, then narrators (comma-split, spaces and dots ignored), then title. Books matched on Audible before genres were kept are filled once each after a scan, a second apart; '[]' marks one fetched with none. Audible names genres in each store's language, so books matched on different regions don't match each other
- Play next: books you haven't started, added from a book's menu and dragged into order in the full list (`play_next`, per person). A book leaves it once it's started, since it's in Continue listening from then on. A book on Play next isn't repeated in Next in series or Not started. Books never go in Up Next, and when a book ends, playback stops
- Book page: cover, author, narrator, series and position, description, duration, chapter list
- Single-file `.m4b` and multi-file books, played as one continuous timeline
- Automatic rescan when files are added, moved or removed
- One or more library folders, set up in the compose file only: `/audiobooks`, and any mounted beside it as `/audiobooks-<name>`, picked up on every start. You > Library lists them with their counts
- Mark finished, reset progress
- Metadata Match and editing for admins (see [Metadata](metadata.md))

## Podcasts

- Find podcasts by name (Apple's public podcast search, no API key needed) or paste an RSS feed URL; OPML import and export
- Feeds are checked on a schedule (default every 30 minutes, and once at startup)
- Episodes stream through the server, which keeps the newest episodes of each followed show on disk (see [Podcasts and ad detection](podcasts.md)); the phone can download any episode
- Up Next queue, and played, unplayed and archived states per episode
- Optional ad detection: ads marked on the seek bar, Skip ad, or Auto-skip with Undo

## Music

Optional. More in [Music](music.md).

- Music folders mounted at `/music` (and `/music-<name>`); with none, the Music tab (if you've turned it on) shows an empty state
- Albums, artists and songs from the tags, with covers from the folder or the files
- Your music: each person adds the albums or songs they want, and Browse has the rest
- Play or shuffle an album, an artist's songs, your songs or a playlist, with the next song loaded early so albums play without a gap
- Playlists of your own, and single songs in Up Next
- Download albums or songs to the phone
- Album Match and artist photos for admins

## Watch

Optional. More in [Watch](watch.md).

- Movie and show folders mounted at `/movies` and `/shows` (and `/movies-<name>`, `/shows-<name>`); with none, the Watch tab (if you've turned it on) shows an empty state. A Video row there says whether the video add-on works and what converts video (`watch.status` in `/api/health`, worded by the server for the web and the app)
- TMDB's logo and notice under You > Server while Watch is on, as TMDB's terms ask
- Posters, descriptions and episode names from TMDB when a key is set, matched on their own like Plex, with Match to fix a wrong one
- Edit for admins: title, year, description, and the poster and background (an image, a link, or one of TMDB's). What you save is kept over TMDB, like an .nfo; Remove takes a chosen picture off again, bringing back the files' or TMDB's
- Plays the file as it is when the device can, else streams it through ffmpeg with the sound or the picture converted, on the GPU where there is one
- Quality (1080p or 720p) for converted video, picked per video or as a setting; audio track choice; the next episode with a countdown (Play next episode turns it off)
- Download movies and episodes to the phone

## Listening stats

- On You: time listened and watched this week, month, year or all time against the period before, a chart stacked by books, podcasts, music and Watch, your streak and daily average, a count for each kind, and what you played and watched most. Picking a kind in the legend shows only that kind
- Kinds whose tab is hidden are left out of the stats altogether, the total included
- Podcasts, Music and Watch can each be shown or hidden per person under Tabs (Music and Watch start hidden); a hidden one's tab and its parts of You go away

## Player

- Mini player, expanding to a full-screen player tinted from the cover
- Skip back and forward (configurable, defaults 10 s and 30 s), chapter skip. On an episode without chapters, previous and next (in the player, media keys and the notification) go to the item before or after it in Up Next, and past either end to the episode above or below it in its show's list (`GET /episodes/:id/neighbor`). Previous restarts the episode first once it's more than 3 s in
- Playback speed 0.5× to 3× (2× on Android), remembered per book and per show
- Sleep timer: minutes or end of chapter
- Episode chapters, when the show publishes them: the scrubber splits into one segment per chapter over the whole episode, with the playing chapter's title between the elapsed and remaining times in place of the time left (tap for the list), and dragging (or, on the web, hovering with a mouse) shows the title of the chapter you'd land in there, in the accent colour. A book's bar spans its current chapter instead
- The third player tile is Chapters for books and for episodes with chapters, else Ads when the show is scanned for ads, else none and the other three share the row. The ad setting is also always in the episode's ⋯ menu. Which one is decided when the episode loads, so tiles never change mid-listen
- In an episode's last 3 minutes, a Mark played button on the cover marks it played and closes the player, so a long outro needn't run out (not on episodes under 6 minutes). During an ad it sits above Skip ad, and Skip ad goes once the episode is in its last second
- Volume slider and mute in the web player on desktop, remembered per browser (phones use their own buttons): a row under the audio player's controls, and a speaker that slides a slider out on the video player
- Lock screen, notification, Bluetooth and headphone controls in the app
- Casting books, podcasts, music, movies and shows to a Chromecast from the web (Chrome and Edge) and the app (see [Casting](casting.md))

## Sync and offline

- Listening position saved to the server every few seconds and on pause
- Resume on any device where you left off
- Download books, episodes, music, movies and TV episodes to the phone; offline progress syncs when back online

## Accounts

- Multiple users, each with their own progress, subscriptions, queue, music and playlists
- The first account is the admin, who manages users and library settings
- Login with username and password; the app keeps a long-lived token

---

|   | [Contents](README.md) | [Architecture →](architecture.md) |
| :--- | :---: | ---: |
