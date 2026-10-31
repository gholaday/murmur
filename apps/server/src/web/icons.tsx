import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg className="i" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

/** Google's cast mark; `connected` fills the screen while casting. */
export const CastIcon = ({ connected, ...p }: IconProps & { connected?: boolean }) => (
  <Icon {...p}>
    <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
    <path d="M2 12a9 9 0 0 1 8 8M2 16a5 5 0 0 1 4 4M2 20h.01" />
    {connected ? <path d="M6 8h12v8h-4a12 12 0 0 0-8-7z" fill="currentColor" stroke="none" /> : null}
  </Icon>
);

export const LibraryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 7v14" />
    <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H9a3 3 0 0 1 3 3 3 3 0 0 1 3-3h4.5A1.5 1.5 0 0 1 21 5.5v11a1.5 1.5 0 0 1-1.5 1.5H15a3 3 0 0 0-3 3 3 3 0 0 0-3-3H4.5A1.5 1.5 0 0 1 3 16.5z" />
  </Icon>
);
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </Icon>
);
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);
export const PodcastIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);
export const MusicIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Icon>
);
export const WatchIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="m10 9 5 3-5 3z" />
  </Icon>
);
export const PipIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <rect x="12" y="12" width="6" height="4" rx="1" />
  </Icon>
);
/** A video's audio track: a speech bubble. */
export const AudioTrackIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    <path d="M7 9h10M7 13h6" />
  </Icon>
);
export const FullscreenIcon = ({ exit, ...p }: IconProps & { exit?: boolean }) => (
  <Icon {...p}>
    {exit ? (
      <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
    ) : (
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    )}
  </Icon>
);
export const ShuffleIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m18 14 4 4-4 4M18 2l4 4-4 4M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
  </Icon>
);
export const RepeatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" />
  </Icon>
);
export const RepeatOneIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3M11 10h1v4" />
  </Icon>
);
export const QueueIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Icon>
);
/** The Up Next list with a plus to add to it, or a check once it's queued. */
export const QueueAddIcon = ({ queued, ...p }: IconProps & { queued?: boolean }) => (
  <Icon {...p}>
    <path d="M4 6h16M4 12h9M4 18h7" />
    {queued ? <path d="M14.5 17l2.5 2.5 4.5-5" /> : <path d="M18 13v8M14 17h8" />}
  </Icon>
);
/** A bookmark: plus to add a book to Play next, check once it's on the shelf. */
export const BookmarkAddIcon = ({ added, ...p }: IconProps & { added?: boolean }) => (
  <Icon {...p}>
    <path d="M6 4h12v16l-6-4-6 4z" />
    {added ? <path d="M9 10l2 2 4-4" /> : <path d="M12 7.5v5M9.5 10h5" />}
  </Icon>
);
/** A circled plus to add a song to a playlist, or a filled check once it's in. */
export const AddCircleIcon = ({ added, ...p }: IconProps & { added?: boolean }) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="10" fill={added ? "currentColor" : "none"} />
    {added ? <path d="M7.5 12.5l3 3 6-6.5" stroke="var(--on-accent)" /> : <path d="M12 8v8M8 12h8" />}
  </Icon>
);
/** A circled check, filled once played. */
export const PlayedIcon = ({ played, ...p }: IconProps & { played?: boolean }) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" fill={played ? "currentColor" : "none"} />
    <path d="M8 12.5l2.7 2.7L16 10" stroke={played ? "var(--on-accent)" : "currentColor"} />
  </Icon>
);
export const SettingsIcon =(p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Icon>
);
export const ProfileIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);
export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
);
export const FilterIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);
export const BackIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </Icon>
);
export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);
export const DownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </Icon>
);
export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />
  </Icon>
);
export const PauseIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12l5 5 9-10" />
  </Icon>
);
/** A speaker with 0–2 waves for the volume level, or a cross when muted. */
export const VolumeIcon = ({ level, ...p }: IconProps & { level: number }) => (
  <Icon {...p}>
    <path d="M4 9h3l5-4v14l-5-4H4z" />
    {level === 0 ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />}
    {level > 0.5 ? <path d="M18 6.5a8 8 0 0 1 0 11" /> : null}
  </Icon>
);
/** A shield with a check: the episode has been checked for ads. */
export const AdsCheckedIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
);
export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
);
export const SkipBackIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 12a8 8 0 1 0 2.3-5.6" />
    <path d="M4 4v4h4" />
  </Icon>
);
export const SkipForwardIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4v4h-4" />
  </Icon>
);
export const PrevChapterIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 5v14" />
    <path d="M18 6l-9 6 9 6z" />
  </Icon>
);
export const NextChapterIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 5v14" />
    <path d="M6 6l9 6-9 6z" />
  </Icon>
);
export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </Icon>
);
export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
/** Sliders: rearrange what a page shows. */
export const CustomizeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
);
export const DragIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 9h14M5 15h14" />
  </Icon>
);
export const ArchiveIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
  </Icon>
);
export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4v4h-4" />
  </Icon>
);
export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
  </Icon>
);

/**
 * The app icon: audio bars whose tops trace an M, on deep navy, same as the Android launcher icon.
 * Drawn on a 29 px grid so every bar edge lands on a whole pixel at its usual size; the 24-unit
 * icon.svg proportions blur at small sizes.
 */
export const AppIcon = ({ size = 29 }: { size?: number }) => (
  <svg viewBox="0 0 29 29" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
    <rect width="29" height="29" rx="7" fill="#141833" />
    <rect x="3" y="7" width="3" height="15" rx="1.5" fill="#8E9BFF" />
    <rect x="8" y="11" width="3" height="11" rx="1.5" fill="#8E9BFF" />
    <rect x="13" y="14" width="3" height="8" rx="1.5" fill="#8E9BFF" />
    <rect x="18" y="11" width="3" height="11" rx="1.5" fill="#8E9BFF" />
    <rect x="23" y="7" width="3" height="15" rx="1.5" fill="#8E9BFF" />
  </svg>
);
