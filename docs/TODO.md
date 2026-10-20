# To do

## Library home shelves

Done on web and app: Continue listening, Next in series, Recently added and Not started above All books, each heading opening a full list. Rules in `packages/shared/src/shelves.ts`. Decided against a New episodes shelf (Library stays books only) and a "New" badge.

Customize (0.1.6): the Books tab's sections can be dragged into order and hidden, in place from the header's Customize button, saved per user on the server (`/api/me/prefs`) so web and app match.

- **Later:** smart shelves (saved filters: author, narrator, length, status), collections (hand-picked lists), genre shelves, Want to listen.
- **Maybe:** customize the other tabs (order, which one opens first) and display options (cover size, list view, hide finished).

## Podcast episode cache and ad detection

Built on the server and web; the Android app is next. The design is in `docs/SPEC.md` under "Podcast episode cache and ad detection" (roadmap phases 5 and 6), the add-on in `addons/adscan`.

- **Decided by a benchmark** (since removed): Groq's hosted Whisper large-v3-turbo transcribes, with Vosk on the server as the fallback (about 5x real time on the AS5304T; local Whisper is too slow without AVX, and Parakeet needs about 1.4 GB of memory), then Gemini 3.5 Flash-Lite reads the transcript as text in 30-minute pieces. It found all 20 ads in a 70-minute episode with edges within a second, at about 23k tokens an hour, which fits the free tier. Sending audio to Gemini was less accurate and invented ads.
- **Next:** the Android app (marks, Skip ad, Auto-skip with Undo, Ads sheet, per-device setting, ad times saved with downloads), then a release to try it on the server.
- **Later:** the mini player could show Skip ad too.
- No manual ad marking for now.
