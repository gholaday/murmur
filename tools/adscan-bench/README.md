# Ad detection benchmark

A one-off test for Murmur's planned ad detection add-on. It downloads one podcast episode and
measures, on the machine it runs on:

- how fast Whisper tiny, Whisper base and Vosk small transcribe the first `CLIP_MINUTES`, and
  how much memory each needs;
- which ads keyword rules find in each transcript;
- if `GEMINI_API_KEY` is set, which ads Gemini finds in the whole episode, how long it takes
  and what it costs.

The report prints to the log and is saved to `/out/report.md` with every transcript.

## Run it

Portainer: add a stack from `docker-compose.yml`, set `EPISODE_URL`, deploy, then read the
container's log when it stops.

Command line:

```bash
docker run --rm -e EPISODE_URL="https://..." -v "$PWD/out:/out" ghcr.io/gholaday/murmur-adbench
```

## Settings

| Variable | Default | |
| --- | --- | --- |
| `EPISODE_URL` | | An episode's audio URL (or `EPISODE_FILE`, a mounted file) |
| `CLIP_MINUTES` | 10 | How much the local engines transcribe |
| `ENGINES` | `whisper-tiny,whisper-base,vosk,gemini` | Which to run |
| `THREADS` | every core | CPU threads for the local engines |
| `GEMINI_API_KEY` | | Enables Gemini. Get one at aistudio.google.com |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | |
| `GEMINI_PRICE_IN` / `GEMINI_PRICE_OUT` | 0.30 / 0.40 | USD per million tokens, for the cost line |

On Gemini's free tier, Google may use what you send to improve its products.

## Build

```bash
docker build -t murmur-adbench tools/adscan-bench
```

Whisper is built without AVX so it runs on CPUs like the Celeron J4105. Add
`--build-arg WHISPER_AVX=ON` to measure a newer CPU at full speed.
