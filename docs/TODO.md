# To do

## Library home shelves

Done on web and app: Continue listening, Next in series, Recently added and Not started above All books, each heading opening a full list. Rules in `packages/shared/src/shelves.ts`. Decided against a New episodes shelf (Library stays books only) and a "New" badge.

Customize (0.1.6): the Books tab's sections can be dragged into order and hidden, in place from the header's Customize button, saved per user on the server (`/api/me/prefs`) so web and app match.

- **Later:** smart shelves (saved filters: author, narrator, length, status), collections (hand-picked lists), genre shelves, Want to listen.
- **Maybe:** customize the other tabs (order, which one opens first) and display options (cover size, list view, hide finished).

## Podcast episode cache and ad detection

Decided, not built yet. Next step: run the benchmark in `tools/adscan-bench` on the NAS (AS5304T, Celeron J4105, no AVX, 4GB) to choose how transcription and ad finding work.

**Episode cache (works without the ad add-on):**
- After each feed check, download the newest 3 episodes of every show anyone follows. Admins can change the 3 in Settings. Downloads are per episode, so a show many people follow is still fetched once.
- Skip episodes every subscriber has finished or archived. One download at a time.
- An episode that isn't cached downloads when someone plays it, and playback reads the growing file, so everyone hears the same copy (dynamically inserted ads differ per download).
- Web and app (including app downloads) are served from the cached copy.
- Size cap set by an env var. Never remove episodes in Up Next, in progress, or a show's newest 3; remove ones everyone finished first, then least recently played. Ad times are dropped with the file.

**Ad detection add-on (optional second container in the stack):**
- Reads the cache folder read-only and talks to Murmur with a shared secret: it asks for the next episode, posts back ad times.
- Scan order: playing now, then anything in Up Next, then new prefetched episodes.
- Candidates: transcribe on the NAS (Whisper tiny/base or Vosk) and classify with keyword rules, or send the audio to Gemini Flash-Lite (about 3 to 5 cents an hour of audio; the key goes in the add-on's env only).
- Player: ad spans marked on the seek bar, per-show Off / Show / Auto-skip, a "Skipped ad" toast with Undo. No manual marking for now.
