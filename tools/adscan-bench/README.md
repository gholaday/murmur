# Ad detection benchmark

A one-off test for Murmur's planned ad detection add-on. It downloads one podcast episode and
measures, on the machine it runs on:

- how fast each transcription engine handles the first `CLIP_MINUTES`, and how much memory the
  local ones need: Groq's hosted Whisper large-v3-turbo, NVIDIA Parakeet TDT 0.6B (local,
  through sherpa-onnx), and the older Whisper tiny, Whisper base and Vosk small;
- which ads keyword rules find in each transcript;
- if `GEMINI_API_KEY` is set, which ads Gemini finds from a transcript as text (and, if asked,
  from the whole episode's audio), how long it takes and what it costs.

An engine that needs a CPU feature the machine lacks (such as AVX) shows up as "illegal
instruction" in the report instead of stopping the run.

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
| `CLIP_MINUTES` | 10 | How much is transcribed |
| `ENGINES` | `groq,parakeet,gemini-text` | Which to run, from `groq`, `parakeet`, `whisper-tiny`, `whisper-base`, `vosk`, `gemini-text` (a transcript in pieces), `gemini-text-whole` (in one go) and `gemini` (the audio) |
| `TEXT_FROM` | first engine with a transcript | Whose transcript `gemini-text` reads |
| `GROQ_API_KEY` | | Enables Groq. Get one at console.groq.com; the free tier covers about 8 hours of audio a day |
| `GROQ_MODEL` | `whisper-large-v3-turbo` | |
| `CHUNK_MINUTES` | 30 | Piece length for `gemini-text` |
| `CHUNK_OVERLAP_MINUTES` | 2 | How far each piece runs into the next |
| `THREADS` | every core | CPU threads for the local engines |
| `GEMINI_API_KEY` | | Enables Gemini. Get one at aistudio.google.com |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` | Follows Google's newest Flash-Lite, so a retired model never breaks it. Set a fixed model to pin one |
| `GEMINI_PRICE_IN` / `GEMINI_PRICE_OUT` | 0.30 / 2.50 | USD per million tokens, for the cost line |

On Gemini's free tier, Google may use what you send to improve its products.

## Build

```bash
docker build -t murmur-adbench tools/adscan-bench
```

Whisper is built without AVX so it runs on CPUs like the Celeron J4105. Add
`--build-arg WHISPER_AVX=ON` to measure a newer CPU at full speed.
