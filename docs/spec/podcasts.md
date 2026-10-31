# Podcasts and ad detection

The server keeps recent episodes of every followed show on disk, so everyone streams the same copy. An optional second container finds the ads in those copies, and the players can mark or skip them. Ad detection is decoration: if any part of it is missing or broken, podcasts play exactly as before, just without ad marks.

## Episode cache (part of Murmur)

Dynamically inserted ads differ on every download, so ad times only hold for one copy of the file. The cache makes that one copy the one everyone hears. It is useful without the add-on, since episodes start faster and don't depend on the publisher's server while playing.

- **What gets downloaded.** After each feed check, the newest 3 episodes of every show anyone follows. Admins change the 3 in Settings ("Episodes kept ready per show"; Off turns prefetching off). Downloads are per episode, so a show five people follow is fetched once.
- **What doesn't.** Episodes every follower has finished or archived, and shows nobody follows.
- **One download at a time,** with a 60 s stall timeout and up to 3 tries with backoff. An episode that still fails is streamed by relaying.
- **On demand.** Playing an episode that isn't cached starts its download, and playback reads the growing file. A range that isn't on disk yet waits for the download (which runs far faster than playback) rather than being relayed, because a relayed range could come from a different copy with different ads. If the download fails, the stream falls back to relaying the whole episode, without ad marks.
- **Serving.** `/api/stream/episode/:id` serves the cached copy when there is one. Phone downloads come from the same file, so their ad times match.
- **Storage.** Episodes live in their own mount, `/cache`, kept out of `/data` so backups stay small. `EPISODE_CACHE_MAX_GB` (default 20) caps it.
- **Eviction** when over the cap: never an episode that is in anyone's queue, in progress, or among a show's newest 3. Episodes everyone finished go first, then the least recently played. An episode's ad times are deleted with its file.
- **Failure.** If `/cache` is missing, full or unwritable, Murmur relays streams as before and shows the problem in Settings. `/api/health` reports it without failing, so Docker doesn't restart the container over it.

## Ad detection add-on (optional container)

A second service in the same stack, `murmur-adscan` (source in `addons/adscan`). Without it, Murmur behaves exactly as it does with it switched off.

### How it works

1. **Take the next episode.** The add-on asks Murmur for work (`POST /api/addon/ads/next`) and gets an episode, its file path under `/cache` and its length. The job is leased for 30 minutes. Murmur picks in this order: something being played right now, then episodes in anyone's queue, then prefetched episodes, newest first.
2. **Transcribe.** The cached file is read read-only, 30 minutes at a time. Each piece goes to Groq (hosted Whisper large-v3-turbo, as a 32 kbps mp3). When Groq is not set up, is down, or its audio allowance would mean waiting more than 15 minutes, that piece is transcribed locally by Vosk (small English model) instead. Each piece's transcript is saved to the add-on's own `/state` volume, so a restart or a Gemini outage never redoes finished pieces.
3. **Find the ads.** Each piece goes to Gemini as text (eight-word lines with start and end times) as soon as it is transcribed, running 2 minutes into the next piece so an ad break on a cut is seen whole. Copies of an ad found in two pieces are merged.
4. **Check the answer.** Spans with the end before the start, outside the episode, or longer than 5 minutes are dropped, and spans running past the end are cut to it.
5. **Report.** Spans are posted per piece (`POST /api/addon/ads/:fileId`), so the first marks appear minutes after a scan starts, not after the whole episode.

Each span has a start, an end, a kind (`inserted`, `host_read` or `promo`), the advertiser if named, and its first words.

**Why this approach** (benchmarked on a 70-minute episode with 20 ads)

| Approach | Result | Cost per hour of audio |
| --- | --- | --- |
| Groq Whisper transcript to Gemini Flash-Lite as text | All 20 ads, with clean text (names, advertisers, promo codes) | Free within Groq's allowance, plus about 1 cent of Gemini if paid |
| Vosk transcript to Gemini Flash-Lite as text | All 20 ads, edges within about a second | About 23k tokens, about 1 cent if paid |
| Parakeet TDT 0.6B locally | Transcripts as good as Groq's | Free, but about 1.4 GB of memory |
| Whole audio to Gemini | Missed most ads in one run, invented ads past the end of the episode | About 90k tokens, about 3 cents |
| Keyword rules on a transcript | Missed any ad without a stock phrase | Free |
| Whisper locally on a CPU without AVX | Tiny 0.4x, base 0.2x real time: can't keep up | Free |

Groq transcribes 30 minutes in about 15 to 25 seconds. Its free tier allows about 2 hours of audio per hour and 8 per day; the add-on paces itself under that, so a big backlog spreads over the day, with Vosk covering what doesn't fit. Vosk runs at about 5x real time on a 4-core Celeron (about 12 minutes per hour of audio, about 500 MB of memory). At about 23k tokens per hour, normal use fits Gemini's free tier.

**Settings** (environment variables, add-on only)

| Variable | Default | |
| --- | --- | --- |
| `MURMUR_URL` | `http://murmur:3000` | Murmur inside the stack (its container port) |
| `ADDON_SECRET` | | The same value as Murmur's, at least 32 characters (`ADDON_SECRET_MIN_LENGTH`). On Murmur, this one variable is the on switch: without it there are no add-on endpoints, no scans and no ad settings. A shorter one counts as not set on Murmur, which logs why, and the add-ons refuse to start with it |
| `GEMINI_API_KEY` | | Required. Lives only here, never in Murmur |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` | Google's alias for its newest Flash-Lite, so retirements don't break the add-on. When it moves to a new model, prices and free-tier limits can change with it. Set a fixed model to pin one |
| `GEMINI_RPM` / `GEMINI_TPM` / `GEMINI_RPD` | 10 / 200,000 / 400 | The add-on paces itself under these; defaults sit below the free tier's limits |
| `GROQ_API_KEY` | | Optional, recommended. Without it every piece uses Vosk. Lives only here |
| `GROQ_MODEL` | `whisper-large-v3-turbo` | |
| `GROQ_AUDIO_PER_HOUR` / `GROQ_AUDIO_PER_DAY` | 7,200 / 28,800 | Seconds of audio; Groq's free-tier limits. Raise them on a paid plan |

The example stack gives the add-on a CPU limit, and it scans one episode at a time.

**Failure handling.** Nothing in playback, streaming or the cache ever waits on the add-on.

| Failure | What happens |
| --- | --- |
| Groq down, its limit reached, its allowance used up, or its key refused | That piece uses Vosk. Settings shows "Transcribing with Vosk" with the reason, and until when if known. A refused key is tried again hourly |
| Gemini rate limit (per minute), 500, 503, network error | Retry with backoff and jitter, using the delay Gemini suggests, up to 5 times; then the piece goes back in the queue for later |
| Gemini daily limit | Gemini calls pause until it resets (midnight Pacific). Transcription carries on, so the backlog is ready to send |
| Bad key, billing problem, model retired (400, 401, 403, 404) | Gemini calls stop and the status shows the error. Checked again hourly and on restart |
| Unreadable or nonsense answer | That piece is retried once, then marked failed; one bad span never drops the others |
| Episode file missing from `/cache` | The scan fails and Settings says the cache folder isn't mounted where the add-on expects it |
| Add-on crashes or restarts | On its first report after starting, Murmur puts what it was scanning back in the queue, and saved transcripts mean it resumes where it stopped. If it never comes back, the 30-minute lease runs out instead |
| Add-on stopped or missing | Episodes simply have no marks. Settings shows "Not connected" after 15 minutes without contact |
| Murmur unreachable from the add-on | The add-on keeps its results and posts them when Murmur is back |
| Episode re-downloaded | Ad times belong to one cached file; a new file drops the old times and is scanned again |

Each episode has a scan status: queued, scanning, done or failed, with the attempt count and last error. After 3 failed attempts an episode stops being retried until an admin presses Retry.

## Player and settings

- **Marks.** Ad spans are drawn on the seek bar in the web player and the app.
- **Modes,** set per device (each browser and each phone keeps its own), with an optional per-show override on that device. For example, Auto-skip on the phone in the car and Show on the desktop.
  - **Off:** no marks.
  - **Show** (default): marks, plus a Skip ad button on the cover's corner while an ad plays, so nothing else on the player moves.
  - **Auto-skip:** playback jumps past the break when it runs into an ad's start, and a "Skipped ad" toast offers Undo for 5 seconds. Undo goes back to the start and doesn't skip that break again during this listen. An ad at 0:00 counts as run into when playback starts from the beginning.
- **No surprise skips.** Seeking into an ad never skips it; the Skip ad button shows instead.
- **Skipping covers the whole break:** ads less than 3 seconds apart count as one break, for both Skip ad and Auto-skip ("Skipped 3 ads").
- **Fetching ads.** The player asks `GET /api/episodes/:id/ads` for the current episode and asks again every minute while its scan runs. Asking also marks the episode as playing, which moves its scan to the front. Without the add-on the answer is `enabled: false`, and the ad setting is hidden. `/api/health` also reports `adDetection`, so the app knows before playing anything.
- **Checked badge.** Episode rows show a small accent shield once the episode has been checked for ads.
- **Private feeds aren't scanned.** A paid, members-only or personal feed's audio shouldn't leave the server for Groq or Gemini, so Murmur keeps such shows away from the add-on on its own, with no setting. A feed counts as private when its URL carries a key (a username and password, a query like `auth=` or `token=`, Substack's `/private/` path) or is on a members-only host (Patreon, Supercast, Supporting Cast, Memberful and the like), or when the feed says `<itunes:block>Yes</itunes:block>` (`podcasts/private-feed.ts`). It's worked out on every feed check and kept in `podcasts.private_feed`. Such a show's episodes are never queued or handed out; when a show turns out to be private, scans not yet done are dropped (a report for one in progress then finds no scan and is refused), and ads already found stay. The show page says Private in a pill under the episode count. A private feed with a plain URL and no `itunes:block` still gets scanned; that's rare.
- **Fewer ads for Murmur.** Hosts that insert ads per download (Simplecast, for one) may insert fewer for apps they don't recognise, and Murmur identifies itself honestly. Its copy can have fewer ads than the same episode in a major podcast app.
- **Admin settings:** episodes kept ready per show, cache usage against its cap, and the add-on's status (working, paused or error, "Not connected", and "Transcribing with Vosk" with the reason when Groq can't be used), with scan counts and Retry for failed episodes.
- **Planned:** phone downloads keep the episode's ad times, so marks and skipping work offline.

### Data model additions

| Table | Holds |
| --- | --- |
| `episode_files` | Episode, path under `/cache`, size, status (downloading, ready, failed), attempts, downloaded at, last played at |
| `episode_ads` | Cached file, start, end, kind, advertiser, first words |
| `ad_scans` | Cached file, status, pieces done, attempts, last error, lease expiry, not before, wanted at |

---

| [← Android app](android.md) | [Contents](README.md) | [Deployment and development →](deployment.md) |
| :--- | :---: | ---: |
