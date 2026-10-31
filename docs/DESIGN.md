# Murmur design system

Murmur is quiet and dark by default, close to a podcast app: covers do the colour work, one periwinkle accent marks what is selected or playing, and everything else stays out of the way. Follow what already exists. A new screen reuses these tokens and components before it invents anything, on the web and in the Android app alike.

The values below come from [`apps/server/src/app/globals.css`](../apps/server/src/app/globals.css) (web) and [`apps/mobile/src/theme.ts`](../apps/mobile/src/theme.ts) (app), which are the source of truth. Change a value there and here together.

## Writing

- **Plain words, sentence case.** Titles, buttons and labels are sentence case ("Continue listening", "Add to playlist"). Eyebrow labels are typed in sentence case and uppercased by CSS.
- **Talk to the listener as "you".** "Your music", "Your queue is empty", "48 albums you haven't added". Never "the user", never "I".
- **Name things the way a listener does.** Say "server" or "Downloaded", never "NAS". The music screens never mention the server at all.
- **Controls say exactly what they do, and toasts confirm it.** "Add to Play next", "Add to queue", "Remove from this playlist", then a toast "Removed from the playlist" with Undo. "Delete playlist" is the danger item, and the toast says "Deleted Road trip".
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
| `stat-4` | `#e27fae` | `#b03a72` | Watch in the listening stats |
| `nav` | `#17181b` | `#ffffff` | The tab bar and sidebar |
| `tab-inactive` | `#9a9aa0` | `#8a8984` | Unselected tabs. Only 3.5:1 on light `nav` |

Fixed colours used in both themes: `#5ccf8a` success and `#f0b45a` warning (status dots, match scores; both read poorly on white, so pair them with words), and the ad colours `#ef9f27`, `#ba7517` (already played) and `#412402` (text on the Skip ad button).

**How to use them.** Build every screen from the same grounds: `bg` for the page, `surface` for raised cards and sheets, `surface-2` for buttons and the mini player, `chip` for chips and pills. `accent` is the only hue in the chrome. `stat-2`, `stat-3` and `stat-4` only tell podcasts, music and Watch apart in the stats.

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
- Podcasts, Music and Watch are shown or hidden per person under Tabs, and nothing else hides them; Music and Watch start hidden. When one is hidden, its tab and its parts of You go away. A shown tab with no folder has an empty state; for admins it names the folder to mount (`/music`, or `/movies` and `/shows`), since folders are set up in the compose file.
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

- **Button** (`.btn`, `.btn-primary`, `.btn-big`, `.btn-round`, `.btn-outline`, `.btn-small`, `.btn-danger`). One primary big button per screen (Play, Continue, Make playlist), usually with a round Shuffle beside it. While that book, album or playlist is the one playing, Play reads Pause, or Resume when paused. Starting it opens the full player; Pause and Resume stay on the page. Plain buttons for secondary actions, outline for a quiet add action under a list. Labels are verbs that say what happens, never "OK" or "Submit".
- **Icon button** (`.icon-btn`). 44px round, one 24px icon, an `aria-label`. For search, sort, ⋯ and the back arrow. Use a text button when no familiar icon says the action.
- **Back** (`BackButton`, `BackRow`, `NestedHead`). The arrow goes back, or to a fallback screen when the page was opened directly. `NestedHead` is a nested screen's whole head: the back row, then the title with its count, a sub line and actions on the right.
- **Chip** (`Chips`, `Chip`; `.chip`, `.chips`). Switches between views of the same content: Books / Authors / Series / Finished, Playlists / Albums / Artists / Songs (opening on Albums), Week / Month / Year / All time. One selected per row, never an action. `Chips` takes a kind: `tabs` for views, `radio` for picking one setting, `toggle` for fields turned on and off one by one. Admin lists (Needs attention, Not matched) aren't chips: they're rows in You > Library.
- **Badge** (`CountPill`, `SectionTitle`, `TitleWithCount`; `.count-pill`, `.tab-count`, `.badge-count`, `.new-pill`). Grey counts what's in a list; accent flags something new or waiting. No count next to a tab's page title. `SectionTitle` is a section heading with its count, as a button when it opens the full list.
- **Search box** (`SearchBox`). Opens under the page head from the search button, focused, with a placeholder that says what it searches. No results reads `Nothing matches "<query>".` everywhere.
- **Pill** (`.pill`, `.pills`). Two or three short facts in a header (1977, 11 songs, 39m) instead of a dotted string. Not clickable. A pill can lead with a small accent icon, like the lock on a private show's Private pill.
- **Cover** (`Cover` in `web/cover.tsx`). Square artwork with a tinted fallback that shows the title. Artists are round; playlists with four or more albums show a 2×2 grid. No borders, no text over real artwork.
- **Card** (`.card`, `.grid`, `.shelf`). A cover with a title and one sub line, straight on `bg`. A started book adds a progress bar; a finished one gets the accent check. Books, albums, podcasts and playlists share one size: grids are 3 across and shelves 2.5 across on phones. Continue listening cards are about a quarter bigger and show the title, author and time left. Book, album, movie and show cards all open their item's menu the same way (`CardMenu` in `web/card-menu.tsx`): ⋯ in the top right corner or a right-click on the web, a long press with a haptic in the app. Admin items come last after a divider and say Edit… and Match…. The ⋯ on the item's page opens the same items in a sheet (`MenuSheet`), for everyone.
- **Scroll row** (`ScrollRow`, web only). Wraps a shelf so a mouse gets round arrows at its ends while hovering, each hidden once that end is reached. Touch screens just swipe.
- **Shelves.** A section title over a shelf of cards; an empty shelf isn't shown at all, and one that can't be built is left off without touching the rest of the page. "More like" names its item ("More like Perelandra"); Customize lists it under that title too. Short listens' cards show the length as their sub line. Music Home stacks Jump back in (album and playlist cards), On repeat (five song rows; picking one queues the whole list of up to 25), More like *album* (album cards with the add button), More like *artist* (artist cards: a round photo, else one of their covers, else a person icon, with the name and album count centred under it, `.artist-card`) and New albums (album cards with the add button). On a movie page the collection shelf marks the current film with an accent title (`.card-current`).
- **New tile** (`.new-tile`). Making something new from a grid is its first tile: a cover-sized `surface-2` square (the cover placeholder colour, so it reads in both themes) with an accent plus and no outline, its name below as the card title. Used for New playlist.
- **Mini player sub line** (`.mini-split`). A book's chapter and time left share one line; the chapter name gives way first.
- **List row** (`.list-row`, `.queue-row`). Thumbnail, bold title, one muted sub line, trailing controls (length, ⋯ menu, drag handle). The left part is the tap target. The playing row's title is `accent`.
- **Track list** (`.track-list`, `.chapter-list`). Numbered rows for an album's songs or a book's chapters, numbers right-aligned and tabular, no thumbnails.
- **Mini player** (`.mini`). Cover, title, sub line, transport and a 2px accent progress line. Books and episodes get skip back 10 / forward 30; songs get previous / next, never speed or skip-seconds.
- **Segmented tabs** (`Segmented`, `.segmented`). A full-width `surface` track with the chosen tab raised on `surface-2` in bold. For switching a whole screen between two views, like Stats and Settings on You; chips stay for filters and shelves.
- **Tab bar** (`.tabs`). The four tabs in a fixed order with their icons. Settings live on You, not in the bar.
- **Sheet** (`Sheet`, `SheetItem` in `web/sheet.tsx`). Rises from the bottom for item menus, one- or two-field forms and lists like the queue. Items are verbs; a danger item goes last. Rows have no lines between them, only a highlight on hover, press or keyboard focus (no focus ring), and the content scrolls without a scrollbar; the one divider sits before admin items. Close it before acting and confirm with a toast. No browser dialogs. A sheet can carry a grey count, a sub line and one action (like Clear) in its title row; the title row stays put and only the content under it scrolls, at most 85% of the screen tall.
- **Player controls** (`.player-controls`). Books and episodes: previous chapter, skip back, play, skip forward, next chapter. An episode without chapters (most of them) uses the outer pair for previous and next instead: the item before or after it in the queue, then the episode above or below it in its show's list. Songs: Repeat, previous, play, next, Shuffle. Shuffle and Repeat are muted icon buttons that turn `accent` when on; Repeat one adds a small 1 to the loop.
- **Playing mixer** (`Mixer`, `.mixer`). Five accent bars bouncing out of step on a dark disc, centered on the cover of the book, album, playlist or show that's playing; the card's title turns `accent`. Paused, the bars ease from where they were into the app icon's shape (full, ¾, about half, ¾, full) and stay there. The playing song's thumbnail in playlist and Songs rows gets the thumbnail version. In an album's track list, the bars alone (`MixerBars`, accent, no disc) take the playing song's number. On the playing row in the queue it fills the thumbnail and shows Play while paused, since tapping that row pauses and resumes.
- **Queue rows** (`web/up-next.tsx`). One running list: played rows in `faint` with a dimmed thumbnail, the playing row with the mixer and an `accent` title, then what's next. Each row: thumbnail, title (`Marquee`: scrolls sideways when it doesn't fit, ellipsis with reduced motion), artist or show with the length beside it, then X and the drag handle. No section labels. Reduced motion stops the bars.
- **Volume row** (`VolumeRow`, `.vol-row`). The web audio player's volume, under the controls on desktop: a mute button showing the soft speaker, a slider, and the loud speaker at the far end, so the title keeps its full width. Hidden on touch screens. The video player keeps its speaker button that slides a slider out on hover.
- **Player tiles** (`.tile`). Speed, Sleep, a third slot, and Queue with a grey count; each opens its control in place or in a sheet. The slot is Chapters for books and for episodes with chapters, else Ads if the show is scanned, else empty, and then the three tiles stretch to share the row (`.player-tiles.fill`). The order never changes, and the slot is decided when the item loads so nothing pops in mid-listen. The ad setting also sits in the episode's ⋯ menu as a row with its value and a chevron.
- **Chapter scrubber** (`.scrub-segs`, `.scrub-seg`). An episode with chapters gets one segment per chapter across the whole bar, with small gaps between: played ones solid, the current one filling, the rest faint, with ad marks on top. The playing chapter's title takes the middle of the times row in place of the time left (`.player-chapter-line`, 12 / 700, ellipsis; tap for the list). While dragging, the current segment thickens and the times row shows the title of the chapter under the thumb in `accent`. On the web, hovering with a mouse does the same for the spot under the pointer, and a later chapter's segment lights up in `accent` (`.scrub-seg.hovered`). A book's bar spans its current chapter, with the chapter's name as the line under the title (the Chapters tile opens the list).
- **Chapter list** (`.chapter-list`). Number, title on one line with an ellipsis, and length. Played rows are muted, and the current row has an `accent` title, with `MixerBars` in place of its number. The sheet title carries a grey count. Video has no speed: its tiles are Audio, Pop out and Full screen.
- **Floating card** (`.float-card`). A short note with one `accent` text action and an X, floating just above a player's bottom tiles so nothing moves when it comes and goes; it fades in and stays dismissed until what it's about changes. Only where there's empty space above the tiles (the video player's "Converting slower than it plays"); the audio player has none on a phone, so it uses a cover pill.
- **Cover pill** (`.skip-ad`, `.finish-pill`). A small pill in the cover's bottom-right corner for a timely one-tap action, so the controls never move: Skip ad (ad colours) while an ad plays, and Mark played (`accent`, with a check; both icons sit after the text) in an episode's last 3 minutes. When both apply they stack (`.cover-pills`), Mark played on top. Skip ad goes once less than a second is left, since an ad that runs to the end has nothing to skip to.
- **Player top row** (`.player-top`). Close on the left, the "Playing from Books" eyebrow centred ("Finished" once a book has stopped at its end), and the cast button and ⋮ menu on the right.
- **Cast button** (`CastButton`). Google's cast mark, only there when a Chromecast is found; `accent` with its screen filled while casting. While casting, the eyebrow reads "Playing on Living Room", the mini player's sub line is a small accent cast mark and the device name, and the video stage shows the backdrop at 45% with a white cast mark.
- **Settings card** (`SettingsCard`, `Setting`, `SettingSub`, `SettingLink`, `SwitchRow`, `StatusDot`; `.card-box`, `.setting`). Rows with a title, optional sub line, and a value with chevron, a switch or a button. One setting per row. A status dot before the title is green when fine, amber when it needs a look. Rescan buttons always carry the refresh icon before the word, and it spins while the scan runs.
- **Confirm sheet** (`ConfirmSheet`, web and app). Asks before something can't be undone: a title ending in a question mark ("Delete Road trip?"), one line on what happens, then Cancel and the action: danger for removing something, primary for signing out. Used for signing out, removing a user, deleting a playlist and unsubscribing.
- **Form controls** (`.input`, `.switch`, checkboxes). 44px inputs on `surface` with a `line` border that turns `accent` on focus. Placeholders say what to type ("Playlist name"). Each form has one primary button.
- **Stats card** (`ListeningStats`, `StatTile`, `.stats-*`). Period chips, then a card: the total and the comparison with the period before, a chart with each bar stacked by kind (books, podcasts, music, Watch in `accent`, `stat-2`, `stat-3`, `stat-4`, books at the bottom; today's label bold), and a 2×2 legend that is also the filter. Picking a kind outlines it in its colour, fades the others, and turns the total, chart, tiles and top cards to that kind, with Show all to go back. Then tiles (Streak, Daily average, one count per kind with its dot; or the picked kind's counts and daily average), then Top this week as two-column cards with a square cover and the kind as a small uppercase label. A hidden tab leaves its kind out everywhere, the total included; with only books left there's no legend. Your library follows, three tiles to a row.
- **Episode rows** (`.episode-row`). A 16:9 still with a progress bar, then the title over "S1 E2, 31m" in a smaller muted line, both sitting on the still's bottom edge, and a watched toggle on the right. The video player's Next episodes list uses the same row and scrolls with a thin bar and no arrows; on short windows the picture shrinks so a row and a half still show.
- **Browse row** (`.browse-row`). A full-width `surface` row with an icon tile, title, sub line, optional "N new" pill and chevron, leading to the rest of a catalogue. One per screen.
- **Empty state** (`EmptyState`; `.empty`, `.music-empty`). One bold line and one muted sentence, no illustrations, no blame.
