# Working on Murmur

Murmur is a self-hosted audiobook, podcast and music server with a web player and an Android app. Keep it small, simple and low-maintenance. [docs/SPEC.md](docs/SPEC.md) explains how it works and why.

## Workflow

- Use pnpm for everything: installs, scripts, filters.
- Run it locally with `pnpm dev` (http://localhost:3000). Data lives in the repo's git-ignored `data/` folder. Docker is only for the production image, not for development.
- Test data in `data/` is disposable. Change it freely, and don't ask about restoring it. Never touch the library files themselves.
- Make file changes with your editing tools, not Python or sed scripts.
- Unit tests only for key logic (parsing, ordering, timing). No integration tests and no test spam. Check changes by running the app.
- If a change doesn't show up on the Android emulator, assume Metro broke: force a reload before debugging the code.
- Never commit secrets, keys or passwords.
- Make a mockup before building a new screen or a big UI change, as an artifact in the chat (not in the repo), and a plan before a big feature.
- Keep it fast and light. It should just work, every time.
- Optional features (ad detection, music) fail on their own: if one breaks, everything else keeps working.
- Logic that the web and the app both need goes in `packages/shared`, not in two copies.

## Commits and releases

- Commit only when asked. Release only when asked.
- To release: bump the version in `README.md`, `docker-compose.yml` (all three images), `apps/server/package.json` and `addons/video/package.json`, commit as "Release x.y.z", tag `vX.Y.Z`, and push main and the tag.
- The release commit's body becomes the GitHub release notes, which Settings shows as What's new. Write it in plain words.

## UI

- Follow the existing designs unless told otherwise. New screens reuse the patterns, components and tokens already in the app. The design system is [docs/DESIGN.md](docs/DESIGN.md).
- Never say "NAS" in the UI. Say "server", or just "Downloaded".
- The music screens never mention the server.
- No " · " dot separators. Use a count pill, a second line, or left and right placement instead.
- On nested screens, the back arrow sits alone on the top row, with the title below it.
- Keep the web player and the app matching: wording, chip order, empty states and hidden tabs. A change on one goes to the other too.
- Keep UI text minimal. Cut helper text that states the obvious, and write errors that say plainly what went wrong.
- Put the same control in the same place on every screen (search and filter at the top right).
- Show actions as visible icons rather than hiding them behind a tap on the row.
- Keep things compact: put related details on one line in a smaller font rather than adding rows, and scroll long text sideways in tight spots instead of wrapping.
- Center icons in their buttons, and align icons with the text beside them.
- Number badges: grey counts what's in a list, accent flags something new. No counts inside chips, and none next to page titles.
- Settings are one row per group that opens its own screen.
- Content fades in as it loads. Use a skeleton only where it matches the real layout; no spinners for page loads.
- Motion is smooth and nothing jumps: modes like Customize fade their controls in place without reloading, and dragged rows follow the pointer while the others move aside.
- Sheets drag down to close, their backdrop fades in place, and dialogs don't close when a text-selection drag ends outside them. Ask before deleting anything the person saved.
- Toasts come in from the top.
- Keep main actions reachable: on long lists, stick them to the top.

## Scope

- No Play Store or App Store release. The APK is installed from GitHub releases.
- No iPhone app for now. The web player covers it.
- Keep the docs in step with changes: the spec, the design system, README and Getting started.
