# Murmur design system

Murmur is quiet and dark by default, close to a podcast app: covers do the colour work, one periwinkle accent marks what is selected or playing, and everything else stays out of the way. Follow what already exists. A new screen reuses these tokens and components before it invents anything, on the web and in the Android app alike.

The values below come from [`apps/server/src/app/globals.css`](../apps/server/src/app/globals.css) (web) and [`apps/mobile/src/theme.ts`](../apps/mobile/src/theme.ts) (app), which are the source of truth. Change a value there and here together.

## Writing

- **Plain words, sentence case.** Titles, buttons and labels are sentence case ("Continue listening", "Add to playlist"). Eyebrow labels are typed in sentence case and uppercased by CSS.
- **Talk to the listener as "you".** "Your music", "Your queue is empty", "48 albums you haven't added". Never "the user", never "I".
- **Name things the way a listener does.** Say "server" or "Downloaded", never "NAS". The music screens never mention the server at all.
- **Controls say exactly what they do, and toasts confirm it.** "Add to Play next", "Add to Up Next", "Remove from this playlist", then a toast "Removed from the playlist" with Undo. "Delete playlist" is the danger item, and the toast says "Deleted Road trip".
- **Empty states say what's missing and how to fix it.** A bold line, then one muted sentence: "No songs yet" / "Add songs from the menu on any song, with Add to playlist."
- **No dot separators.** Never join metadata as "4 books · Recently added". Use a count pill beside the heading, a second line, or a few pills.
- **Don't repeat what's already on screen.** The sort order lives on the sort button, not in the heading.
- **No emoji.** Numbers use real units: "6h 2m left", "14 of 15 songs", "Most played song, 6 plays".
- **Same words everywhere.** The web and the app use the same labels, chip order and empty states.

## Colour

Dark is the default theme; light follows the system or a choice under You > Appearance. On the web each token is a CSS variable (`var(--surface)`); in the app it's a key on `useTheme()` (`t.surface`, camel-cased).

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `bg` | `#111214` | `#fafaf8` | Page background; lists scroll on it |
| `bg-deep` | `#0b0b0d` | `#f1f0ec` | Outside the page column on wide screens |
| `surface` | `#1c1d21` | `#ffffff` | Raised boxes: settings cards, stats tiles, the Browse row, sheets, inputs |
| `surface-2` | `#26272c` | `#edece8` | Plain and round buttons, menus, the mini player's base, cover placeholders |
| `chip` | `#212226` | `#edece8` | Unselected chips, count pills, info pills |
| `line` | `#222327` | `#e4e3de` | Hairlines under rows, the tab bar's top edge, input borders |
| `track` | `#2b2c31` | `#e4e3de` | Unfilled progress, the switch when off, outline-button borders |
| `text` | `#f3f1ec` | `#17171a` | Titles and body text |
| `text-2` | `#d6d4cf` | `#3a3936` | Secondary content: descriptions, narrators, chip labels |
| `muted` | `#a9a7a2` | `#6b6a66` | Sub lines, times, counts, eyebrows |
| `faint` | `#7e7c78` | `#8a8984` | Drag handles and other marks. Only 3.35:1 on light `bg`, so not for small text |
| `accent` | `#8e9bff` | `#4f5bd5` | Selected chips and tabs, primary buttons, progress, links, the playing row, new badges, focus rings |
| `on-accent` | `#141833` | `#ffffff` | Text and icons on an `accent` fill |
| `danger` | `#ff8a8a` | `#c43c3c` | Destructive actions and errors |
| `stat-2` | `#f2a65a` | `#b8620f` | Podcasts in the listening stats |
| `stat-3` | `#4fb39a` | `#1e7a63` | Music in the listening stats |
| `nav` | `#17181b` | `#ffffff` | The tab bar and sidebar |
| `tab-inactive` | `#9a9aa0` | `#8a8984` | Unselected tabs. Only 3.5:1 on light `nav` |

Fixed colours used in both themes: `#5ccf8a` success and `#f0b45a` warning (status dots, match scores; both read poorly on white, so pair them with words), and the ad colours `#ef9f27`, `#ba7517` (already played) and `#412402` (text on the Skip ad button).

**How to use them.** Build every screen from the same grounds: `bg` for the page, `surface` for raised cards and sheets, `surface-2` for buttons and the mini player, `chip` for chips and pills. `accent` is the only hue in the chrome. `stat-2` and `stat-3` only tell podcasts and music apart in the stats.

**Covers carry the colour.** A book, show or album header tints its background from the cover, with a blurred copy bleeding out behind it; the full player, the now-playing card and the mini player tint the same way. Don't add brand colour around covers.

## Type

One family, Plus Jakarta Sans (Google Fonts), at weights 400 to 800. Folder paths are the only monospace text.

| Style | Size / weight | Use |
| --- | --- | --- |
| Stats total | 34 / 800, -0.8px | The listening total on You |
| Page title | 30 / 800, -0.5px | Each tab's title |
| Book title | 24 / 800, -0.3px | A book's header (32 on wide screens) |
| Show title | 22 / 800 | Show, album, artist and playlist headers; the full player (30 on wide screens) |
| Stat value | 22 / 800 | Stats tiles |
| Section title | 17 / 700 | Section headings, often with a count pill |
| Sheet title | 17 / 800 | Top of a sheet |
| List title | 15 / 700 | List row and episode titles |
| Row title | 15 / 600 | Settings rows, songs in an album |
| Big button | 15 / 800 | Play, Continue |
| Body | 14 / 400, line height 1.45 | Running text (descriptions 1.55, in `text-2`) |
| Button | 14 / 700 | Buttons; menu items at 600 |
| Card title | 13 / 700 | Titles under covers |
| Chip | 13 / 600 | Chip labels; 700 when selected |
| Sub | 12 / 400 | Sub lines, in `muted` |
| Eyebrow | 12 / 700, 0.6px, uppercase | Group labels like "Now playing", in `muted` |
| Tab label | 11 / 600 | Tab labels (12 in the app); 700 when selected |
| Count | 11 / 800, tabular | Count pills and badges |

Use tabular figures wherever numbers sit in a column or tick over.

## Space, shape and depth

- **Space.** The page has a 20px gutter, 28px above the title and 24px above each section. Inside sections use 12px between cards and rows of things, 8px between chips and buttons, 4px between header icons. Every tap target is at least 44px. The mini player is 64px tall; the tab bar is 72px on the web.
- **Corners.** Controls are fully round: chips, pills, buttons, badges, the play button. Covers are 8px in grids, 10px in Continue listening, 12px in headers, 16px in the full player. Inputs are 12px. Cards, menus and the mini player are 14px. Sheets are 20px on top.
- **No borders around cards.** A card is `surface` on `bg`. Lists are rows split by a `line` hairline, not boxed cards.
- **Shadows only on things that float:** the mini player, menus, sheets, a row lifted while dragging (`0 8px 24px` at 45% black dark, 14% light). Header covers get a softer drop shadow. Nothing else casts one.

## Layout

- Phones get a bottom tab bar: Books, Podcasts, Music, You. The mini player floats 8px above it.
- From 900px wide the tabs become a 220px sidebar with the Murmur mark, and the page is a centred column of at most 1080px.
- Podcasts and Music can be hidden per person. When one is, its tab and its parts of You go away.
- **Nested screens:** the back arrow sits alone on the top row, with the title on the row below it, never beside it. A ⋯ menu may share the arrow's row on the right.

## Motion and states

- Short and functional: pages fade in over 220ms, sheets and the player rise 24px over about 200ms, covers fade in once loaded, dragged rows slide out of the way. All of it stops under `prefers-reduced-motion`.
- On the app and the web at phone width, the full player minimises like a sheet: a pull down that starts on its top bar or cover moves it with the finger, showing the screen below, and closes it past a quarter of the screen (120 points on the app) or on a quick flick; otherwise it springs back. A tap on the bar's buttons still works. Below the cover, drags stay with the slider and controls.
- Focus is a 2px `accent` outline, offset 2px. Disabled is 45% opacity. Hover on icon buttons is a 7% `text` wash.
- Selected chips and tabs switch to `accent` with `on-accent` text. The playing row's title turns `accent`.

## Icons

Murmur draws its own line icons in the Lucide style: 24px viewBox, 2px round strokes, no fill, `currentColor`. Play and pause are drawn solid. They live in [`apps/server/src/web/icons.tsx`](../apps/server/src/web/icons.tsx), and the app copies the same paths in `apps/mobile/src/components/icons.tsx`. Use 24px in the tab bar and most buttons, and 18 to 22px inside buttons with words. Reuse an existing icon before drawing a new one, and never use emoji as icons.

## Logo

[`apps/server/src/app/icon.svg`](../apps/server/src/app/icon.svg) is the mark: five rounded bars in `#8e9bff` on a `#141833` rounded square. It's the browser icon and sits beside "Murmur" (22 / 800) at the top of the wide-screen sidebar. `apps/mobile/assets/icon.png` is the Android launcher icon. Don't recolour or redraw either.

## Components

Web class names are in `globals.css`; the app has matching components under `apps/mobile/src/components/`. On the web, use the React components in [`apps/server/src/web/ui.tsx`](../apps/server/src/web/ui.tsx) where one exists instead of writing the class names out, and add a new one there when a pattern repeats.

- **Button** (`.btn`, `.btn-primary`, `.btn-big`, `.btn-round`, `.btn-outline`, `.btn-small`, `.btn-danger`). One primary big button per screen (Play, Continue, Make playlist), usually with a round Shuffle beside it. While that book, album or playlist is the one playing, Play reads Pause, or Resume when paused. Plain buttons for secondary actions, outline for a quiet add action under a list. Labels are verbs that say what happens, never "OK" or "Submit".
- **Icon button** (`.icon-btn`). 44px round, one 24px icon, an `aria-label`. For search, sort, ⋯ and the back arrow. Use a text button when no familiar icon says the action.
- **Back** (`BackButton`, `BackRow`, `NestedHead`). The arrow goes back, or to a fallback screen when the page was opened directly. `NestedHead` is a nested screen's whole head: the back row, then the title with its count, a sub line and actions on the right.
- **Chip** (`Chips`, `Chip`; `.chip`, `.chips`). Switches between views of the same content: Books / Authors / Series / Finished, Playlists / Albums / Artists / Songs (opening on Albums), Week / Month / Year / All time. One selected per row, never an action. `Chips` takes a kind: `tabs` for views, `radio` for picking one setting, `toggle` for fields turned on and off one by one. A `warn` chip is for Needs attention.
- **Badge** (`CountPill`, `SectionTitle`, `TitleWithCount`; `.count-pill`, `.tab-count`, `.badge-count`, `.new-pill`). Grey counts what's in a list; accent flags something new or waiting. No count next to a tab's page title. `SectionTitle` is a section heading with its count, as a button when it opens the full list.
- **Search box** (`SearchBox`). Opens under the page head from the search button, focused, with a placeholder that says what it searches. No results reads `Nothing matches "<query>".` everywhere.
- **Pill** (`.pill`, `.pills`). Two or three short facts in a header (1977, 11 songs, 39m) instead of a dotted string. Not clickable.
- **Cover** (`Cover` in `web/cover.tsx`). Square artwork with a tinted fallback that shows the title. Artists are round; playlists with four or more albums show a 2×2 grid. No borders, no text over real artwork.
- **Card** (`.card`, `.grid`, `.shelf`). A cover with a title and one sub line, straight on `bg`. A started book adds a progress bar; a finished one gets the accent check. Books, albums, podcasts and playlists share one size: grids are 3 across and shelves 2.5 across on phones. Continue listening cards are about a quarter bigger and show the title, author and time left.
- **Scroll row** (`ScrollRow`, web only). Wraps a shelf so a mouse gets round arrows at its ends while hovering, each hidden once that end is reached. Touch screens just swipe.
- **Mini player sub line** (`.mini-split`). A book's chapter and time left share one line; the chapter name gives way first.
- **List row** (`.list-row`, `.queue-row`). Thumbnail, bold title, one muted sub line, trailing controls (length, ⋯ menu, drag handle). The left part is the tap target. The playing row's title is `accent`.
- **Track list** (`.track-list`, `.chapter-list`). Numbered rows for an album's songs or a book's chapters, numbers right-aligned and tabular, no thumbnails.
- **Mini player** (`.mini`). Cover, title, sub line, transport and a 2px accent progress line. Books and episodes get skip back 10 / forward 30; songs get previous / next, never speed or skip-seconds.
- **Segmented tabs** (`Segmented`, `.segmented`). A full-width `surface` track with the chosen tab raised on `surface-2` in bold. For switching a whole screen between two views, like Stats and Settings on You; chips stay for filters and shelves.
- **Tab bar** (`.tabs`). The four tabs in a fixed order with their icons. Settings live on You, not in the bar.
- **Sheet** (`Sheet`, `SheetItem` in `web/sheet.tsx`). Rises from the bottom for item menus, one- or two-field forms and lists like Up Next. Items are verbs; a danger item goes last. Close it before acting and confirm with a toast. No browser dialogs. A sheet can carry a grey count, a sub line and one action (like Clear) in its title row; the title row stays put and only the content under it scrolls, at most 85% of the screen tall.
- **Player controls** (`.player-controls`). Books and episodes: previous chapter, skip back, play, skip forward, next chapter. An episode without chapters (most of them) uses the outer pair for previous and next instead: the item before or after it in Up Next, then the episode above or below it in its show's list. Songs: Repeat, previous, play, next, Shuffle. Shuffle and Repeat are muted icon buttons that turn `accent` when on; Repeat one adds a small 1 to the loop.
- **Playing mixer** (`Mixer`, `.mixer`). Five accent bars bouncing out of step on a dark disc, centered on the cover of the book, album, playlist or show that's playing; the card's title turns `accent`. Paused, the bars ease from where they were into the app icon's shape (full, ¾, about half, ¾, full) and stay there. The playing song's thumbnail in playlist and Songs rows gets the thumbnail version. In an album's track list, the bars alone (`MixerBars`, accent, no disc) take the playing song's number. On the playing row in Up Next it fills the thumbnail and shows Play while paused, since tapping that row pauses and resumes.
- **Up Next rows** (`web/up-next.tsx`). One running list: played rows in `faint` with a dimmed thumbnail, the playing row with the mixer and an `accent` title, then what's next. Each row: thumbnail, title (`Marquee`: scrolls sideways when it doesn't fit, ellipsis with reduced motion), artist or show with the length beside it, then X and the drag handle. No section labels. Reduced motion stops the bars.
- **Player tiles** (`.tile`). Speed, Sleep, Chapters or Ads, and Up Next with a grey count; each opens its control in place or in a sheet.
- **Settings card** (`SettingsCard`, `Setting`, `SettingSub`, `SettingLink`, `SwitchRow`, `StatusDot`; `.card-box`, `.setting`). Rows with a title, optional sub line, and a value with chevron, a switch or a button. One setting per row. A status dot before the title is green when fine, amber when it needs a look.
- **Confirm remove** (`ConfirmRemove`). A danger button that turns into Keep and the confirm button on the first click, for removing a folder or a user.
- **Form controls** (`.input`, `.switch`, checkboxes). 44px inputs on `surface` with a `line` border that turns `accent` on focus. Placeholders say what to type ("Playlist name"). Each form has one primary button.
- **Stats card** (`ListeningStats`, `StatTile`, `.stats-*`). Total and comparison, bars (current one `accent`), the books / podcasts / music split, then tiles. Hidden tabs hide their parts.
- **Browse row** (`.browse-row`). A full-width `surface` row with an icon tile, title, sub line, optional "N new" pill and chevron, leading to the rest of a catalogue. One per screen.
- **Empty state** (`EmptyState`; `.empty`, `.music-empty`). One bold line and one muted sentence, no illustrations, no blame.
