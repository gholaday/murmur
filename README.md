# Murmur

A self-hosted audiobook and podcast server with a web player and an Android app. It reads your audiobook folders (Audiobookshelf layout: `Author/[Series]/Title/`), keeps listening progress in sync across devices, and follows podcasts by RSS feed.

Your library is mounted read-only. Murmur never changes your files.

## Run with Docker

Images are published to `ghcr.io/<owner>/murmur` for amd64 and arm64. Use the `docker-compose.yml` in this repo (or paste it into a Portainer stack):

```yaml
services:
  murmur:
    image: ghcr.io/<owner>/murmur:0.2.1
    container_name: murmur
    restart: unless-stopped
    ports:
      - "3333:3000"
    environment:
      - TZ=America/Chicago
      - PUID=1000 # owner of the files in /data
      - PGID=1000
    volumes:
      - /path/to/Audiobooks:/audiobooks:ro
      - /path/to/murmur-data:/data
```

Open `http://<host>:3333`. The first account you create becomes the admin, and a library scan starts automatically.

| Mount | Holds |
| --- | --- |
| `/audiobooks` | Your audiobook library (read-only) |
| `/data` | Database, cover cache and backups. Back this folder up |

To read more than one library folder, mount each one into the container and add it in **Settings > Library**.

**Updating:** change the image tag and redeploy. Migrations run on start, and a copy of the database is saved to `/data/backups` first.

**Remote access:** put it behind a reverse proxy or Cloudflare Tunnel. If you use Cloudflare Access, add a bypass rule for `/api/*` so the Android app can sign in.

## Settings

All optional.

| Variable | Default | |
| --- | --- | --- |
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
| `EPISODE_CACHE_DIR` | `/cache` | Where podcast episodes are kept; mount a volume here |
| `EPISODE_CACHE_MAX_GB` | `20` | Space for cached episodes |
| `ADDON_SECRET` | | Turns on ad detection; the same value goes on the `murmur-adscan` add-on (see `addons/adscan`) |

Health check: `GET /api/health`.

## Development

Needs Node 24+ and pnpm.

```bash
pnpm install
pnpm dev
```

Then open http://localhost:3000. In development the database lives in the repo's `data/` folder and the library is `data/audiobooks` (see `apps/server/.env.development`).

```bash
pnpm typecheck
pnpm test
```

| Folder | |
| --- | --- |
| `apps/server` | Next.js server, API and web player |
| `apps/mobile` | Expo Android app |
| `packages/shared` | Types and schemas shared by server and app |
| `docs/SPEC.md` | Full design spec |

**Releasing:** push a tag like `v0.1.0` and GitHub Actions publishes the image.
