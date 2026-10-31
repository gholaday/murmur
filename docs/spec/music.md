# Music

Music is optional. It comes from one or more music folders, managed by the admin under You > Library, next to the book folders. The first is whatever is mounted at `/music`, added once something is there, and only once, so a folder the admin removes stays removed. No folder may sit inside another of either kind, so nothing is scanned twice. With no music folder, nothing about music shows anywhere.

## Scanning

- Music is read file by file, not folder by folder, and a file is probed again only when its size or modified time changes. One that can't be read isn't tried again for a day unless it changes (videos too, except when the add-on was down). It has its own watcher and the same missing-file grace period as books.
- Albums are grouped by album artist plus album title. The album artist falls back to the song's artist. A song by someone other than the album artist (a compilation or a feature) is filed under the album and listed on its own artist's page under Appears on.
- **Untagged files:** the folder is the album, its parent folder the artist, and the file name the title. A leading `01 - ` is the track number, and `CD 1` or `Disc 2` folders belong to the album above them.
- **Covers:** `cover.jpg`, `folder.jpg` or `front.jpg` in the album folder, else the first song's embedded picture.
- Older ID3 tags split "AC/DC" on the slash. The parts are joined back when the joined name is the album artist.
- The grouping rules are in `music/parse.ts`, with unit tests.

## Your music

- Music is per person: a list of songs (`user_tracks`), and everyone starts with none. Adding an album adds its songs. Album and artist state is worked out from the songs, so nothing else is stored.
- The Music tab shows Home, then your music as Playlists, Albums, Artists and Songs, opening on Home. Browse, above the chips, has every album, filtered to All, Not added, or New (found in the last 14 days). The UI never mentions the server.
- Home (`GET /music/home`, `musicHome`) has five shelves, each built on its own so one that fails just doesn't show:
  - Jump back in: albums and playlists you played from, newest first.
  - On repeat: the songs you listened to longest over 30 days, from `listening_days`, so every device counts. It shows the top five; picking one queues up to 25. Its songs may come from albums in Jump back in: one shelf is songs, the other albums.
  - More like *album*, about the last album you played (the first album in Jump back in): that artist's other albums, then albums of the same genre by artists not in the next shelf. Albums in Jump back in are left out.
  - More like *artist*: other artists ranked by the genres of their albums, rarer genres counting for more (`rankSimilar`), as round artist cards.
  - New albums: found in the last 14 days, with the add button.
  The two More like shelves cover the whole server, not just your music, so album cards carry the add button. With none of them, Home says to play something.
- Playlists: the New playlist tile comes first in the grid, the size of a playlist cover, and opens the name sheet.
- Jump back in reads `recent_sources` (person, album or playlist, last played). A counted play sends its Up Next source with it (optional, so older apps still count plays); from an artist it records the song's album, and Your songs records nothing. Song plays from before any source was recorded fill in by album. Rows for deleted albums and playlists drop out when read.
- Lists take `scope=mine` or `scope=all`; the server defaults to `all`.
- There's no following of artists, so songs the server gets later aren't added for you.

## Playback

- A song always plays from the start at 1×, keeps no position and is never marked finished. It counts as played after 30 seconds or half its length, whichever is shorter (`track_plays`, kept per person with no foreign key, like progress). The app keeps each counted play in a small outbox of its own and sends it when it can, so plays made offline still reach Jump back in and Stats: each carries an id, so a retry counts once (`track_play_ids`, kept for 30 days), and the time it was played, which the server caps at its own clock and never lets move a song's last play backwards.
- Playing an album, an artist's songs, your songs or a playlist fills Up Next with its songs (see Up Next below) and remembers where they came from and their own order, for Shuffle.
- While that music is playing, its Play button turns into Pause and Resume, like a book's.
- Starting something new from a book's, album's or playlist's Play, an episode's play button or Downloads opens the full player. Pausing and resuming stay on the page, and tapping a song row doesn't open it.
- Shuffle and Repeat work like Spotify's and are kept in your settings (`shuffle`, `repeat` in `users.prefs`), so they stay on between sessions and devices. The player for songs shows Repeat left of Previous and Shuffle right of Next, in the accent colour when on. The round Shuffle beside Play lights up while Shuffle is on; it turns Shuffle on and plays, or just toggles it when on or when that music is already playing.
  - With Shuffle on, Play starts on any song, and tapping a song plays it first and then the rest shuffled.
  - Turning Shuffle on mid-play moves the item playing to the top, with nothing above it, and shuffles all the album's other songs after it, in a new order each time. Songs you added that are still to come and waiting episodes keep their places. Turning it off puts the whole album back in its own order around the song playing: the songs before it go above it and the ones after it are still to come.
  - Repeat goes off, all, one. Repeat one replays a song that ends by itself; pressing Next moves on and switches to Repeat all. Repeat all starts Up Next over from the top.
- Previous restarts the song after 3 seconds. Otherwise it goes back one item in Up Next, and on Repeat all the first goes round to the last.
- Two players take turns: the spare one loads the next song 10 seconds before the end and takes over at once.
- Previous and next step through songs in the player, the media session and the notification. Speed is hidden. Shuffle and Repeat are only in the player, not the app's notification or Android Auto (both read the same media session).
- Song time counts in the listening stats as Music.

## Playlists

- Playlists are each person's own (`playlists`, `playlist_tracks`). A playlist plays as its own context, and its songs can be reordered by dragging, removed, renamed or deleted. `.m3u` files in the music folders are not read.
- A playlist's + button (and Add songs on an empty one) opens Add songs: search your songs, what you played recently (`GET /music/plays`) or Browse, and tap + to add a song to the end or its check to take it out, with Undo. Songs from Browse join the playlist without being added to your music.
- Every song has a menu: Add to Up Next (Remove from Up Next while it's waiting there), Add to playlist, Go to album. An album's menu and a playlist's also have Add to Up Next, which adds all their songs in order.

## Up Next

One running list of songs and episodes, like YouTube Music's (`up_next`, one row per person: the items in order, which one is playing, and where the songs came from). The rules are shared (`packages/shared/src/up-next.ts`).

- What played stays above the item playing and what's next follows it. The sheet opens on the item playing.
- Tapping a row plays it; tapping the one playing pauses and resumes. Any row, played or not, can be dragged to a new place or taken out. Taking out the one playing starts the one after it.
- Starting an album, artist, your songs or a playlist replaces the list with its songs. Starting an episode from its show, or a book, does the same with nothing but that episode. Either way, episodes you added that haven't played yet stay, after the new songs.
- Add to Up Next on a song puts it right after the item playing and anything you added just before; an episode goes at the end. Something already waiting moves instead of doubling up.
- When an item ends, the next one plays. Books are never in the list: one playing sits above it, and when it ends, playback stops.
- Clear empties what's still to come, with Undo.
- Lists from before 0.5 (the album in `play_context` and the queue in `queue_items`) carry over the first time each person opens Up Next.

**Downloads (app):** a whole album or one song. Downloaded has a Music section, and downloaded music plays offline.

## Matching (admins)

The books pattern, for albums: matched on their own after each scan when a result scores 100 (the song count has to agree), "Match metadata…" in an album's menu, and Match all under You > Library > Not matched, with the same dialog, compare table and review screen as books. Matching on its own takes the cover (only when bigger) and fills a missing year or genre.

- **Sources:** MusicBrainz (covers from the Cover Art Archive) and Deezer are searched together. Apple Music is asked only when neither has a result scoring 70 or more. All three are free with no key, and go through the 30-day provider cache. On a tie, MusicBrainz wins, because Deezer and Apple often list a reissue's year. MusicBrainz is held to one request a second, with one retry when it's busy.
- **Scoring** (`music/match-score.ts`, with tests): title 40, artist 35, song count 25. Edition words ("Deluxe", "Remastered") and catalog numbers ("[2156]") are left out. A different song count is never suggested.
- **Fields:** cover (only when bigger), title, year, genre, and song titles and numbers. Songs are offered only in a single album's Match, and only when the result has the same number of songs; they're paired by position. Match all only fills a missing year or genre and never touches songs.
- Values go in `album_overrides` and `track_overrides`, so a rescan keeps them.

## Artist photos

- After each music scan, Deezer is searched by name for album artists with no photo. A match counts only when the names are the same once normalised; with several, the one with the most fans wins. Nothing found is tried again after 30 days.
- Photos are kept in `artist_photos` by name key, so a rescan that recreates the artist keeps them. Without one, the artist shows their newest album's cover.
- "Change photo…" on the artist page (admins) picks another or goes back to the album cover.

**Rejected:** audio fingerprinting (AcoustID needs `fpcalc` in the image and decoding every file), and TheAudioDB and fanart.tv (both need API keys).

---

| [← Metadata](metadata.md) | [Contents](README.md) | [Watch →](watch.md) |
| :--- | :---: | ---: |
