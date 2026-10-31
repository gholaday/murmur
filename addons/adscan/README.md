# murmur-adscan

Murmur's optional ad detection add-on. It takes cached podcast episodes from Murmur one at a
time, transcribes them with Groq's hosted Whisper (or Vosk on your server when Groq isn't set up
or its allowance runs out), asks Gemini (as text) where the ads are, and sends the ad times
back. Players then mark ads on the seek bar or skip them.

If this container is stopped or broken, Murmur plays everything as usual, without ad marks.

## Set up

1. Get a Gemini API key at [aistudio.google.com](https://aistudio.google.com). Normal use fits
   the free tier.
2. Optional, recommended: get a Groq API key at [console.groq.com](https://console.groq.com). Its
   free tier transcribes about 2 hours of audio per hour and 8 per day; anything past that uses
   Vosk on your server.
3. In `murmur.env` (copied from `murmur.env.example`), set `ADDON_SECRET` to a long random value
   (the output of `openssl rand -hex 32`; **at least 32 characters**, or the add-on refuses to
   start) and add your keys. Then uncomment the `murmur-adscan` service in `docker-compose.yml`,
   which reads the same file.
4. Mount the **same** host folder at `/cache` on both services (Murmur read-write, the add-on
   read-only). Paths are case-sensitive.
5. Redeploy. Within a minute, the Podcasts section of Settings shows "Ad detection: Working".

**Privacy:** episode audio goes to Groq for transcription, and transcripts go to Google for ad
finding. On free tiers, these providers may use what's sent to improve their products. Without a
Groq key, transcription stays on your server and only text leaves it.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `MURMUR_URL` | `http://murmur:3000` | Murmur inside the stack |
| `ADDON_SECRET` | | Required; the same value as Murmur's, at least 32 characters |
| `GEMINI_API_KEY` | | Required |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` | Follows Google's newest Flash-Lite. Set a fixed model to pin one |
| `GEMINI_RPM` / `GEMINI_TPM` / `GEMINI_RPD` | 10 / 200000 / 400 | Limits the add-on stays under |
| `GROQ_API_KEY` | | Optional. Without it every piece uses Vosk |
| `GROQ_MODEL` | `whisper-large-v3-turbo` | |
| `GROQ_AUDIO_PER_HOUR` / `GROQ_AUDIO_PER_DAY` | 7200 / 28800 | Seconds of audio, Groq's free-tier limits. Raise them on a paid plan |
| `CHUNK_MINUTES` | 30 | Transcript piece length |

Mount Murmur's cache folder read-only at `/cache`, and a folder of its own for the add-on's state at
`/state` (transcripts in progress, so a restart doesn't redo work). It runs as `PUID`:`PGID` (1000
by default), like Murmur, so set the same values.

## When things go wrong

- **Groq down, key refused, or allowance used up:** that piece uses Vosk instead.
- **Gemini busy or briefly down:** retried with backoff.
- **Daily limit reached:** Gemini calls pause until midnight Pacific; transcription carries on.
- **Bad key or retired model:** Settings shows the error; checked again hourly.
- **Murmur down:** the add-on waits and sends its results when Murmur is back.
- **Episodes stay "waiting" and nothing is scanned:** the add-on can't find the files. Check the
  `/cache` mounts point at the same folder; the add-on log and Settings say so too.
- **Restarted mid-scan:** the scan resumes where it stopped.

## Build

```bash
docker build -t murmur-adscan addons/adscan
```

How it works and why it was built this way: [Podcasts and ad detection](../../docs/spec/podcasts.md) in the spec.
