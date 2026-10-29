# murmur-video

Murmur's optional movies and shows add-on. It owns ffmpeg: it reads video files for Murmur's
scan, grabs their stills, and makes the streams and phone downloads, converting the picture on
the GPU where it can. Murmur keeps the library and the players and passes the bytes through.

If this container is stopped or broken, the Watch tab can't play or scan, Settings says why, and
everything else in Murmur works as usual.

## Set up

1. In your stack, set `ADDON_SECRET` on Murmur to a long random value (for example the output of
   `openssl rand -hex 32`). One secret serves both add-ons.
2. Uncomment the movie and show folders on Murmur, and the `murmur-video` service in
   `docker-compose.yml` with the same secret.
3. Mount the movie and show folders at the **same** paths in both containers, read-only. Murmur
   names files by path, so a folder at another path can't be found.
4. Optional: with an Intel or AMD GPU, uncomment `devices: - /dev/dri:/dev/dri`. The add-on
   finds it on its own.
5. Redeploy. You > Library shows "Video: Working" and what converts video.

**Keep it inside:** the service has no `ports:` and is only on the private `addons` network,
which Murmur alone shares. Never add ports, and point a proxy or tunnel at Murmur, not here.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `ADDON_SECRET` | | Required; the same value as Murmur's |
| `WATCH_HW` | `auto` | GPU conversion: `auto` tries NVENC, Quick Sync, VAAPI and the rest, then the CPU; `off` keeps it on the CPU; or name one (`nvenc`, `qsv`, `vaapi`, `amf`, `videotoolbox`) |
| `VAAPI_DEVICE` | `/dev/dri/renderD128` | The render node VAAPI uses |
| `PUID` / `PGID` | `1000` | User and group that own the files in `/cache` |
| `VIDEO_PORT` | `3001` | Murmur's `VIDEO_URL` points here |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Where to find them when not on the path |

Mount a folder at `/cache` for stream pieces and downloads being made. Only a few minutes of
each stream is kept, but a download is a full copy of the film until the phone fetches it (6
hours at most), so give it room.

## When things go wrong

- **Settings says the add-on isn't reachable:** it's stopped, on another network than Murmur, or
  its `ADDON_SECRET` differs from Murmur's.
- **"Can't see this file":** the folders aren't mounted at the same paths as Murmur's.
- **Playback stutters when converting:** the CPU can't keep up. Pass the GPU in, or pick 720p in
  You > Playback.
- **A GPU fails on a file:** that stream or download falls back to the CPU on its own.
- **"Not enough space on the server":** the `/cache` disk can't hold the download; free some up
  or point `/cache` at a bigger disk.
- **Restarted:** streams and downloads in progress are dropped. A download the app is waiting on
  starts over on its own.

## Build

```bash
docker build -t murmur-video -f addons/video/Dockerfile .
```

From the repo root, since it uses `packages/shared`. How it works and why it was built this way:
the Watch section of [docs/SPEC.md](../../docs/SPEC.md).
