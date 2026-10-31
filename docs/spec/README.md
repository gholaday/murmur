# How Murmur works

How Murmur works and why. For installing it, see [Getting started](../GETTING_STARTED.md); for colours, components and wording, see the [design system](../DESIGN.md).

## Overview

Murmur is a self-hosted server for audiobooks, podcasts, music, movies and TV shows, with a web player and an Android app. It reads an existing audiobook folder (the Audiobookshelf layout), follows podcasts by RSS, plays music from a folder of albums, streams movies and shows from their folders, and keeps progress in sync across devices. It runs as one Docker container.

It trades breadth for reliability: fewer features than larger media servers, each one solid.

### Principles

| | |
| --- | --- |
| **Phone first** | The Android app is the main way to listen; the web player covers the desktop and admin work. |
| **One container, one volume of state** | No separate database, cache or worker containers. Optional add-ons (ad detection, and video for movies and shows) run beside it, and Murmur works the same without them. |
| **Files are the source of truth** | Folder names and embedded tags decide metadata. Online lookups happen only when an admin asks for them and confirms the result. The one exception is artist photos, which are looked up by name after a music scan (see [Music](music.md)). |
| **Boring to run** | Pinned versions, updates are a redeploy, backups are copying one folder. |
| **One language** | TypeScript across server, web and app. |

## Contents

| | Page | What's in it |
| --- | --- | --- |
| 📋 | [Features](features.md) | Everything Murmur does, by area: books, podcasts, music, Watch, stats, the player, sync and accounts |
| 🧱 | [Architecture](architecture.md) | The tech stack, how the pieces fit together, the data model and API, and performance and reliability |
| 📚 | [Library scanning](library.md) | How book folders are found, read and kept up to date |
| 🏷️ | [Metadata](metadata.md) | Where book and podcast details come from: tags, Match on Audible and Google Books, editing by hand, and episode chapters |
| 🎵 | [Music](music.md) | Scanning, your music and Browse, playback, playlists, the queue, album matching and artist photos |
| 🎬 | [Watch](watch.md) | Movies and shows: folders, TMDB, playback, conversion and downloads |
| 📺 | [Casting](casting.md) | Playing on a Chromecast from the web and the app |
| 📱 | [Android app](android.md) | Screens, playback, Android Auto and offline |
| 🎙️ | [Podcasts and ad detection](podcasts.md) | The episode cache, the ad detection add-on, and ad marks and skipping in the players |
| 🐳 | [Deployment and development](deployment.md) | Mounts, images, remote access, updates and running it locally |
| 🔢 | [Versions and upgrades](versions.md) | What a major, minor and patch release may change, and how the app and server stay compatible |
| 🧭 | [Non-goals and later ideas](later.md) | What's left out on purpose, and ideas for later |
