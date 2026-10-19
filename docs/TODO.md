# To do

## Library home shelves

Turn the top of the library into shelves, like Plex. Continue listening already exists. Each shelf is a horizontal row; its heading opens the full list. Built from data we already have, on web and in the app.

- **Recently added:** newest books by `added_at`, with a "New" badge for a week.
- **Next in series:** you finished book N of a series and own book N+1 but haven't started it.
- **Continue series:** series you've started but not finished; shows the next unfinished book in each.
- **Not started:** a handful of books you've never played, reshuffled daily (seeded by date so it doesn't jump on every load).
- **New episodes:** latest unplayed podcast episodes, so home mixes books and podcasts.
- Hide a shelf when it's empty. Later: per-user reorder and hide, genre shelves, Want to listen, collections.

## Podcast UI pass

Another design pass over the podcast screens on web and in the app: the podcasts list, the podcast page, episode rows and actions, and how new episodes show up. Rough edges to collect as we go.

## Podcast search (Podcast Index)

Today you can only subscribe by pasting a feed URL. Add a search box that finds podcasts by name.

- **Source:** [Podcast Index API](https://podcastindex-api.readme.io). Free; needs an API key and secret from podcastindex.org. Each request is signed with `X-Auth-Key`, `X-Auth-Date` and `Authorization: sha1(key + secret + date)`.
- **Settings:** the key and secret come from env (`PODCASTINDEX_KEY`, `PODCASTINDEX_SECRET`) or the admin settings. Without them, the search box is hidden and paste-a-URL still works.
- **Server:** `GET /api/podcasts/search?q=` calls `/search/byterm` on the server (the secret never reaches clients). It returns title, author, artwork, feed URL, episode count and whether you're already subscribed. Short timeout; cache results for a few minutes.
- **Web:** the Add podcast sheet gets a search field above the URL field. Results show cover, title and author, plus a Subscribe button that uses the existing feed-URL subscribe.
- **App:** same flow in the Android app (hand off to the mobile session).
- **Later:** trending and category browsing (`/podcasts/trending`).
- **Docs:** add the endpoint and settings to SPEC.md and README.md.
