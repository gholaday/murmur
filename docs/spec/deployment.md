# Deployment and development

One Docker Compose stack; see `docker-compose.yml` in the repo root and [Getting started](../GETTING_STARTED.md).

## Mounts

| Mount | Purpose | Notes |
| --- | --- | --- |
| `/audiobooks` | The audiobook library | Read-only: Murmur never writes to or renames your files. More book folders are mounted beside it as `/audiobooks-<name>`, and music, movies and shows work the same way (`/music-<name>`) |
| `/music` | Optional music folder | Read-only, like the audiobooks. Leave it out and Music is empty |
| `/data` | SQLite database, cover cache and backups | The only thing to back up |
| `/cache` | Cached podcast episodes | Without it episodes are relayed. Not worth backing up. The ad add-on mounts it read-only |
| `/movies`, `/shows` | Optional movie and show folders | Read-only, mounted at the same paths in Murmur and the video add-on. The add-on has its own `/cache` for stream pieces and downloads being made |

**Images:** a GitHub Actions workflow builds multi-arch images (amd64 and arm64) for Murmur and both add-ons and pushes them to GitHub Container Registry on each `v*` tag, each with a build provenance attestation (as is the APK), so `gh attestation verify` can confirm where a download came from.

**Secrets and privileges:** the example compose file reads keys and `ADDON_SECRET` from `murmur.env` beside it (`murmur.env.example` is the template), so the compose file itself can be shared. Every container drops all Linux capabilities except `CHOWN`, `SETUID` and `SETGID`, which their start-up uses to give their folders to `PUID`:`PGID` before running as that user, with `no-new-privileges` set.

**Remote access:** any reverse proxy or tunnel works; streaming uses normal HTTP range requests. If an auth gateway (such as Cloudflare Access) sits in front of the web UI, the app needs a bypass rule for `/api/*` because it can't complete a browser login.

**Add-ons stay inside:** the proxy or tunnel points at Murmur only. murmur-video has no ports and is only on the `addons` network (`internal: true`), shared with Murmur and nothing else, so neither the tunnel nor the internet can reach it, and it can't reach out. The ad add-on opens no ports and only calls Murmur inside the stack. As an extra layer, both sides answer 404 to anything that came through a proxy, whichever proxy it is (`cameThroughProxy` in `packages/shared`): `x-forwarded-proto: https` (calls inside the stack are plain HTTP, so a proxy took the TLS), or any of `forwarded`, `via`, `x-real-ip`, `true-client-ip`, `x-forwarded-server`, `cdn-loop` and Cloudflare's `cf-*`. Murmur can't go by `x-forwarded-for`, `-host` or `-port`, because Next fills those in itself when they're missing; the video add-on has no Next in front, so it refuses any `x-forwarded-*` too. A proxy that adds none of these over plain HTTP gets past this check, which is why it's only an extra: the secret is what lets an add-on in. The secret only ever goes to `VIDEO_URL` and `MURMUR_URL`, which are set in the compose file, never taken from a request. Docker's health check asks the video add-on's `/health` from inside its own container without the secret; every other request needs it.

**Updates:** change the image tag and redeploy. Database migrations run automatically on startup, and a copy of the database is saved to `/data/backups` before each migration.

## Local development

Run `pnpm install` once, then `pnpm dev` and open http://localhost:3000. `pnpm dev` also runs the video add-on on port 3001 (with `tsx watch`), which needs ffmpeg on the path and `ADDON_SECRET` in `apps/server/.env.local`. `apps/server/.env.development` points the database and covers at the repo's git-ignored `data/` folder, and the book, music, movie and show folders at `data/audiobooks`, `data/music`, `data/videos/movies` and `data/videos/shows` with `LIBRARY_DIR`, `MUSIC_DIR`, `MOVIES_DIR` and `SHOWS_DIR`. These are for development only; in Docker the mount points are the folders. Docker is only used for the production image: on Windows a bind-mounted source folder delivers no file-change events, so hot reload inside a container is unreliable.

---

| [← Podcasts and ad detection](podcasts.md) | [Contents](README.md) | [Non-goals and later ideas →](later.md) |
| :--- | :---: | ---: |
