import Svg, { Circle, Path, Rect } from "react-native-svg";

// Same drawings as the web player's icons (apps/server/src/web/icons.tsx).

type IconProps = { size?: number; color: string };

function Icon({ size = 24, color, children }: IconProps & { children: React.ReactNode }) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      color={color}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export const LibraryIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 7v14" />
    <Path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H9a3 3 0 0 1 3 3 3 3 0 0 1 3-3h4.5A1.5 1.5 0 0 1 21 5.5v11a1.5 1.5 0 0 1-1.5 1.5H15a3 3 0 0 0-3 3 3 3 0 0 0-3-3H4.5A1.5 1.5 0 0 1 3 16.5z" />
  </Icon>
);
export const AdsCheckedIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" />
    <Path d="M9 12l2 2 4-4" />
  </Icon>
);
export const PodcastIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="9" y="3" width="6" height="11" rx="3" />
    <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);
export const MusicIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M9 18V5l12-2v13" />
    <Circle cx="6" cy="18" r="3" />
    <Circle cx="18" cy="16" r="3" />
  </Icon>
);
export const BrowseIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="3" y="4" width="18" height="6" rx="2" />
    <Rect x="3" y="14" width="18" height="6" rx="2" />
    <Path d="M7 7h.01M7 17h.01" />
  </Icon>
);
export const ShuffleIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </Icon>
);
export const QueueIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 6h16M4 12h16M4 18h10" />
  </Icon>
);
/** A bookmark with a plus, or a check once the book is on Play next. */
export const PlayNextAddIcon = ({ on, ...p }: IconProps & { on?: boolean }) => (
  <Icon {...p}>
    <Path d="M6 4h12v16l-6-4-6 4z" />
    {on ? <Path d="M9.5 10l2 2 3.5-3.5" /> : <Path d="M12 8v5M9.5 10.5h5" />}
  </Icon>
);
export const ProfileIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="12" cy="8" r="4" />
    <Path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="11" cy="11" r="7" />
    <Path d="M20 20l-3.5-3.5" />
  </Icon>
);
export const FilterIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 6h16M7 12h10M10 18h4" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 5v14M5 12h14" />
  </Icon>
);
export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M5 12h14" />
  </Icon>
);
export const BackIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M19 12H5M11 18l-6-6 6-6" />
  </Icon>
);
export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M9 6l6 6-6 6" />
  </Icon>
);
export const DownIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M6 9l6 6 6-6" />
  </Icon>
);
export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="12" cy="5" r="1" />
    <Circle cx="12" cy="12" r="1" />
    <Circle cx="12" cy="19" r="1" />
  </Icon>
);
export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />
  </Icon>
);
export const PauseIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    <Rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M5 12l5 5 9-10" />
  </Icon>
);
export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
);
export const SkipBackIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 12a8 8 0 1 0 2.3-5.6" />
    <Path d="M4 4v4h4" />
  </Icon>
);
export const SkipForwardIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <Path d="M20 4v4h-4" />
  </Icon>
);
export const PrevChapterIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M6 5v14" />
    <Path d="M18 6l-9 6 9 6z" />
  </Icon>
);
export const NextChapterIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M18 5v14" />
    <Path d="M6 6l9 6-9 6z" />
  </Icon>
);
export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <Circle cx={12} cy={12} r={3} />
  </Icon>
);
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </Icon>
);
export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </Icon>
);
export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const CustomizeIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <Circle cx="15" cy="7" r="2" />
    <Circle cx="9" cy="17" r="2" />
  </Icon>
);
export const DragIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M5 9h14M5 15h14" />
  </Icon>
);
export const ArchiveIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="3" y="4" width="18" height="5" rx="1" />
    <Path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
  </Icon>
);
export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <Path d="M20 4v4h-4" />
  </Icon>
);
export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
  </Icon>
);
export const QueueAddIcon = ({ queued, ...p }: IconProps & { queued?: boolean }) => (
  <Icon {...p}>
    <Path d="M8 3h10a3 3 0 0 1 3 3v10" />
    <Rect x="3" y="7" width="14" height="14" rx="3" />
    {queued ? <Path d="M7 14l2.5 2.5L13 12" /> : <Path d="M10 11v6M7 14h6" />}
  </Icon>
);
/** A circled check, filled once played; `checkColor` draws the check on the fill. */
export const PlayedIcon = ({ played, checkColor, ...p }: IconProps & { played?: boolean; checkColor: string }) => (
  <Icon {...p}>
    <Circle cx="12" cy="12" r="9" fill={played ? p.color : "none"} />
    <Path d="M8 12.5l2.7 2.7L16 10" stroke={played ? checkColor : p.color} />
  </Icon>
);
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Icon>
);
