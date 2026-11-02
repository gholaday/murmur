# Android app

The layout follows the familiar podcast-app pattern: bottom tabs, a persistent mini player, and a full-screen player tinted from the cover art. The design system is in [DESIGN.md](../DESIGN.md).

## Screens

| Tab or screen | Contents |
| --- | --- |
| Books | Home shelves, then books by title, author or series, and finished; search and filters |
| Podcasts | Subscribed shows with unplayed counts and new episodes; search or add a show by RSS URL |
| Music | Your albums, artists, songs and playlists, with Browse for the rest |
| You | Downloaded at the top in the app (what's saved on the phone, with its size), then the listening stats card and settings: account, appearance, playback, server, tabs, and admin settings |
| Book, show, album, artist or playlist page | Header with cover and colour band, description, chapters, episodes or songs, download and play buttons |
| Full-screen player | Large cover, chapter or song name, scrubber, speed, sleep timer, skip buttons, chapter list, and a Queue tile with what's still to come that opens the running list (what played, what's playing and what's next; drag to reorder, remove, Clear) |

Books, Podcasts, Music and Watch are turned on and off under You > Tabs, and that alone decides whether they show; Music and Watch start off. You is always there, and with Books off the app opens on the first tab left. A shown tab with no folder set up has an empty state that, for admins, names the folder to mount.

**Look and feel:** dark theme by default with a light option; periwinkle accent (#8E9BFF on dark, #4F5BD5 on light); the player background takes its colour from the cover; large touch targets.

**Playback:** `expo-audio` runs as a media session service so audio keeps playing with the screen off, with lock-screen and notification controls. One player is shared by the whole app; a multi-file book plays file by file on one continuous timeline. Streams use the server's range-request endpoint with the app's token, and downloaded files play from local storage. Limits of `expo-audio` on Android: speed goes up to 2×, and the lock-screen and headset skip buttons always move 10 seconds (the in-app skip buttons use the lengths set in Settings).

**Android Auto:** a pnpm patch to `expo-audio` turns the playback service into a media library service, and the `with-android-auto` config plugin adds the manifest entries. Auto shows Now playing and, while the Music tab shows, Music with Playlists, Albums, Artists and Songs. The app answers those lists from its saved copies, so they work offline. A picked song plays its album, artist or playlist like the app, with previous and next. Cover art reaches Auto as `content://` links from a read-only provider, because it can't open the app's own files or authenticated links. One media session lasts across songs and books, so Auto stays connected.

**Subtitles:** the app draws the line itself over the picture, from the place in the video, so `expo-video` needs no patch. The pick is made in the player or on the movie or show page, and is remembered per movie and per show on the phone. See [Subtitles](watch.md#subtitles).

**Coming back:** the lists refresh when the app returns after five minutes or more, since live changes only cover scans and edits, not progress from another device or new episodes.

**Offline:** lists and the newest opened pages are cached on the phone, so the app opens and downloaded items play without a connection. The mini player comes back from the saved place at once, then moves if the server has a newer one. A downloaded video keeps its subtitles as VTT files beside it; any that weren't ready are fetched the next time it's opened with a connection. Progress and bookmarks are written to a local outbox first and sent to the server when it's reachable.

**First run:** enter the server URL, then username and password; the app stores a token and never asks again until it's revoked.

**Distribution:** an APK installed directly, built with EAS Build or locally with Gradle.

---

| [← Casting](casting.md) | [Contents](README.md) | [Podcasts and ad detection →](podcasts.md) |
| :--- | :---: | ---: |
