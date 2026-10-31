# Versions and upgrades

From 1.0, the version number says what an update can break. Before 1.0, anything can change between versions.

## What each number means

| Change | What goes in it |
| --- | --- |
| **Major** (2.0) | The only place for breaking changes: removing or renaming an API route or field, the server accepting less than it did, a compose change that needs a manual step, or no longer upgrading straight from an old version |
| **Minor** (1.1) | New features, added without taking anything away |
| **Patch** (1.0.1) | Fixes only |

## Rules within a major version

- **The API only grows.** New fields are optional both ways: an older app ignores fields it doesn't know, and a newer app copes when a field is missing. A route or field that should go is marked deprecated in the code and removed at the next major.
- **The shared schemas are the contract.** The zod schemas and types in `packages/shared` are what the server and the app agree on. Changing one is changing the API.
- **Any 1.x upgrades straight to the newest 1.x.** Database migrations run on their own at start, forward only, after the copy to `/data/backups` that a bad update can be rolled back from (see [restoring](../GETTING_STARTED.md#backups-and-restoring)).
- **The add-ons move with Murmur.** Murmur, `murmur-video` and `murmur-adscan` are released together with one version, and an add-on works with a Murmur of the same major.

## How it's held to (built before the 1.0 release candidate)

- **API snapshot test.** A test lists every route and its methods and compares them with a saved snapshot. Removing or renaming one fails until the snapshot is updated on purpose, which is when to ask whether this is a major version.
- **The app and the server check majors.** The app reads the version from `/api/health` when it connects. A server with a newer major than the app shows "Update the app to use this server" on You, with a link to the latest APK; an older one shows "Update the server". Within the same major nothing shows. The web player is served by the server, so it's always in step.
- **Add-on check.** Murmur compares each add-on's major with its own and says so in the add-on's status line when they differ, like a too-short `ADDON_SECRET`.
- **Upgrade test.** `db/upgrade.test.ts` upgrades an old database, with data in it, through every migration. Its starting point moves to 1.0 once 1.0 ships.

---

| [← Deployment and development](deployment.md) | [Contents](README.md) | [Non-goals and later ideas →](later.md) |
| :--- | :---: | ---: |
