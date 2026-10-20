# murmur-adscan

Murmur's optional ad detection add-on. It takes cached podcast episodes from Murmur one at a
time, transcribes them with Groq's hosted Whisper (or Vosk on your server when Groq isn't set up
or its allowance runs out), asks Gemini (as text) where the ads are, and sends the ad times
back. Players then mark ads on the seek bar or skip them.

If this container is stopped or broken, Murmur plays everything as usual, without ad marks.

## Set up

1. Get a Gemini API key at aistudio.google.com. Normal use fits the free tier; on the free tier,
   Google may use what's sent (the transcripts) to improve its products.
2. Optional, recommended: get a Groq API key at console.groq.com. Its free tier transcribes
   about 2 hours of audio per hour and 8 per day; anything past that uses Vosk.
3. In the stack, set `ADDON_SECRET` on Murmur to a long random value, and uncomment the
   `murmur-adscan` service in `docker-compose.yml` with the same secret and your keys.
4. Redeploy. Settings > Podcasts shows "Ad detection: Working" within a minute.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `MURMUR_URL` | `http://murmur:3000` | Murmur inside the stack |
| `ADDON_SECRET` | | Required; the same value as Murmur's |
| `GEMINI_API_KEY` | | Required |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` | Follows Google's newest Flash-Lite. Set a fixed model to pin one |
| `GEMINI_RPM` / `GEMINI_TPM` / `GEMINI_RPD` | 10 / 200000 / 400 | Limits the add-on stays under |
| `GROQ_API_KEY` | | Optional. Without it every piece uses Vosk |
| `GROQ_MODEL` | `whisper-large-v3-turbo` | |
| `GROQ_AUDIO_PER_HOUR` / `GROQ_AUDIO_PER_DAY` | 7200 / 28800 | Seconds of audio, Groq's free-tier limits. Raise them on a paid plan |
| `CHUNK_MINUTES` | 30 | Transcript piece length |

Mount Murmur's cache folder read-only at `/cache`, and a folder for the add-on's own state at
`/state` (transcripts in progress, so a restart doesn't redo work).

## When things go wrong

- **Groq down, key refused, or allowance used up:** that piece uses Vosk instead.
- **Gemini busy or briefly down:** retried with backoff.
- **Daily limit reached:** Gemini calls pause until midnight Pacific; transcription carries on.
- **Bad key or retired model:** Settings shows the error; checked again hourly.
- **Murmur down:** the add-on waits and sends its results when Murmur is back.
