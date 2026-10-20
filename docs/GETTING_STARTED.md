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

## 2. Start the server

Copy [`docker-compose.yml`](../docker-compose.yml) to your server and change the three `/path/to/...` folders:

| Folder | What it's for |
| --- | --- |
| `/path/to/audiobooks` | Your library, mounted read-only |
| `/path/to/murmur/data` | Database, covers and nightly backups. Back this up |
| `/path/to/murmur/cache` | Podcast episodes kept on the server. Safe to lose |

Set `PUID` and `PGID` to your user's ids (run `id` on the server) so the files Murmur writes belong to you. Then:

```bash
docker compose up -d
```

**Using Portainer instead:** go to **Stacks > Add stack**, name it `murmur`, paste the contents of `docker-compose.yml` into the web editor, change the paths, and press **Deploy the stack**. To update later, open the stack, change the image tag (or tick **Re-pull image**), and press **Update the stack**. Portainer shows the container as healthy once Murmur's health check passes.

Open `http://<server>:3333` and create an account. The first account becomes the admin, and a library scan starts right away; a large library takes a few minutes the first time.

Other users can be added in **Settings > Users**. Each has their own progress, podcasts and Up Next.

## 3. Reach it from outside your network

To listen away from home, put Murmur behind a reverse proxy (Caddy, Nginx, Traefik) or a tunnel (Cloudflare Tunnel, Tailscale) that forwards to port 3333, or to `murmur:3000` from a container on the same Docker network.

If you use a login gateway such as Cloudflare Access, add a bypass for `/api/*`. The Android app signs in with its own token and can't complete a browser login.

## 4. Install the Android app

The app isn't on the Play Store; you install the APK directly. To build it yourself (needs Node, pnpm and the Android SDK):

```bash
pnpm install
cd apps/mobile
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

The APK is written to `apps/mobile/android/app/build/outputs/apk/release/`. Copy it to your phone and open it to install (Android asks you to allow installs from that source).

On first launch, enter your server's address (the same one you open in the browser) and sign in.

## 5. Add podcasts

In **Podcasts**, search by name or paste an RSS feed URL. To bring your shows over from another podcast app, use **Import OPML** in the same place.

Feeds are checked every 30 minutes, and the newest 3 episodes of each show are kept on the server so they start instantly. Admins can change the 3 in **Settings > Podcasts**.

## 6. Optional: ad detection

The `murmur-adscan` add-on finds the ads in podcast episodes, so the players can mark them on the seek bar or skip them. It needs a free Gemini API key, and works best with a free Groq key too.

1. Set `ADDON_SECRET` on Murmur to a long random value (`openssl rand -hex 32`).
2. Uncomment the `murmur-adscan` service in `docker-compose.yml`. Give it the same secret, your keys, and the **same** cache folder as Murmur.
3. `docker compose up -d`. Within a minute, Settings shows "Ad detection: Working".

Each device then chooses Off, Show or Auto-skip in its player's Ads button or in Settings. Details, costs and privacy notes are in the [add-on's README](../addons/adscan/README.md).

## Updating

Change the image tag in `docker-compose.yml` (or use `latest`) and run:

```bash
docker compose pull
docker compose up -d
```

In Portainer, use **Update the stack** as described in step 2. Database changes run on start, after a copy of the database is saved to `data/backups`.

## When something's wrong

- **Books are missing:** check that the library folder is mounted and readable inside the container, and look at **Settings > Library**, which shows each folder's status. Network shares that don't report file changes need `WATCH_POLLING=true`.
- **The app can't connect:** open the same address in the phone's browser. If that works, check for a login gateway that needs the `/api/*` bypass.
- **Health check:** `http://<server>:3333/api/health` reports the database, library, scans and version.
- **Logs:** `docker logs murmur` (and `docker logs murmur-adscan` for the add-on).

All settings are listed in the [README](../README.md#settings). How Murmur works inside is in [SPEC.md](SPEC.md).
