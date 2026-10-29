# Getting started

This guide takes you from nothing to listening on the web and your phone. You need a machine that runs Docker (a home server, NAS or any Linux box) and your audiobooks in a folder it can read.

## 1. Lay out your library

Murmur reads the same folder layout as Audiobookshelf, so an existing library works as it is:

```
Audiobooks/
  Andy Weir/
    Project Hail Mary/
      Project Hail Mary.m4b
  Brandon Sanderson/
    Mistborn/
      Book 1 - The Final Empire/
        01.mp3
        02.mp3
```

- Each book is a folder with its audio files: one `.m4b`, or several `.mp3`, `.m4a`, `.flac`, `.ogg` or `.opus` files.
- `Author/Title` is a book on its own; `Author/Series/Title` puts it in a series. A leading number (`Book 1 - `, `01. `) sets its place in the series.
- `cover.jpg` (or any image) in the folder is used as the cover, otherwise the embedded art.
- Optional `desc.txt` and `reader.txt` add a description and a narrator.

Murmur only reads this folder. It never renames, moves or edits your files.

**Music (optional)** goes in a folder of its own. Albums and artists come from the songs' tags, so any layout works. Untagged songs are read as `Artist/Album/01 - Title.mp3`, with `CD 1` or `Disc 2` folders counted as part of the album above them. A `cover.jpg`, `folder.jpg` or `front.jpg` in the album folder is used as the cover, otherwise the embedded art.

**Movies and TV shows (optional)** go in folders of their own, one for movies and one for shows, laid out the way Plex reads them:

```
Movies/
  Oppenheimer (2023)/
    Oppenheimer (2023).mkv
Shows/
  A Knight of the Seven Kingdoms/
    Season 1/
      A Knight of the Seven Kingdoms - S01E01.mkv
```

A `poster.jpg` or `fanart.jpg` in the folder is used as the picture. Otherwise a free [TMDB](https://www.themoviedb.org/settings/api) key (`TMDB_API_KEY`) fills in posters, descriptions and episode names.

## 2. Start the server

Copy [`docker-compose.yml`](../docker-compose.yml) to your server and change the `/path/to/...` folders:

| Folder | What it's for |
| --- | --- |
| `/path/to/audiobooks` | Your library, mounted read-only |
| `/path/to/music` | Optional: your music, mounted read-only. Uncomment it to turn on the Music tab |
| `/path/to/movies`, `/path/to/shows` | Optional: your movies and shows, mounted read-only. Uncomment them to turn on the Watch tab |
| `/path/to/murmur/data` | Database, covers and nightly backups. Back this up |
| `/path/to/murmur/cache` | Podcast episodes kept on the server. Safe to lose |

Set `PUID` and `PGID` to your user's ids (run `id` on the server) so the files Murmur writes belong to you. Then:

```bash
docker compose up -d
```

**Using Portainer instead:** go to **Stacks > Add stack**, name it `murmur`, paste the contents of `docker-compose.yml` into the web editor, change the paths, and press **Deploy the stack**. To update later, open the stack, change the image tag (or tick **Re-pull image**), and press **Update the stack**. Portainer shows the container as healthy once Murmur's health check passes.

Open `http://<server>:3333` and create an account. The first account becomes the admin, and a library scan starts right away; a large library takes a few minutes the first time.

Other users can be added in **You > Users**. Each has their own progress, podcasts, music and Up Next.

## 3. Reach it from outside your network

To listen away from home, put Murmur behind a reverse proxy (Caddy, Nginx, Traefik) or a tunnel (Cloudflare Tunnel, Tailscale) that forwards to port 3333, or to `murmur:3000` from a container on the same Docker network.

If you use a login gateway such as Cloudflare Access, add a bypass for `/api/*`. The Android app signs in with its own token and can't complete a browser login.

Point the proxy or tunnel at Murmur only, never at an add-on. The add-ons have no ports: murmur-video sits on a private Docker network that only Murmur shares, and the ad add-on only calls out. Murmur also refuses add-on requests that come through any proxy or tunnel, so the add-on secret never has to cross it.

## 4. Put Murmur on your phone

The app isn't on the Play Store. Each [release on GitHub](https://github.com/gholaday/murmur/releases) has the signed Android app attached as `murmur-<version>.apk`.

**With automatic updates (recommended):** install [Obtainium](https://github.com/ImranR98/Obtainium), which installs apps straight from their GitHub releases and keeps them updated.

1. In Obtainium, tap **Add App**.
2. Paste `https://github.com/gholaday/murmur` as the source URL and tap **Add**.
3. Tap **Install**. Android asks you to allow installs from Obtainium the first time.

Obtainium then checks for new releases and offers each update, so the app keeps up with your server.

**Without Obtainium:** download the APK from the latest release on your phone and open it to install (Android asks you to allow installs from your browser). Install newer releases the same way; they update the app in place.

**Building it yourself** (needs Node, pnpm and the Android SDK):

```bash
pnpm install
cd apps/mobile
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

The APK is written to `apps/mobile/android/app/build/outputs/apk/release/`. It's signed with a development key, so Android won't install it over the app from GitHub, or the reverse: uninstall one first, which also removes its downloads and settings.

On first launch, enter your server's address (the same one you open in the browser) and sign in.

**On an iPhone, or without the APK:** add the web player to your home screen. It then opens full screen with its own icon, like an app.

- **iPhone and iPad:** open Murmur in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open Murmur in Chrome, open the **⋮** menu, then **Add to home screen** (or **Install app**).

Chrome only offers a full-screen install when Murmur is served over HTTPS, so set up step 3 first. Over plain HTTP you get a shortcut that opens in a browser tab. The web player needs a connection to the server: offline downloads, and playback controls on the lock screen, come with the Android app.

## 5. Add podcasts

In **Podcasts**, search by name or paste an RSS feed URL. To bring your shows over from another podcast app, use **Import OPML** in the same place.

Feeds are checked every 30 minutes, and the newest 3 episodes of each show are kept on the server so they start instantly. Admins can change the 3 in **You > Podcasts**.

## 6. Optional: ad detection

The `murmur-adscan` add-on finds the ads in podcast episodes, so the players can mark them on the seek bar or skip them. It needs a free Gemini API key, and works best with a free Groq key too.

1. Set `ADDON_SECRET` on Murmur to a long random value (`openssl rand -hex 32`).
2. Uncomment the `murmur-adscan` service in `docker-compose.yml`. Give it the same secret, your keys, and the **same** cache folder as Murmur.
3. `docker compose up -d`. Within a minute, Settings shows "Ad detection: Working".

Each device then chooses Off, Show or Auto-skip in its player's Ads button or in Settings. Details, costs and privacy notes are in the [add-on's README](../addons/adscan/README.md).

## 7. Optional: movies and shows

The `murmur-video` add-on reads your video files and streams them; Murmur keeps the library and the players. Without it, the Watch tab stays empty and everything else works the same.

1. Set `ADDON_SECRET` on Murmur, as in step 6 (one secret serves both add-ons).
2. Uncomment the movie and show folders on Murmur, and the `murmur-video` service in `docker-compose.yml`. Give it the same secret, and the movie and show folders at the **same** paths as Murmur's.
3. `docker compose up -d`. Movies and shows appear once the scan has read them; You > Library shows each folder's status.

Most files play as they are. A file whose picture the device can't play (HEVC in some browsers, for example) is converted while you watch, and a small server's CPU may not keep up. With an Intel or AMD GPU, uncomment the `devices:` lines under `murmur-video` to pass `/dev/dri` in. The add-on finds the GPU on its own, and `/api/health` shows the encoder it picked under `watch.encoder`. If it still can't keep up, pick 720p in **You > Playback** or before pressing Play. The add-on can also run on another machine with a better GPU: mount the folders there at the same paths and point Murmur's `VIDEO_URL` at it. Settings and fixes are in the [add-on's README](../addons/video/README.md).

## Updating

Change the image tag in `docker-compose.yml` (or use `latest`) and run:

```bash
docker compose pull
docker compose up -d
```

In Portainer, use **Update the stack** as described in step 2. Database changes run on start, after a copy of the database is saved to `data/backups`.

## When something's wrong

- **Books are missing:** check that the library folder is mounted and readable inside the container, and look at **You > Library**, which shows each folder's status. Network shares that don't report file changes need `WATCH_POLLING=true`.
- **Watch is empty:** You > Library says when the video add-on can't be reached, or can't see a folder (it needs the same paths as Murmur), and shows each movie and show folder's status.
- **The app can't connect:** open the same address in the phone's browser. If that works, check for a login gateway that needs the `/api/*` bypass.
- **A podcast on your own network won't add:** Murmur refuses feeds, episodes and cover links on private addresses unless `FETCH_ALLOW_PRIVATE=true` is set. Its own address is always refused.
- **Health check:** `http://<server>:3333/api/health` answers `ok` and the version; signed in, it also reports the database, library, scans and add-ons.
- **Logs:** `docker logs murmur` (and `docker logs murmur-adscan` or `docker logs murmur-video` for the add-ons).

All settings are listed in the [README](../README.md#settings). How Murmur works inside is in [SPEC.md](SPEC.md).
