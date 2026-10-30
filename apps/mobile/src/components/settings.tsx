import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Switch, View } from "react-native";
import Constants from "expo-constants";
import { type Href, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import {
  adScanStatus,
  type EpisodeCacheStatusDto,
  errorText,
  type FolderBrowseDto,
  type FolderCheckDto,
  gigabytes,
  type HealthDto,
  joinPath,
  KEEP_PER_SHOW_OPTIONS,
  type LibraryAdminDto,
  type LibraryFolderDto,
  plural,
  type ScanStatusDto,
  scanStatusText,
  type ServerVersionDto,
  type UserDto,
  versionStatus,
} from "@murmur/shared/client";
import { api } from "@/lib/api";
import { selectHaptic } from "@/lib/haptics";
import { APP_NAME } from "@/lib/platform";
import { queryClient } from "@/lib/query";
import { fonts, useTheme } from "@/theme";
import { BackIcon, CheckIcon, ChevronIcon, FolderIcon, RefreshIcon } from "./icons";
import { ConfirmSheet, Sheet } from "./sheet";
import { Bone, FadeIn, Skeleton } from "./skeleton";
import { toast } from "./toast";
import { Button, Chips, Field, Text } from "./ui";

// Building blocks for the Settings tab, and the sections that talk to the server:
// changing your password, and for admins the library and users.

export function Card({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <View style={{ backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: 16 }}>{children}</View>;
}

export function Row({
  title,
  sub,
  subDanger,
  stacked,
  last,
  dot,
  children,
}: {
  title: string;
  sub?: string | null;
  subDanger?: boolean;
  stacked?: boolean;
  /** A status dot's colour, shown before the title. */
  dot?: string | null;
  /** The last row in a card has no divider under it. */
  last?: boolean;
  children?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: stacked ? 10 : 12,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.line,
      }}
    >
      <View style={{ flexShrink: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
          <Text variant="bodyStrong">{title}</Text>
        </View>
        {sub ? (
          <Text variant="small" style={subDanger ? { color: t.danger } : undefined}>
            {sub}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A setting that's on or off, with a switch on the right. `label` is read out for the switch. */
export function SwitchRow({
  title,
  sub,
  label,
  value,
  onChange,
  last,
}: {
  title: string;
  sub?: string | null;
  label: string;
  value: boolean;
  onChange: (on: boolean) => void;
  last?: boolean;
}) {
  const t = useTheme();
  return (
    <Row title={title} sub={sub} last={last}>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={(on) => {
          selectHaptic();
          onChange(on);
        }}
        trackColor={{ false: t.track, true: t.accent }}
        thumbColor={value ? t.onAccent : t.faint}
      />
    </Row>
  );
}

/** A setting row's placeholder while it loads: title, sub-line and button, in Row's spacing. */
function RowBone({ last }: { last?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.line,
      }}
    >
      <View style={{ flex: 1, gap: 8 }}>
        <Bone width="45%" height={15} />
        <Bone width="30%" height={12} />
      </View>
      <Bone width={84} height={38} radius={19} />
    </View>
  );
}

export function SmallButton({
  label,
  onPress,
  danger,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  primary?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 38,
        paddingHorizontal: 16,
        borderRadius: 19,
        justifyContent: "center",
        backgroundColor: primary ? t.accent : pressed ? t.surface2 : t.chip,
        opacity: disabled ? 0.45 : primary && pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: primary ? t.onAccent : danger ? t.danger : t.text }}>{label}</Text>
    </Pressable>
  );
}

export function RolePill({ admin }: { admin: boolean }) {
  const t = useTheme();
  return (
    <View style={{ height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: "center", backgroundColor: admin ? t.accent : t.chip }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: admin ? t.onAccent : t.muted }}>{admin ? "Admin" : "Listener"}</Text>
    </View>
  );
}

/** App-styled checkbox: a rounded square that fills with the accent colour when ticked. */
export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          borderWidth: checked ? 0 : 1.5,
          borderColor: t.muted,
          backgroundColor: checked ? t.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <CheckIcon size={14} color={t.onAccent} /> : null}
      </View>
      <Text variant="bodyStrong" style={{ fontSize: 15, flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const passwordProps = { secureTextEntry: true, autoCapitalize: "none", autoCorrect: false, spellCheck: false } as const;

/** Account row for changing your password; other devices are signed out, this one stays. */
export function PasswordRow() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTheme();

  const close = () => {
    setOpen(false);
    setCurrent("");
    setNext("");
    setRepeat("");
    setError(null);
  };

  const submit = async () => {
    if (next.length < 8) return setError("The new password needs at least 8 characters.");
    if (next !== repeat) return setError("The new passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/me/password", { method: "PUT", body: { currentPassword: current, newPassword: next } });
      close();
      toast.show("Password changed. Other devices were signed out.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Row title="Password">
        <SmallButton label="Change" onPress={() => setOpen(true)} />
      </Row>
      <Sheet open={open} onClose={close} title="Change password">
        <View style={{ paddingHorizontal: 12, gap: 12, paddingBottom: 8 }}>
          <Field label="Current password" value={current} onChangeText={setCurrent} autoComplete="current-password" {...passwordProps} />
          <Field label="New password" placeholder="8 or more characters" value={next} onChangeText={setNext} autoComplete="new-password" {...passwordProps} />
          <Field label="Repeat new password" value={repeat} onChangeText={setRepeat} autoComplete="new-password" {...passwordProps} />
          {error ? (
            <Text variant="small" style={{ color: t.danger }} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label="Change password" onPress={() => void submit()} busy={busy} disabled={!current || !next || !repeat} />
        </View>
      </Sheet>
    </>
  );
}

// ---------- Server ----------

// Status dots, the same in light and dark.
const OK_DOT = "#5ccf8a";
const WARN_DOT = "#f0b45a";

/**
 * The server's version, and for admins whether a newer release is out; then this app's own
 * version, so an old APK is easy to spot.
 */
export function ServerSection() {
  const query = useServerVersion();
  const v = query.data;
  const status = v ? versionStatus(v) : null;
  const update = v?.updates?.update;
  return (
    <Card>
      {v && status ? (
        <Row title={`Murmur ${v.version}`} sub={status.sub} dot={status.dot === "warn" ? WARN_DOT : status.dot === "ok" ? OK_DOT : null}>
          {update ? <SmallButton label="What's new" onPress={() => void Linking.openURL(update.url)} /> : null}
        </Row>
      ) : query.isError ? (
        <Row title="Server version" sub={query.error.message} subDanger />
      ) : (
        <Skeleton>
          <RowBone />
        </Skeleton>
      )}
      <Row title={APP_NAME} sub={`Version ${Constants.expoConfig?.version ?? "unknown"}`} last />
    </Card>
  );
}

/** TMDB's terms ask for their logo and this notice wherever their data shows. */
export function TmdbCredit() {
  return (
    <Card>
      <View style={{ paddingVertical: 14, gap: 6 }}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="TMDB"
          hitSlop={10}
          onPress={() => void Linking.openURL("https://www.themoviedb.org")}
          style={({ pressed }) => ({ alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}
        >
          <TmdbLogo height={12} />
        </Pressable>
        <Text variant="small">This product uses the TMDB API but is not endorsed or certified by TMDB.</Text>
      </View>
    </Card>
  );
}

/** TMDB's official short logo (blue_short), as they publish it. */
function TmdbLogo({ height }: { height: number }) {
  return (
    <Svg width={(height * 273.42) / 35.52} height={height} viewBox="0 0 273.42 35.52">
      <Defs>
        <LinearGradient id="tmdb" x1="0" y1="17.76" x2="273.42" y2="17.76" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#90cea1" />
          <Stop offset="0.56" stopColor="#3cbec9" />
          <Stop offset="1" stopColor="#00b3e5" />
        </LinearGradient>
      </Defs>
      <Path
        fill="url(#tmdb)"
        d="M191.85,35.37h63.9A17.67,17.67,0,0,0,273.42,17.7h0A17.67,17.67,0,0,0,255.75,0h-63.9A17.67,17.67,0,0,0,174.18,17.7h0A17.67,17.67,0,0,0,191.85,35.37ZM10.1,35.42h7.8V6.92H28V0H0v6.9H10.1Zm28.1,0H46V8.25h.1L55.05,35.4h6L70.3,8.25h.1V35.4h7.8V0H66.45l-8.2,23.1h-.1L50,0H38.2ZM89.14.12h11.7a33.56,33.56,0,0,1,8.08,1,18.52,18.52,0,0,1,6.67,3.08,15.09,15.09,0,0,1,4.53,5.52,18.5,18.5,0,0,1,1.67,8.25,16.91,16.91,0,0,1-1.62,7.58,16.3,16.3,0,0,1-4.38,5.5,19.24,19.24,0,0,1-6.35,3.37,24.53,24.53,0,0,1-7.55,1.15H89.14Zm7.8,28.2h4a21.66,21.66,0,0,0,5-.55A10.58,10.58,0,0,0,110,26a8.73,8.73,0,0,0,2.68-3.35,11.9,11.9,0,0,0,1-5.08,9.87,9.87,0,0,0-1-4.52,9.17,9.17,0,0,0-2.63-3.18A11.61,11.61,0,0,0,106.22,8a17.06,17.06,0,0,0-4.68-.63h-4.6ZM133.09.12h13.2a32.87,32.87,0,0,1,4.63.33,12.66,12.66,0,0,1,4.17,1.3,7.94,7.94,0,0,1,3,2.72,8.34,8.34,0,0,1,1.15,4.65,7.48,7.48,0,0,1-1.67,5,9.13,9.13,0,0,1-4.43,2.82V17a10.28,10.28,0,0,1,3.18,1,8.51,8.51,0,0,1,2.45,1.85,7.79,7.79,0,0,1,1.57,2.62,9.16,9.16,0,0,1,.55,3.2,8.52,8.52,0,0,1-1.2,4.68,9.32,9.32,0,0,1-3.1,3A13.38,13.38,0,0,1,152.32,35a22.5,22.5,0,0,1-4.73.5h-14.5Zm7.8,14.15h5.65a7.65,7.65,0,0,0,1.78-.2,4.78,4.78,0,0,0,1.57-.65,3.43,3.43,0,0,0,1.13-1.2,3.63,3.63,0,0,0,.42-1.8A3.3,3.3,0,0,0,151,8.6a3.42,3.42,0,0,0-1.23-1.13A6.07,6.07,0,0,0,148,6.9a9.9,9.9,0,0,0-1.85-.18h-5.3Zm0,14.65h7a8.27,8.27,0,0,0,1.83-.2,4.67,4.67,0,0,0,1.67-.7,3.93,3.93,0,0,0,1.23-1.3,3.8,3.8,0,0,0,.47-1.95,3.16,3.16,0,0,0-.62-2,4,4,0,0,0-1.58-1.18,8.23,8.23,0,0,0-2-.55,15.12,15.12,0,0,0-2.05-.15h-5.9Z"
      />
    </Svg>
  );
}

// ---------- Admin: library ----------

const libraryKeys = { health: ["health"], admin: ["library-admin"], folders: ["library-folders"], users: ["users"], cache: ["episode-cache"] } as const;

// Shared by the sections and the You tab's rows, which show a short value from them.
export const useServerVersion = () => useQuery({ queryKey: ["server-version"], queryFn: () => api<ServerVersionDto>("/api/server/version") });
export const useHealth = (enabled = true) => useQuery({ queryKey: libraryKeys.health, queryFn: () => api<HealthDto>("/api/health"), enabled });
export const useEpisodeCache = (enabled = true) =>
  useQuery({ queryKey: libraryKeys.cache, queryFn: () => api<EpisodeCacheStatusDto>("/api/server/cache"), enabled });
export const useUsers = (enabled = true) => useQuery({ queryKey: libraryKeys.users, queryFn: () => api<UserDto[]>("/api/users"), enabled });

/** Admin: how many recent episodes the server keeps ready per show, and how ad detection is doing. */
export function EpisodeCacheSection() {
  const t = useTheme();
  const cache = useEpisodeCache();
  const [busy, setBusy] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: libraryKeys.cache });

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast.show(done);
      refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const c = cache.data;
  if (!c) {
    return (
      <Card>
        {cache.isError ? (
          <Row title="Episodes kept ready per show" sub={cache.error.message} subDanger last />
        ) : (
          <Skeleton>
            <RowBone last />
          </Skeleton>
        )}
      </Card>
    );
  }
  const { ads } = c;
  // Measured from when this status was fetched.
  const scan = adScanStatus(ads, cache.dataUpdatedAt);

  return (
    <FadeIn>
      <Card>
        <Row
          title="Episodes kept ready per show"
          sub={c.available ? `${gigabytes(c.usedBytes)} of ${gigabytes(c.maxBytes)} used` : c.error}
          subDanger={!c.available}
          stacked
          last={!ads.enabled}
        >
          <Chips
            kind="radio"
            wrap
            options={KEEP_PER_SHOW_OPTIONS.map((n) => ({ id: n, label: n === 0 ? "Off" : String(n) }))}
            value={c.settings.episodesPerShow}
            onPick={(n) => {
              if (busy || c.settings.episodesPerShow === n) return;
              void run(() => api("/api/server/cache", { method: "PUT", body: { episodesPerShow: n } }));
            }}
          />
        </Row>
        {ads.enabled ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 14 }}>
            <View style={{ flexShrink: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: scan.state === "ok" ? OK_DOT : WARN_DOT }} />
                <Text variant="bodyStrong">Ad detection</Text>
              </View>
              <Text variant="small" style={scan.state === "error" ? { color: t.danger } : undefined}>
                {scan.text}
              </Text>
              {scan.groqText ? (
                <Text variant="small" style={scan.groqStuck ? { color: t.danger } : undefined}>
                  {scan.groqText}
                </Text>
              ) : null}
              <Text variant="small">{scan.counts}</Text>
            </View>
            {ads.failed ? (
              <SmallButton
                label="Retry"
                disabled={busy}
                onPress={() => void run(() => api("/api/server/ads/retry", { method: "POST" }), "Failed scans will run again.")}
              />
            ) : null}
          </View>
        ) : null}
      </Card>
    </FadeIn>
  );
}

/** The kinds of folder the server reads, as the web lists them under You > Library. */
const FOLDER_KINDS = {
  books: { url: "/api/library/folders", item: "book", things: "books", title: "Add a library folder", min: 1, refresh: [["books"]] },
  music: { url: "/api/music/folders", item: "album", things: "albums", title: "Add a music folder", min: 0, refresh: [["music"], ["albums"]] },
  movies: { url: "/api/watch/folders/movies", item: "movie", things: "movies", title: "Add a movie folder", min: 0, refresh: [["watch"]] },
  shows: { url: "/api/watch/folders/shows", item: "show", things: "shows", title: "Add a show folder", min: 0, refresh: [["watch"]] },
} as const;
type FolderKind = keyof typeof FOLDER_KINDS;
const KIND_LIST = Object.keys(FOLDER_KINDS) as FolderKind[];

const folderKey = (kind: FolderKind) => [...libraryKeys.folders, kind];
const useFolders = (kind: FolderKind) => useQuery({ queryKey: folderKey(kind), queryFn: () => api<LibraryFolderDto[]>(FOLDER_KINDS[kind].url) });

/** After a change: the counts now, and again once the scan it starts has had a moment. */
function refreshSoon(kind: FolderKind) {
  const run = () => {
    void queryClient.invalidateQueries({ queryKey: libraryKeys.health });
    void queryClient.invalidateQueries({ queryKey: libraryKeys.admin });
    void queryClient.invalidateQueries({ queryKey: libraryKeys.folders });
    for (const key of FOLDER_KINDS[kind].refresh) void queryClient.invalidateQueries({ queryKey: key });
  };
  run();
  setTimeout(run, 3000);
}

export const useLibraryAdmin = () =>
  useQuery({
    queryKey: libraryKeys.admin,
    queryFn: () => api<LibraryAdminDto>("/api/library/admin"),
    // While any kind scans, so its row spins and then shows the new counts.
    refetchInterval: (q) => (q.state.data && SCAN_KINDS.some((k) => q.state.data![k].scan.running) ? SCAN_POLL_MS : false),
  });

const SCAN_POLL_MS = 2000;
const SCAN_KINDS = ["books", "music", "watch"] as const;
type ScanKind = (typeof SCAN_KINDS)[number];
const SCAN_URL: Record<ScanKind, string> = { books: "/api/library/scan", music: "/api/music/scan", watch: "/api/watch/scan" };

/**
 * You > Library for admins, like the web: Books, Music, and Movies and shows, each with its count,
 * scan and Rescan, what needs a look, and its folders.
 */
export function LibrarySection() {
  const admin = useLibraryAdmin();
  const health = useHealth();
  const lists: Record<FolderKind, LibraryFolderDto[] | undefined> = {
    books: useFolders("books").data,
    music: useFolders("music").data,
    movies: useFolders("movies").data,
    shows: useFolders("shows").data,
  };
  // Every other kind's folders, which a new folder may not overlap.
  const besides = (kind: FolderKind) => KIND_LIST.filter((k) => k !== kind).flatMap((k) => (lists[k] ?? []).map((f) => f.path));
  const a = admin.data;
  const video = health.data?.watch?.status;

  // Each kind's card: its rows once loaded, a placeholder of the same rows before.
  const card = (rows: number, body: (a: LibraryAdminDto) => React.ReactNode) => (
    <Card>
      {a ? (
        <FadeIn>{body(a)}</FadeIn>
      ) : admin.isError ? (
        <Row title="Library" sub={admin.error.message} subDanger last />
      ) : (
        <Skeleton>
          {Array.from({ length: rows }, (_, i) => (
            <RowBone key={i} last={i === rows - 1} />
          ))}
        </Skeleton>
      )}
    </Card>
  );

  return (
    <View style={{ gap: 10 }}>
      <Text variant="heading">Books</Text>
      {card(3, (a) => (
        <>
          <ScanRow kind="books" title={plural(a.books.total, "book")} scan={a.books.scan} />
          <LinkRow
            title="Needs attention"
            dot={a.books.attention ? WARN_DOT : null}
            value={plural(a.books.attention, "book")}
            href={{ pathname: "/library-list", params: { list: "attention" } }}
          />
          <LinkRow title="Not matched" value={plural(a.books.unmatched, "book")} href={{ pathname: "/library-list", params: { list: "unmatched" } }} last />
        </>
      ))}
      <FoldersCard kind="books" list={lists.books} otherPaths={besides("books")} />

      <Text variant="heading" style={{ marginTop: 14 }}>
        Music
      </Text>
      {card(2, (a) => (
        <>
          <ScanRow kind="music" title={plural(a.music.albums, "album")} scan={a.music.scan} />
          <LinkRow title="Not matched" value={plural(a.music.unmatched, "album")} href={{ pathname: "/library-list", params: { list: "albums" } }} last />
        </>
      ))}
      {lists.music?.length === 0 ? <Text variant="small">Albums come from the songs&apos; tags, or from Artist/Album folders when there are none.</Text> : null}
      <FoldersCard kind="music" list={lists.music} otherPaths={besides("music")} />

      <Text variant="heading" style={{ marginTop: 14 }}>
        Movies and shows
      </Text>
      {card(1, (a) => (
        <>
          <ScanRow kind="watch" title={`${plural(a.watch.movies, "movie")} and ${plural(a.watch.shows, "show")}`} scan={a.watch.scan} last={!video} />
          {video ? <Row title="Video" dot={video.problem ? WARN_DOT : OK_DOT} sub={video.problem ?? video.working} subDanger={!!video.problem} last /> : null}
        </>
      ))}
      {lists.movies?.length === 0 && lists.shows?.length === 0 ? (
        <Text variant="small">Movies go in &quot;Title (Year)&quot; folders, and shows in Show/Season folders.</Text>
      ) : null}
      <FoldersCard kind="movies" list={lists.movies} otherPaths={besides("movies")} />
      <FoldersCard kind="shows" list={lists.shows} otherPaths={besides("shows")} />
    </View>
  );
}

/** A kind's count and scan status, with Rescan; its icon spins until the scan is done. */
function ScanRow({ kind, title, scan, last }: { kind: ScanKind; title: string; scan: ScanStatusDto; last?: boolean }) {
  const [asked, setAsked] = useState(false);
  const running = asked || scan.running;
  // When a scan finishes, everything it could have changed is fetched again.
  const was = useRef(scan.running);
  useEffect(() => {
    if (was.current && !scan.running) void queryClient.invalidateQueries();
    was.current = scan.running;
  }, [scan.running]);

  const rescan = async () => {
    setAsked(true);
    try {
      await api(SCAN_URL[kind], { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: libraryKeys.admin });
      // A scan with nothing new can be over before the counts are fetched again.
      if (!queryClient.getQueryData<LibraryAdminDto>(libraryKeys.admin)?.[kind].scan.running) void queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setAsked(false);
    }
  };

  return (
    <Row title={title} dot={scan.lastError ? WARN_DOT : null} sub={running ? "Scanning now" : scanStatusText(scan)} subDanger={!running && !!scan.lastError} last={last}>
      <RescanButton spinning={running} onPress={() => void rescan()} />
    </Row>
  );
}

function RescanButton({ spinning, onPress }: { spinning: boolean; onPress: () => void }) {
  const t = useTheme();
  const spin = useSharedValue(0);
  useEffect(() => {
    if (spinning) spin.set(withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1));
    else {
      cancelAnimation(spin);
      spin.set(withTiming(0, { duration: 200 }));
    }
  }, [spinning, spin]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spinning ? "Scanning" : "Rescan"}
      accessibilityState={{ disabled: spinning, busy: spinning }}
      disabled={spinning}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 38,
        paddingHorizontal: 14,
        borderRadius: 19,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: pressed ? t.surface2 : t.chip,
      })}
    >
      <Animated.View style={style}>
        <RefreshIcon size={16} color={t.text} />
      </Animated.View>
      <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: t.text }}>Rescan</Text>
    </Pressable>
  );
}

/** A row that opens another screen, with its current value when there's a short one. */
export function LinkRow({ title, value, dot, href, last }: { title: string; value?: string | null; dot?: string | null; href: Href; last?: boolean }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={value ? `${title}, ${value}` : title} onPress={() => router.push(href)}>
      {({ pressed }) => (
        <View style={{ opacity: pressed ? 0.6 : 1 }}>
          <Row title={title} dot={dot} last={last}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
              {value ? (
                <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 14, color: t.muted, flexShrink: 1 }}>
                  {value}
                </Text>
              ) : null}
              <ChevronIcon size={20} color={t.faint} />
            </View>
          </Row>
        </View>
      )}
    </Pressable>
  );
}

/** One kind's folders: each with its count, Remove, and Add a folder. */
function FoldersCard({ kind, list, otherPaths }: { kind: FolderKind; list: LibraryFolderDto[] | undefined; otherPaths: string[] }) {
  const k = FOLDER_KINDS[kind];
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<LibraryFolderDto | null>(null);
  const [adding, setAdding] = useState(false);
  const folders = list ?? [];

  const save = async (paths: string[], done: string) => {
    setBusy(true);
    try {
      await api<LibraryFolderDto[]>(k.url, { method: "PUT", body: { paths } });
      toast.show(done);
      refreshSoon(kind);
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        {list === undefined ? (
          <Skeleton>
            <RowBone />
          </Skeleton>
        ) : (
          <FadeIn>
            {folders.map((f) => (
              <Row
                key={f.id}
                title={f.path}
                sub={f.reachable ? `${f.books} ${f.books === 1 ? k.item : k.things}` : "The server can't open this folder."}
                subDanger={!f.reachable}
              >
                {folders.length > k.min ? <SmallButton label="Remove" danger onPress={() => setRemoving(f)} /> : null}
              </Row>
            ))}
          </FadeIn>
        )}
        <Row title={k.title} last>
          <SmallButton label="Add" onPress={() => setAdding(true)} />
        </Row>
      </Card>

      <ConfirmSheet
        open={removing !== null}
        title="Remove this folder?"
        message={`${removing?.path ?? ""} is removed from the library, and its ${k.things} leave after the rescan. The files themselves aren't touched.`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) void save(folders.filter((o) => o.id !== removing.id).map((o) => o.path), `Folder removed. Its ${k.things} leave after the rescan.`);
        }}
        onClose={() => setRemoving(null)}
      />
      <Sheet open={adding} onClose={() => setAdding(false)} title={k.title}>
        {adding ? (
          <AddFolder
            others={[...folders.map((f) => f.path), ...otherPaths]}
            start={folders[0]?.path ?? otherPaths[0] ?? ""}
            busy={busy}
            onAdd={async (path) => {
              if (await save([...folders.map((f) => f.path), path], "Folder added. Scanning it now.")) setAdding(false);
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}

/** Type a path or browse the server's folders; the path is checked as you go. */
function AddFolder({ others, start, busy, onAdd }: { others: string[]; start: string; busy: boolean; onAdd: (path: string) => void }) {
  const t = useTheme();
  const [path, setPathState] = useState("");
  const [check, setCheck] = useState<FolderCheckDto | null>(null);
  const setPath = (next: string) => {
    setPathState(next);
    setCheck(null);
  };
  const [browse, setBrowse] = useState<FolderBrowseDto | null>(null);
  const othersKey = others.join("\n");

  useEffect(() => {
    if (!path.trim()) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await api<FolderCheckDto>("/api/library/folders/check", {
          method: "POST",
          body: { path, others: othersKey ? othersKey.split("\n") : [] },
        });
        if (live) setCheck(result);
      } catch (err) {
        if (live) setCheck({ path, ok: false, message: errorText(err), subfolders: 0 });
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, othersKey]);

  const open = async (dir: string) => {
    try {
      setBrowse(await api<FolderBrowseDto>(`/api/library/browse?path=${encodeURIComponent(dir)}`));
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  // Start next to the existing folder, where new ones usually live.
  useEffect(() => {
    void api<FolderBrowseDto>(`/api/library/browse?path=${encodeURIComponent(start)}`)
      .then((b) => (b.parent ? api<FolderBrowseDto>(`/api/library/browse?path=${encodeURIComponent(b.parent)}`) : b))
      .then(setBrowse, () => undefined);
  }, [start]);

  return (
    <View style={{ paddingHorizontal: 12, gap: 12, paddingBottom: 8 }}>
      <Field label="Folder path" value={path} onChangeText={setPath} placeholder="/audiobooks" autoCapitalize="none" autoCorrect={false} spellCheck={false} />
      {check || path.trim() ? (
        <Text variant="small" style={check ? { color: check.ok ? t.accent : t.danger } : undefined}>
          {check ? check.message : "Checking…"}
        </Text>
      ) : null}
      {browse ? (
        <View style={{ backgroundColor: t.surface2, borderRadius: 12, overflow: "hidden" }}>
          {browse.parent ? <FolderLine icon="back" label={browse.parent} onPress={() => void open(browse.parent!)} /> : null}
          {browse.folders.map((name) => {
            const full = joinPath(browse.path, name);
            return (
              <FolderLine
                key={name}
                icon="folder"
                label={name}
                selected={path === full}
                onPress={() => {
                  setPath(full);
                  void open(full);
                }}
              />
            );
          })}
          {browse.folders.length === 0 ? (
            <Text variant="small" style={{ padding: 12 }}>
              No folders inside {browse.path}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Button label="Add folder" onPress={() => check?.ok && onAdd(check.path)} busy={busy} disabled={!check?.ok} />
    </View>
  );
}

function FolderLine({ icon, label, selected, onPress }: { icon: "back" | "folder"; label: string; selected?: boolean; onPress: () => void }) {
  const t = useTheme();
  const color = selected ? t.accent : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, minHeight: 44, backgroundColor: pressed ? t.chip : "transparent" })}
    >
      {icon === "back" ? <BackIcon size={18} color={t.muted} /> : <FolderIcon size={18} color={color} />}
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.medium, fontSize: 14, color: icon === "back" ? t.muted : color }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------- Admin: users ----------

export function UsersSection({ me }: { me: UserDto }) {
  const users = useUsers();
  const [removing, setRemoving] = useState<UserDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTheme();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: libraryKeys.users });

  const closeAdd = () => {
    setAdding(false);
    setUsername("");
    setPassword("");
    setIsAdmin(false);
    setError(null);
  };

  const add = async () => {
    if (password.length < 8) return setError("The password needs at least 8 characters.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/users", { method: "POST", body: { username: username.trim(), password, isAdmin } });
      toast.show(`Added ${username.trim()}`);
      closeAdd();
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: UserDto) => {
    try {
      await api(`/api/users/${u.id}`, { method: "DELETE" });
      toast.show(`Removed ${u.username}`);
      refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <>
      <Card>
        {users.isPending ? (
          <Skeleton>
            <RowBone />
          </Skeleton>
        ) : null}
        {users.isError ? <Row title="Couldn't load users" sub={users.error.message} subDanger /> : null}
        {users.data ? (
          <FadeIn>
            {users.data.map((u) => (
              <Row key={u.id} title={u.id === me.id ? `${u.username} (you)` : u.username} sub={u.isAdmin ? "Admin" : "Listener"}>
                {u.id !== me.id ? <SmallButton label="Remove" danger onPress={() => setRemoving(u)} /> : null}
              </Row>
            ))}
          </FadeIn>
        ) : null}
        <Row title="Add a user" last>
          <SmallButton label="Add" onPress={() => setAdding(true)} />
        </Row>
      </Card>

      <ConfirmSheet
        open={removing !== null}
        title={`Remove ${removing?.username ?? ""}?`}
        message="Their account, listening progress and Up Next are deleted from the server."
        confirmLabel="Remove"
        onConfirm={() => removing && void remove(removing)}
        onClose={() => setRemoving(null)}
      />
      <Sheet open={adding} onClose={closeAdd} title="Add a user">
        <View style={{ paddingHorizontal: 12, gap: 12, paddingBottom: 8 }}>
          <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off" />
          <Field label="Password" placeholder="8 or more characters" value={password} onChangeText={setPassword} autoComplete="new-password" {...passwordProps} />
          <Checkbox label="Admin" checked={isAdmin} onChange={setIsAdmin} />
          {error ? (
            <Text variant="small" style={{ color: t.danger }} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label="Add user" onPress={() => void add()} busy={busy} disabled={!username.trim() || !password} />
        </View>
      </Sheet>
    </>
  );
}
