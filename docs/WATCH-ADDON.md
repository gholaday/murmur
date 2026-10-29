# Watch: the video add-on

A plan for moving the video server code (ffmpeg, encoders, stream sessions, downloads) out of Murmur into a second container, `murmur-video`, the way ad detection lives in `murmur-adscan`. Written 2026-10-28 against branch `watch`.

## Why

- Murmur's image carries ffmpeg and the VAAPI drivers (about 80 MB) that only Watch uses, and the GPU device and group juggling in the entrypoint. The Dockerfile's own first line, "no ffmpeg", stops being true.
- Converting video is the one thing in Murmur that can eat a whole NAS. In its own container it gets its own `cpus` limit, its own GPU device, and can crash or be restarted without touching playback of anything else.
- The add-on can run on another machine: Murmur on the NAS, `murmur-video` on a mini PC with a GPU, both with the library mounted.
- Without it, Watch stays empty and the scan says why, exactly as it does today without ffmpeg. The rest of Murmur doesn't notice, which is the rule for optional features.

## The line

One rule decides where code lives:

| Needs | Lives in |
| --- | --- |
| ffmpeg or the GPU | the add-on |
| the database or the covers folder | Murmur |
| both (a still: grabbed there, stored here) | one call across the line |

So **TMDB matching stays in Murmur**. `match.ts`, `tmdb.ts` and `match-score.ts` never touch ffmpeg; they read and write `movies`, `shows` and `tmdb_episodes`, cache TMDB's JSON in SQLite, and store posters with sharp beside the book covers, the same shape as Google Books matching for books. Moving it would need a second, report-style API back into Murmur for no gain.

One difference from adscan is forced by the job: adscan pulls work from a queue, but a player can't wait on a queue. The add-on is a small HTTP server and Murmur is its client.

## What moves

Almost all of it, mostly as it is. The ffmpeg code is already behind a few functions.

| Today (`apps/server/src/server/watch/`) | Goes to `addons/video/src/` |
| --- | --- |
| `ffmpeg.ts` (probe, grabFrame, grabStill, TONEMAP) | as-is |
| `codecs.ts` (ffprobe JSON to `ProbedVideo`) | as-is; the `ProbedVideo` type and a zod schema go to `packages/shared`, since Murmur stores the result |
| `encoders.ts` (GPU probe, `h264Args`, `giveUpOn`) | as-is |
| `stream-session.ts` (HLS sessions, idle kill, trimming, pause) | as-is; `userId` becomes an opaque `owner` string |
| `download.ts` (MP4 making) | as-is |
| `env`: `FFMPEG_PATH`, `FFPROBE_PATH`, `WATCH_HW`, `watchCacheDir`, probe concurrency | the add-on's env |
| Dockerfile: `apk add ffmpeg intel-media-driver libva-intel-driver mesa-va-gallium`; the entrypoint's `/dev/dri` group join | the add-on's Dockerfile and entrypoint |

About 1,050 lines move and about 300 are new. Murmur keeps the library walk and name parsing, the database and queries, TMDB matching, art storage (the add-on hands back a JPEG frame exactly as `grabStill` does now, and `storeArt` keeps it), auth, progress, and the routes, which become thin.

## Shape

- **`addons/video`**: a pnpm workspace package `@murmur/video` (add `addons/*` to `pnpm-workspace.yaml`; adscan has no package.json, so pnpm skips it). Plain `node:http`, no Next, bundled with esbuild into one file. Same Alpine base as Murmur plus ffmpeg and the VAAPI drivers. Released as `ghcr.io/<owner>/murmur-video` with Murmur's version, a third job in `release.yml`.
- **Auth**: the same `ADDON_SECRET` as a bearer token, checked the way `requireAddon` does now, on the add-on's side.
- **Files**: the add-on mounts the library folders at the same paths (`/movies`, `/shows`, read-only) and its own `/cache`. Murmur sends absolute paths as it sees them, the rule adscan already imposes for `/cache`. A probe that gets ENOENT becomes a scan problem: "The video add-on can't see this folder; mount it at the same path."
- **Bytes** go player → Murmur → add-on. Murmur pipes the fetch body through (`new Response(res.body, …)`, range and headers passed along). Not the shared-folder trick adscan uses, for two reasons: Murmur then has no contract with the cache folder at all, and the add-on can run on a different machine. Piping a 3 MB piece through Node costs about what reading it from disk costs today.
- **Murmur's client** is one file, `apps/server/src/server/watch/video-addon.ts`: `probe`, `still`, `startStream`, `streamResponse(req, …)`, `endStream`, `startDownload`, `downloadResponse`, `cancelDownload`, `health`. `VIDEO_URL` defaults to `http://murmur-video:3001` in the image and `http://localhost:3001` in dev.

## The add-on's API

Internal, bearer secret. Request and response schemas live in `packages/shared` next to `addonReportSchema`, one definition for both sides.

| | |
| --- | --- |
| `GET /health` | ffmpeg present, encoder in use, tone mapping, open sessions and downloads, version |
| `POST /probe` `{ file }` | `ProbedVideo` |
| `POST /still` `{ file, durationSec, hdr }` | `image/jpeg` |
| `POST /streams` `{ owner, src, start }` | `{ sessionId, start }` |
| `GET /streams/:id/:file` (owner header) | playlist or piece, with the wait / 503 `Retry-After` / 404-when-trimmed rules unchanged |
| `DELETE /streams/:id` | |
| `POST /downloads` `{ owner, src }`, `GET /downloads/:id` (range), `DELETE /downloads/:id` | `VideoDownloadDto` as now |

## Murmur's side

- The scanner swaps `probeVideo` and `grabStill` for the client. Its "ffmpeg isn't installed" problem becomes "the video add-on isn't reachable".
- The stream, streams and download routes keep their auth and `getStreamSource` lookup and forward the rest.
- `/api/health`'s `ffmpeg` and `encoder` fields come from the add-on's health. Settings shows "Video: Working" beside "Ad detection: Working", with the add-on's error when there is one.
- `docker-compose.yml` gains a `murmur-video` service: `devices: /dev/dri`, `cpus`, `ADDON_SECRET`, `WATCH_HW`, the library folders read-only, its own cache folder. The GPU lines leave the Murmur service.
- Root `pnpm dev` runs both (`pnpm -r --parallel dev`; the add-on on `tsx watch`).

## Order

1. Create `addons/video` and move the five files plus the server and auth glue. Build the image.
2. Shared schemas and types.
3. The client in Murmur: rewire scanner, routes and health, delete the moved files, strip ffmpeg from the Dockerfile and entrypoint.
4. Compose, release workflow, docs (SPEC's architecture table and diagram, WATCH.md's Image section, README, Getting started), Settings status.

**Done** (step 8 in [WATCH.md](WATCH.md)). The review's stream fixes were already in `stream-session.ts` when it moved, so they came along. Two things differ from the plan above: the add-on measures a still's brightness with ffmpeg instead of sharp, so it has no native packages, and its port is `VIDEO_PORT` (not `PORT`), so it never picks up Murmur's when the two run side by side. Settings doesn't show a "Video: Working" row yet; `/api/health` reports the add-on.

Diagram: https://claude.ai/artifact/6soU2cNg6Sx7LJUDuZ1C9K

## TMDB attribution

TMDB's API is free for non-commercial use on one condition: the TMDB logo and this notice, in an About or Credits section, with the logo less prominent than Murmur's own branding:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

Nothing in the web, the app or the docs shows it yet. Add it to Settings > About on both, and a sentence in the README. Logos are at https://www.themoviedb.org/about/logos-attribution.

Other free sources were looked at and don't replace TMDB: TVmaze (free, no key, TV only, no movies), OMDb (1,000 requests a day, posters for patrons only), TheTVDB (needs each person to hold a paid subscription), Wikidata (IDs and years, little artwork), Trakt (a tracking service that points at TMDB for images). TVmaze is the only candidate for a no-key path for shows, if the key step ever turns out to be a problem.
