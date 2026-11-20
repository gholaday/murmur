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
3. **Find the ads and the topics.** Each piece goes to Gemini as text (eight-word lines with start and end times) as soon as it is transcribed, running 2 minutes into the next piece so an ad break on a cut is seen whole. Copies of an ad found in two pieces are merged. The same call also splits the piece into topic chapters, the way a long video is split into sections; it's told the previous piece's last topic, so a topic running across a cut isn't started twice. The transcript is sent once for both, so chapters only add a few lines to each answer.
4. **Check the answer.** Spans with the end before the start, outside the episode, or longer than 5 minutes are dropped, and spans running past the end are cut to it. A chapter that starts inside an ad moves to the ad's end, two starts less than 90 seconds apart are one, the first starts at 0:00, and fewer than two chapters is none.
5. **Report.** Spans and chapters are posted per piece (`POST /api/addon/ads/:fileId`), so the first marks appear minutes after a scan starts, not after the whole episode.

Each span has a start, an end, a kind (`inserted`, `host_read` or `promo`), the advertiser if named, and its first words. Each chapter has a start and a short title.

**Chapters from the transcript** are only used when the publisher gives none (the feed's Podlove chapters, its Podcasting 2.0 chapters file, or the MP3's ID3 chapters always win). They're stored with the scan in `ad_scans.chapters` because, like ad times, they're timed to that copy of the audio, and they go when it leaves the cache. `GET /api/episodes/:id/chapters` serves them like any other chapters, so the chapter list, the seek bar and the lock screen need nothing new; they look the same as a publisher's. A scan that finishes while the episode plays makes the player ask for its chapters again. Episodes scanned before this have none (their transcripts are gone), and an older add-on that sends no chapters leaves them as they were.

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

## Screens

The same on the web and the app; the rules they share are in `packages/shared/src/podcasts.ts`.

- **Podcasts tab:** Home, Shows and Browse text tabs (`PODCAST_TABS`). Add (+) is at the top right on Home and Shows; it opens Browse with the box focused. Sort is there on Shows. With nothing followed yet, the tab is just Browse. Home shows the following, hiding any that's empty:
  - Continue listening: a sideways shelf of wide cards. Each card sits on `surface` mixed with 15% of the show's colour and has the cover, the show, the episode title (two lines at most), and the play pill and progress bar. The pill plays and the rest of the card opens the show.
  - New episodes, with an accent count: the 6 latest, one row per show with how many are new (`newByShow`, `PODCAST_SECTION_SIZE`).

  Both headings open their full lists. With neither, Home says "Nothing new" and "New episodes from your shows will show here." Shows is every show in a grid, in the chosen sort.
- **Browse** is where shows are found. Every show on it is a `PodcastSearchResult`, whether it's a search result, a chart entry or a suggestion, and each works the same way. Tapping the show opens its preview, or its page once followed. The heart subscribes in place and a toast offers Open. Once followed, the heart becomes an accent check that opens the show.
  - **The box** sticks to the top. It searches the directory by name from 2 letters, or, given a feed link (`feedLinkIn`), shows that one feed; a link that isn't a feed says "That link isn't a podcast feed." Its text is kept in the URL (`?tab=browse&q=`), so back from a show returns to it. Clearing it brings back the shelves as they were.
  - **More like *show*:** up to 3 shelves, one per category, from the 8 followed shows you played most recently. The show you played last always gets the first shelf; the others take turns in an order that changes each day (`dailyOrder`). A shelf holds 12 shows, without what you follow. First come the shows the followed show's own feed recommends (`podcast:podroll`). The rest come from searching the directory for what the show is about: its title, the subject in its title ("great books" for Ascend - The Great Books Podcast) and the words and phrases its episode titles keep coming back to (`server/podcasts/more-like.ts`). A show several searches find, near their tops, in the same category, ranks highest; outside the main category it takes two searches agreeing, and with no category in common three. The category's chart tops up a shelf the searches can't fill. The 12 are picked each day from the best 18 and keep their rank order. A card's ⋯ (or right-click) has Subscribe, See episodes and Not interested. Not interested is saved per person (`podcast_not_interested`) and keeps the show out of Browse and charts, with Undo.
  - **Top shows:** the top 5 on phones and 10 in two columns on wide screens, ranked. The heading opens Top shows (`/podcasts/top`), the top 50 with All and category text tabs (`PODCAST_GENRES`).
  - **Categories:** a tile per category, opening Top shows on its tab. Then Import OPML and Export OPML.
  - **Where it comes from:** Apple's public charts for the US (no key), looked up for feed links. Charts are cached for a day and lookups for a week, in memory and shared by every user (`server/podcasts/directory.ts`). A followed show's category comes from searching its title and matching its feed link, and is kept for a week too, as are More like's searches and the podroll shows, read from their own feeds. A feed's podroll is saved on every feed check in `podcasts.podroll`. Charts and suggestions include explicit shows unless You > Podcasts > Explicit shows in Browse is turned off; search always includes them.
  - **Failure:** if the directory can't be reached, Browse says "Can't reach the podcast directory" with Try again, and a pasted feed link still works. A More like shelf that fails is left off on its own.
- **A show's page:** the book page's header: the cover, title, author, and one muted line with the episode count, the latest date and Private. An accent check on the cover's top right corner shows you're subscribed and asks before unsubscribing; a show from search has a heart there that subscribes. Then the description. A sticky row holds Episodes, Unplayed, Bookmarks and More like text tabs (`SHOW_TABS`) with search and sort on its right. `?tab=morelike` opens on More like.
  - Unplayed is every episode not finished (`unplayedEpisodes`), so it loads the full list the way search does. With nothing left it says "No unplayed episodes" and "You're all caught up."
  - Bookmarks lists the show's bookmarks grouped by episode, newest first. It's only there while the show has some, and it hides search and sort.
  - More like lists up to 30 shows like this one as Browse's rows (`GET /api/podcasts/more-like?feedUrl=`, `moreLikeFor`), found the same way as Browse's shelves but in the same order every day, best match first. When the feed has a podroll, those shows come first under "Recommended by the show", then the rest under "Similar shows". Shows you follow (by feed link or title), Not interested and, by your setting, explicit shows are left out. It loads as the tab opens, with row bones; nothing found says "No similar shows found", and a dead directory says "Can't reach the podcast directory." with Try again. It hides search and sort. Browse's "More like *show*" headings open it.
  - A show you don't follow (its preview) has Episodes and More like tabs. More like reads what it's about from the feed the preview just read.

## Player and settings

- **Marks.** Ad spans are drawn on the seek bar in the web player and the app.
- **Modes,** set per device (each browser and each phone keeps its own), with an optional per-show override on that device. For example, Auto-skip on the phone in the car and Show on the desktop.
  - **Off:** no marks.
  - **Show** (default): marks, plus a Skip ad button on the cover's corner while an ad plays, so nothing else on the player moves.
  - **Auto-skip:** playback jumps past the break when it runs into an ad's start, and a "Skipped ad" toast offers Undo for 5 seconds. Undo goes back to the start and doesn't skip that break again during this listen. An ad at 0:00 counts as run into when playback starts from the beginning.
- **No surprise skips.** Seeking into an ad never skips it; the Skip ad button shows instead.
- **Skipping covers the whole break:** ads less than 3 seconds apart count as one break, for both Skip ad and Auto-skip ("Skipped 3 ads").
- **Fetching ads.** The player asks `GET /api/episodes/:id/ads` for the current episode and asks again every minute while its scan runs. Asking also marks the episode as playing, which moves its scan to the front. Without the add-on the answer is `enabled: false`, and the ad setting is hidden. `/api/health` also reports `adDetection`, so the app knows before playing anything.
- **Enhanced badge.** Episode rows show small accent sparkles once the episode's scan is done: its ads are found, and it has chapters from the transcript if the publisher gave none. The tooltip and label say "Checked for ads and chapters".
- **Bookmarks.** The ad setting moved off the player's tiles to give Bookmarks that spot (see [Bookmarks](features.md#bookmarks)). A bookmark is a time, so if a feed changes an episode's ads it can land in a slightly different spot.
- **Private feeds aren't scanned.** A paid, members-only or personal feed's audio shouldn't leave the server for Groq or Gemini, so Murmur keeps such shows away from the add-on on its own, with no setting. A feed counts as private when its URL carries a key (a username and password, a query like `auth=` or `token=`, Substack's `/private/` path) or is on a members-only host (Patreon, Supercast, Supporting Cast, Memberful and the like), or when the feed says `<itunes:block>Yes</itunes:block>` (`podcasts/private-feed.ts`). It's worked out on every feed check and kept in `podcasts.private_feed`. Such a show's episodes are never queued or handed out; when a show turns out to be private, scans not yet done are dropped (a report for one in progress then finds no scan and is refused), and ads already found stay. The show page says Private in a pill beside the episode count. A private feed with a plain URL and no `itunes:block` still gets scanned; that's rare.
- **Fewer ads for Murmur.** Hosts that insert ads per download (Simplecast, for one) may insert fewer for apps they don't recognise, and Murmur identifies itself honestly. Its copy can have fewer ads than the same episode in a major podcast app.
- **Admin settings:** episodes kept ready per show, cache usage against its cap, and the add-on's status (working, paused or error, "Not connected", and "Transcribing with Vosk" with the reason when Groq can't be used), with scan counts and Retry for failed episodes.
- **Planned:** phone downloads keep the episode's ad times, so marks and skipping work offline.

### Data model additions

| Table | Holds |
| --- | --- |
| `episode_files` | Episode, path under `/cache`, size, status (downloading, ready, failed), attempts, downloaded at, last played at |
| `episode_ads` | Cached file, start, end, kind, advertiser, first words |
| `ad_scans` | Cached file, status, pieces done, attempts, last error, lease expiry, not before, wanted at, chapters from the transcript |
| `podcast_not_interested` | Person, feed link and when: shows kept out of Browse |
| `podcasts.podroll` | The feed links a show recommends (`podcast:podroll`), as JSON, for More like |

---

| [← Android app](android.md) | [Contents](README.md) | [Deployment and development →](deployment.md) |
| :--- | :---: | ---: |
