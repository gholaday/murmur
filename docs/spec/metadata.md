# Metadata

Metadata comes from your files first; an optional Match button fills gaps from online sources, and only when you confirm it.

## Layer 1: local, always on

_Done by the scanner._

| Field | Source, in priority order |
| --- | --- |
| Title | Embedded title tag, then the folder name minus any series number |
| Author | Author folder (decides grouping); embedded artist tag shown if it differs |
| Narrator | `reader.txt`, then the composer or narrator tag |
| Series and position | Series folder and the leading number in the title folder, then the grouping tag |
| Description | `desc.txt`, then the comment or description tag |
| Year | Date tag |
| Duration and chapters | `music-metadata` on the audio files (constant-bitrate MP3 lengths from size and bitrate) |
| Cover | `cover.jpg` or `cover.png`, then any image in the folder, then embedded art |

## Layer 2: online match

_Admin only._

After each scan, every book not tried yet is searched once, and a result scoring 100 is applied on its own: title, author and length all agree (no length caps a score at 85). It takes the cover (only when bigger), author, narrator, series, year and description, never a hand-edited field. Anything less waits in You > Library > Not matched for Match or Match all. `books.match_tried_at` keeps it from being asked again; a lookup that fails is tried after the next scan.

1. From a book page or a library card's options menu, open **Match metadata**. The server searches Audible's catalog by title and author, with Google Books as a fallback.
2. You pick the right result from a list with covers.
3. The match fills only empty or poor fields (missing cover, description, narrator, series, a better chapter list from Audnexus). Fields you don't tick are left alone, and **Undo all edits** in Edit's Files tab returns to the file metadata.
4. Matched data is stored in the database as an override; your files are never modified, and a rescan never undoes a match.

Nothing is applied without your confirmation. The Audible and Audnexus lookups are unofficial APIs, so if they break, matching degrades and everything else keeps working.

## How matching stays consistent

The same book always gets the same answer, and a weak answer is shown as weak instead of applied.

1. **IDs first.** If a file's tags or the folder name carry an Audible ASIN or an ISBN (Libation and OpenAudible downloads usually do), look it up directly.
2. **Clean the query.** Strip series numbers, "Unabridged", years, bracketed tags and narrator names from the title; normalize accents, punctuation and author name forms ("J.R.R. Tolkien" equals "J. R. R. Tolkien").
3. **Gather candidates** from Audible (region set by `AUDIBLE_REGION`, default US), then Google Books only when Audible has nothing scoring 70 or more. Provider responses are cached for 30 days, and a stale cached answer is used if a provider is down; answers over 90 days old are dropped nightly.
4. **Score every candidate** on the same weighted checks:

| Signal | Weight | Why it matters |
| --- | --- | --- |
| Duration within 2% of the local files | High | Tells unabridged from abridged and dramatized editions |
| Author name match | High | Stops same-title books by other authors |
| Title similarity after cleaning | High | Core match |
| Narrator match | Medium | Separates re-recordings |
| Series name and position match | Medium | Picks the right book in a series |
| Language | Low | Avoids translated editions |

5. **Act on the score.** 90 or above: pre-selected as the suggestion. 70 to 89: candidates listed, nothing pre-selected. Below 70: "No confident match", with a manual search box.
6. **Review before apply.** A side-by-side view shows current and proposed values per field, with checkboxes. Empty or poorer fields are ticked by default; titles and authors never are.
7. **Safe merge rules.** A new cover is only suggested when it is larger than the current one. Online chapter lists are only applied when their total length matches the files within 1%, so chapter marks can't drift.
8. **Remember the result.** The chosen ASIN is stored, so later refreshes are exact lookups.

## Layer 3: editing by hand

_Admin only, web._

Every card has an options menu, the same way for books, albums, movies and shows: a long press in the app, the ⋯ or a right-click on the web. The ⋯ on the item's own page opens the same items, for everyone, with admin items last:
- **Book:** Play, Add to Play next (books not yet started), Mark as finished; for admins Edit…, Match…, Mark as matched. Rescanning is You > Library's Rescan, or one book from Edit's Files tab.
- **Album:** Play, Add to queue, Add to playlist…, Go to the artist, Add to or Remove from your music; for admins Match….
- **Movie or show:** Play or Resume, Mark as watched; for admins Edit… and Match… (with TMDB). The edit dialog has five tabs:

| Tab | What it does |
| --- | --- |
| Details | Title, author, narrator, series and book number, year, description. A changed field is marked Edited, shows what the files say, and can be reset |
| Cover | Upload an image, use an image link, or pick a cover from the online results; go back to the files' cover at any time |
| Chapters | Rename chapters, change start times, add or remove them; or go back to the files' chapters |
| Match | The online match above, inside the dialog |
| Files | The book's folder and files with length, size and bitrate; rescan this book; undo every edit and match |

Edits are stored in the same override row as a match, so a rescan keeps them and the files are never touched.

**You > Library** (admins only) holds the library's upkeep, so the tabs stay clean for everyone. A section per kind (Books, Music, Movies and shows) shows its count and last scan with a Rescan button, then its lists and folders: **Needs attention** (books with no cover, no author or missing files), **Not matched** for books and for albums, each with Match all. `GET /api/library/admin` gives the web and the app the same counts. **You > Podcasts** is its own row: the episode cache for admins, and on the web, OPML export for everyone (import is in the Podcasts tab's Add sheet). On the web it's hidden with the Podcasts tab for anyone who isn't an admin; in the app, which has no OPML export, it's for admins only.

**Podcasts:** show and episode titles, artwork, descriptions and durations come from the RSS feed itself.

**Episode chapters** come from the first of three places that has them, with no AI guessing:

1. Podlove `<psc:chapters>` in the feed, saved at each feed check.
2. The Podcasting 2.0 chapters file (`<podcast:chapters>`, JSON). Entries marked `toc: false` only change the artwork and are left out.
3. ID3 CHAP frames at the start of an MP3: read from the cached copy when there is one, otherwise a range request for the tag (up to 8 MB). M4A chapters aren't read.

They're looked up the first time an episode is played, and after each feed check for a show's three newest episodes, so they're usually there before you press play. The result is stored, and an empty list means "none". If a source can't be reached and nothing was found, nothing is stored and it's tried again next time. Fewer than two chapters counts as none. Each chapter ends where the next one starts, and the last ends at the episode's end, corrected once the file's real length is known. A new chapters file or audio address in the feed clears the stored chapters.

---

| [← Library scanning](library.md) | [Contents](README.md) | [Music →](music.md) |
| :--- | :---: | ---: |
