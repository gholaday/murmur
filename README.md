# Murmur

A self-hosted audiobook and podcast server with a web player and an Android app.

Murmur reads your audiobook folders (the Audiobookshelf layout, `Author/[Series]/Title/`), follows podcasts by RSS, and keeps your listening position in sync across devices. It runs as one Docker container, and your library is mounted read-only: Murmur never changes your files.

Murmur is inspired by [Audiobookshelf](https://www.audiobookshelf.org/), and reads the same library layout, so an existing Audiobookshelf library works without moving anything. It aims for a smaller feature set that's simple to run.

- **Audiobooks:** single-file `.m4b` and multi-file books, chapters, series, home shelves, and optional metadata matching from Audible (always confirmed by you).
- **Podcasts:** search or add by RSS URL, OPML import and export, Up Next, and the newest episodes kept on the server.
- **Players:** a web player and an Android app with background playback, offline downloads, speed control and a sleep timer. On an iPhone, the web player can be added to the home screen to open like an app.
- **Multiple users,** each with their own progress, subscriptions and queue.
- **Optional podcast ad skipping:** a separate add-on finds the ads in episodes. Each device then chooses to play them as usual, mark them on the seek bar with a Skip ad button, or skip them automatically with Undo. Set up in [addons/adscan](addons/adscan/README.md).

## Get started

```yaml
services:
  murmur:
    image: ghcr.io/gholaday/murmur:0.2.6
    container_name: murmur
    restart: unless-stopped
    ports:
      - "3333:3000"
    environment:
      - PUID=1000
      - PGID=1000
    volumes:
      - /path/to/audiobooks:/audiobooks:ro
      - /path/to/murmur/data:/data
      - /path/to/murmur/cache:/cache
```

Run `docker compose up -d`, open `http://<host>:3333`, and create the first account, which becomes the admin.

**Android app:** download `murmur-<version>.apk` from the [latest release](https://github.com/gholaday/murmur/releases/latest), or add this repository to [Obtainium](https://github.com/ImranR98/Obtainium) to get updates automatically.

[Getting started](docs/GETTING_STARTED.md) covers the rest: folder layout, remote access, installing the Android app, adding the web player to a phone's home screen, ad detection and updating. The full example stack is [`docker-compose.yml`](docker-compose.yml).

## Settings

All optional.

| Variable | Default | |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` | User and group that own the files in `/data` and `/cache` |
| `TZ` | `UTC` | Time zone, for the nightly backup hour |
| `LIBRARY_DIR` | `/audiobooks` | First library folder; more can be added in Settings |
| `DATA_DIR` | `/data` | Database, covers and backups |
| `AUDIBLE_REGION` | `us` | Store used by Match: `us`, `uk`, `ca`, `au`, `de`, `fr`, `it`, `es`, `in`, `jp` |
| `FEED_CHECK_MINUTES` | `30` | How often each podcast feed is checked; new episodes are downloaded right after |
| `WATCH_POLLING` | `false` | Set `true` for network mounts that don't report file changes |
| `WATCH_DEBOUNCE_SECONDS` | `30` | Wait after the last file change before rescanning |
| `PERIODIC_SCAN_MINUTES` | `360` | Safety-net rescan interval |
| `MISSING_GRACE_DAYS` | `7` | Books whose files disappear are hidden after this long |
| `BACKUP_HOUR` / `BACKUP_KEEP` | `3` / `7` | Nightly database backup hour and how many to keep |
| `PROBE_CONCURRENCY` | `2` | Files read at once during a scan |
| `EPISODE_CACHE_DIR` | `/cache` | Where podcast episodes are kept |
| `EPISODE_CACHE_MAX_GB` | `20` | Space for cached episodes |
| `UPDATE_CHECK` | `true` | Ask GitHub every 6 hours for the newest release, so Settings tells admins when an update is out. `false` turns it off |
| `ADDON_SECRET` | | Turns on ad detection; the same value goes on the `murmur-adscan` add-on ([addons/adscan](addons/adscan/README.md)) |

Health check: `GET /api/health`.

## Development

Needs Node 24+ and pnpm.

```bash
pnpm install
pnpm dev
```

Then open http://localhost:3000. In development the database lives in the repo's git-ignored `data/` folder and the library is `data/audiobooks` (see `apps/server/.env.development`).

```bash
pnpm typecheck
pnpm test
```

| Folder | |
| --- | --- |
| `apps/server` | Next.js server, API and web player |
| `apps/mobile` | Expo Android app |
| `packages/shared` | Types and schemas shared by server and app |
| `addons/adscan` | Optional ad detection add-on (Python) |
| `docs/SPEC.md` | How Murmur works and why |

**Releasing:** push a tag like `v0.3.0` and GitHub Actions publishes the Murmur and add-on images, and attaches the signed Android APK to a GitHub release (the tag sets the app's version). Signing needs the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` repository secrets.

## License

Copyright (C) 2026 Garrett Holaday

Murmur is free software under the [GNU General Public License v3.0](LICENSE): you can use, change and share it, and copies you distribute, changed or not, must stay under the same license with their source available.
