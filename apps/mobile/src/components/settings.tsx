import { Children, isValidElement, useEffect, useRef, useState } from "react";
import { Linking, Pressable, Share, View } from "react-native";
import Constants from "expo-constants";
import { type Href, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import {
  adScanStatus,
  androidAppUrl,
  apiPaths,
  backupLine,
  type EpisodeCacheStatusDto,
  errorText,
  FOLDER_KINDS,
  type FolderKind,
  gigabytes,
  type HealthDto,
  isNewer,
  KEEP_PER_SHOW_OPTIONS,
  type LibraryAdminDto,
  type LibraryFolderDto,
  MIN_PASSWORD,
  outOfDate,
  plural,
  QUALITY_LABEL,
  type ScanKind,
  scanShare,
  type ScanStatusDto,
  scanStatusText,
  SHORT_NEW_PASSWORD,
  SHORT_PASSWORD,
  type ServerVersionDto,
  type SettingsTab,
  SKIP_BACK_OPTIONS,
  SKIP_FORWARD_OPTIONS,
  THEME_CHOICES,
  UPDATE_APP,
  UPDATE_SERVER,
  type UserDto,
  versionStatus,
  type VideoQuality,
} from "@murmur/shared/client";
import { absolute, api, authHeaders } from "@/lib/api";
import {
  keys,
  saveAutoplayNext,
  saveExplicitShows,
  saveTabPrefs,
  saveVideoQuality,
  useAutoplayNext,
  useBooks,
  useExplicitShows,
  useMusicSummary,
  useTabPrefs,
  useVideoQuality,
} from "@/lib/data";
import { hapticsStore, selectHaptic, useHapticsEnabled } from "@/lib/haptics";
import { useCanHideAndLike } from "@/lib/hidden";
import { queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useMovies, useShows, useWatchHome } from "@/lib/watch";
import { AD_MODES, adPrefsStore, useAdDetection, useAdPrefs } from "@/player/ad-prefs";
import { setSkip, usePlayerSelect } from "@/player/engine";
import { fonts, setThemeMode, useTheme, useThemeMode } from "@/theme";
import { ChevronIcon, DownloadIcon, PlusIcon, RefreshIcon } from "./icons";
import { ConfirmSheet, Sheet, SheetItem } from "./sheet";
import { Bone, FadeIn, Skeleton } from "./skeleton";
import { toast } from "./toast";
import { Button, Caption, Field, NumberBadge, Text } from "./ui";

// Settings on the You tab, like the web's: text tabs, each a few groups of flat rows split by
// hairlines under eyebrow labels. A choice shows its value and opens a sheet, on/off says On or
// Off, and a row's action is accent text with an icon.

// ---------- Building blocks shared with other screens ----------

/** A rounded panel of rows, for detail pages (a movie's or show's files). Settings use flat groups. */
export function Card({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <View style={{ backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: 16 }}>{children}</View>;
}

/** A row in a Card: title, a sub line, and whatever goes on the right. */
export function Row({
  title,
  sub,
  subDanger,
  last,
  children,
}: {
  title: string;
  sub?: string | null;
  subDanger?: boolean;
  /** The last row in a card has no divider under it. */
  last?: boolean;
  children?: React.ReactNode;
}) {
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
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
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

export function SmallButton({ label, onPress, danger, primary, disabled }: { label: string; onPress: () => void; danger?: boolean; primary?: boolean; disabled?: boolean }) {
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

const useServerVersion =() => useQuery({ queryKey: keys.serverVersion, queryFn: () => api<ServerVersionDto>(apiPaths.serverVersion) });
export const useHealth = (enabled = true) => useQuery({ queryKey: keys.health, queryFn: () => api<HealthDto>(apiPaths.health), enabled });
const useEpisodeCache = (enabled = true) => useQuery({ queryKey: keys.episodeCache, queryFn: () => api<EpisodeCacheStatusDto>(apiPaths.episodeCache), enabled });
const useUsers = (enabled = true) => useQuery({ queryKey: keys.users, queryFn: () => api<UserDto[]>(apiPaths.users), enabled });

// ---------- Settings rows ----------

/** A group of rows under an eyebrow label, split by hairlines. One without a label (Sign out) sits closer. */
export function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  const t = useTheme();
  const rows = Children.toArray(children);
  if (!rows.length) return null;
  return (
    <View style={{ marginTop: label ? 36 : 16 }}>
      {label ? <Caption style={{ fontFamily: fonts.bold, letterSpacing: 0.6, marginBottom: 4 }}>{label}</Caption> : null}
      {rows.map((r, i) => (
        <View key={isValidElement(r) && r.key !== null ? r.key : i} style={i < rows.length - 1 ? { borderBottomWidth: 1, borderBottomColor: t.line } : undefined}>
          {r}
        </View>
      ))}
    </View>
  );
}

/** A muted line under a row's title; red for a failure. */
export function Sub({ danger, children }: { danger?: boolean; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text variant="small" style={danger ? { color: t.danger } : undefined}>
      {children}
    </Text>
  );
}

/** One flat row: its title and sub lines, then what's on the right. Tappable when `onPress` is given. */
export function SetRow({
  title,
  sub,
  mono,
  danger,
  onPress,
  a11y,
  children,
}: {
  title: string;
  sub?: React.ReactNode;
  /** A folder path. */
  mono?: boolean;
  /** Sign out: the title in red. */
  danger?: boolean;
  onPress?: () => void;
  a11y?: string;
  children?: React.ReactNode;
}) {
  const t = useTheme();
  const body = (pressed = false) => (
    <View style={{ minHeight: 56, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, opacity: pressed ? 0.6 : 1 }}>
      <View style={{ flexShrink: 1, minWidth: 0, gap: 2 }}>
        <Text
          numberOfLines={mono ? 2 : undefined}
          style={{ fontFamily: mono ? fonts.medium : fonts.semibold, fontSize: mono ? 13 : 15, color: danger ? t.danger : t.text }}
        >
          {title}
        </Text>
        {typeof sub === "string" ? <Sub>{sub}</Sub> : sub}
      </View>
      {children}
    </View>
  );
  if (!onPress) return body();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

/** A choice's value and a chevron, on the right of its row. */
export function Value({ text }: { text?: string | null }) {
  const t = useTheme();
  return (
    // Its full width, always: the title beside it wraps first.
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
      {text ? (
        <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 14, color: t.muted }}>
          {text}
        </Text>
      ) : null}
      <ChevronIcon size={18} color={t.faint} />
    </View>
  );
}

/** A row's action: accent text with an icon. */
export function RowAction({ label, icon, danger, disabled, spinning, onPress }: { label: string; icon?: React.ReactNode; danger?: boolean; disabled?: boolean; spinning?: boolean; onPress: () => void }) {
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
      accessibilityState={{ disabled: disabled || spinning, busy: spinning }}
      disabled={disabled || spinning}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({ height: 40, paddingHorizontal: 10, marginRight: -10, flexDirection: "row", alignItems: "center", gap: 6, opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}
    >
      {icon ? <Animated.View style={style}>{icon}</Animated.View> : null}
      <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: danger ? t.danger : t.accent }}>{label}</Text>
    </Pressable>
  );
}

/** A setting with a few choices: its value and a chevron, opening a sheet to pick from. */
function ChoiceRow<T extends string | number>({
  title,
  sub,
  value,
  choices,
  disabled,
  onPick,
}: {
  title: string;
  sub?: React.ReactNode;
  value: T;
  choices: readonly { id: T; label: string }[];
  disabled?: boolean;
  onPick: (id: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = choices.find((c) => c.id === value)?.label;
  return (
    <>
      <SetRow title={title} sub={sub} a11y={`${title}, ${label ?? ""}`} onPress={disabled ? undefined : () => setOpen(true)}>
        <Value text={label} />
      </SetRow>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {choices.map((c) => (
          <SheetItem
            key={String(c.id)}
            label={c.label}
            active={c.id === value}
            onPress={() => {
              setOpen(false);
              if (c.id !== value) onPick(c.id);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

/** On or off: the whole row toggles, saying On in accent or Off muted, lined up with the values before the chevrons. */
export function OnOffRow({ title, sub, value, onChange }: { title: string; sub?: React.ReactNode; value: boolean; onChange: (on: boolean) => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityState={{ checked: value }}
      onPress={() => {
        selectHaptic();
        onChange(!value);
      }}
    >
      {({ pressed }) => (
        <View style={{ opacity: pressed ? 0.6 : 1 }}>
          <SetRow title={title} sub={sub}>
            <Text style={{ marginRight: 24, fontFamily: fonts.bold, fontSize: 14, color: value ? t.accent : t.muted }}>{value ? "On" : "Off"}</Text>
          </SetRow>
        </View>
      )}
    </Pressable>
  );
}

/** A row that opens another screen, with its value, or an accent count for something waiting. */
function LinkRow({ title, value, badge, href }: { title: string; value?: string | null; badge?: number; href: Href }) {
  return (
    <SetRow title={title} a11y={badge ? `${title}, ${badge}` : value ? `${title}, ${value}` : title} onPress={() => router.push(href)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {badge ? <NumberBadge tone="new" value={badge} /> : null}
        <Value text={value} />
      </View>
    </SetRow>
  );
}

/** Rows' placeholders while a group loads: the title on the left, its value on the right, like SetRow. */
function GroupBones({ label, rows }: { label: string; rows: number }) {
  return (
    <Group label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Bone width={i % 2 ? "35%" : "45%"} height={15} />
          <Bone width={70} height={13} />
        </Skeleton>
      ))}
    </Group>
  );
}

// ---------- The tabs ----------

/** The body of one settings tab. */
export function SettingsTabBody({ tab }: { tab: SettingsTab }) {
  return (
    <FadeIn>
      {tab === "playback" ? (
        <PlaybackTab />
      ) : tab === "appearance" ? (
        <AppearanceTab />
      ) : tab === "podcasts" ? (
        <PodcastsTab />
      ) : tab === "account" ? (
        <AccountTab />
      ) : tab === "library" ? (
        <LibraryTab />
      ) : tab === "users" ? (
        <UsersTab />
      ) : (
        <ServerTab />
      )}
    </FadeIn>
  );
}

const seconds = (values: readonly number[]) => values.map((v) => ({ id: v, label: `${v} seconds` }));
const SKIP_BACK = seconds(SKIP_BACK_OPTIONS);
const SKIP_FORWARD = seconds(SKIP_FORWARD_OPTIONS);
const QUALITIES = (["full", "light"] as const).map((id) => ({ id, label: QUALITY_LABEL[id] }));

function PlaybackTab() {
  const skip = usePlayerSelect((s) => s.skip);
  const adPrefs = useAdPrefs();
  const adDetection = useAdDetection();
  const watch = !!useWatchHome().data?.enabled;
  const quality = useVideoQuality();
  const autoplayNext = useAutoplayNext();
  return (
    <>
      <Group label="Skipping">
        <ChoiceRow title="Skip back" value={skip.back} choices={SKIP_BACK} onPick={(v) => setSkip({ ...skip, back: v })} />
        <ChoiceRow title="Skip forward" value={skip.forward} choices={SKIP_FORWARD} onPick={(v) => setSkip({ ...skip, forward: v })} />
      </Group>
      {watch ? (
        <Group label="Video">
          <ChoiceRow
            title="Converted video"
            sub="When the server has to convert a video. 720p is easier on a small server."
            value={quality}
            choices={QUALITIES}
            onPick={(q: VideoQuality) => saveVideoQuality(q)}
          />
          <OnOffRow title="Play next TV episode" value={autoplayNext} onChange={saveAutoplayNext} />
        </Group>
      ) : null}
      {adDetection ? (
        <Group label="Podcasts">
          <ChoiceRow
            title="Ads"
            sub={`This device only. ${AD_MODES.find((m) => m.id === adPrefs.mode)?.hint}.`}
            value={adPrefs.mode}
            choices={AD_MODES}
            onPick={(mode) => adPrefsStore.set({ ...adPrefs, mode })}
          />
        </Group>
      ) : null}
    </>
  );
}

function AppearanceTab() {
  const mode = useThemeMode();
  const haptics = useHapticsEnabled();
  const tabs = useTabPrefs();
  const books = useBooks().data?.filter((b) => b.missingSince === null).length ?? 0;
  const music = useMusicSummary().data;
  const hasWatch = !!useWatchHome().data?.enabled;
  const movies = useMovies(hasWatch).data?.length ?? 0;
  const shows = useShows(hasWatch).data?.length ?? 0;
  return (
    <>
      <Group label="Look">
        <ChoiceRow title="Theme" value={mode} choices={THEME_CHOICES} onPick={setThemeMode} />
        <OnOffRow title="Haptics" sub="A light tap on play, skips and choices." value={haptics} onChange={(on) => hapticsStore.set(on)} />
      </Group>
      <Group label="Choose what you see">
        <OnOffRow title="Books in Library" sub={books ? plural(books, "book") : undefined} value={tabs.books} onChange={(on) => saveTabPrefs({ ...tabs, books: on })} />
        <OnOffRow
          title="Music in Library"
          sub={music?.enabled ? plural(music.albums, "album") : undefined}
          value={tabs.music}
          onChange={(on) => saveTabPrefs({ ...tabs, music: on })}
        />
        <OnOffRow
          title="Watch in Library"
          sub={
            hasWatch ? [movies ? plural(movies, "movie") : null, shows ? plural(shows, "show") : null].filter(Boolean).join(" and ") || "Nothing found yet" : undefined
          }
          value={tabs.watch}
          onChange={(on) => saveTabPrefs({ ...tabs, watch: on })}
        />
        <OnOffRow title="Podcasts" sub="Follow shows by name or RSS" value={tabs.podcasts} onChange={(podcasts) => saveTabPrefs({ ...tabs, podcasts })} />
      </Group>
    </>
  );
}

function PodcastsTab() {
  const admin = !!useSession().user?.isAdmin;
  const explicit = useExplicitShows();
  const [exporting, setExporting] = useState(false);

  // The OPML file goes to Android's share sheet, to save or send to another podcast app.
  const exportOpml = async () => {
    setExporting(true);
    try {
      const res = await fetch(absolute(apiPaths.podcastsOpml), { headers: authHeaders() });
      if (!res.ok) throw new Error(`Couldn't export your subscriptions (${res.status}).`);
      await Share.share({ title: "murmur-podcasts.opml", message: await res.text() });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {admin ? <KeptOnServer /> : null}
      <Group label="Browse and export">
        {/* A server from before Browse has no such setting. */}
        {explicit !== undefined ? <OnOffRow title="Explicit shows in Browse" value={explicit} onChange={saveExplicitShows} /> : null}
        <SetRow title="Your subscriptions" sub="An OPML file other podcast apps can import">
          <RowAction label="Export" icon={<DownloadIcon size={18} color={useTheme().accent} />} disabled={exporting} onPress={() => void exportOpml()} />
        </SetRow>
      </Group>
    </>
  );
}

/** Admin: how many recent episodes the server keeps ready per podcast, and how ad detection is doing. */
function KeptOnServer() {
  const t = useTheme();
  const cache = useEpisodeCache();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast.show(done);
      void queryClient.invalidateQueries({ queryKey: keys.episodeCache });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const c = cache.data;
  if (!c) {
    if (cache.isError) {
      return (
        <Group label="Kept on the server">
          <SetRow title="Episodes kept ready per podcast" sub={<Sub danger>{cache.error.message}</Sub>} />
        </Group>
      );
    }
    return <GroupBones label="Kept on the server" rows={2} />;
  }
  const { ads } = c;
  // Measured from when this status was fetched.
  const scan = adScanStatus(ads, cache.dataUpdatedAt);

  return (
    <Group label="Kept on the server">
      <ChoiceRow
        title="Episodes kept ready per podcast"
        sub={<Sub danger={!c.available}>{c.available ? `${gigabytes(c.usedBytes)} of ${gigabytes(c.maxBytes)} used` : c.error}</Sub>}
        value={c.settings.episodesPerShow}
        choices={KEEP_PER_SHOW_OPTIONS.map((n) => ({ id: n, label: n === 0 ? "Off" : String(n) }))}
        disabled={busy}
        onPick={(n) => void run(() => api(apiPaths.episodeCache, { method: "PUT", body: { episodesPerShow: n } }))}
      />
      {ads.enabled ? (
        <SetRow
          title="Ad detection"
          sub={
            <>
              <Sub danger={scan.state === "error"}>{scan.text}</Sub>
              {scan.groqText ? <Sub danger={scan.groqStuck}>{scan.groqText}</Sub> : null}
              <Sub>{scan.counts}</Sub>
            </>
          }
        >
          {ads.failed ? (
            <RowAction
              label="Retry"
              icon={<RefreshIcon size={18} color={t.accent} />}
              disabled={busy}
              onPress={() => void run(() => api(apiPaths.adsRetry, { method: "POST" }), "Failed scans will run again.")}
            />
          ) : null}
        </SetRow>
      ) : null}
    </Group>
  );
}

function AccountTab() {
  const session = useSession();
  const user = session.user;
  const canHide = useCanHideAndLike();
  const [password, setPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  return (
    <>
      <Group label="Account">
        <SetRow title="User" sub={user?.isAdmin ? "Admin" : "Listener"}>
          <Value text={user?.username} />
        </SetRow>
        <SetRow title="Password">
          <RowAction label="Change" onPress={() => setPassword(true)} />
        </SetRow>
      </Group>
      {canHide ? (
        <Group label="Your lists">
          <LinkRow title="Hidden" href="/hidden" />
        </Group>
      ) : null}
      {/* One "Sign out", on the row (audit AB33). */}
      <Group>
        <SetRow title="Sign out" danger onPress={() => setSigningOut(true)} />
      </Group>
      <PasswordSheet open={password} onClose={() => setPassword(false)} />
      <ConfirmSheet
        open={signingOut}
        title="Sign out?"
        message="Your downloads stay on this phone, and your progress is saved on the server."
        confirmLabel="Sign out"
        onConfirm={() => void session.signOut()}
        onClose={() => setSigningOut(false)}
      />
    </>
  );
}

const passwordProps = { secureTextEntry: true, autoCapitalize: "none", autoCorrect: false, spellCheck: false } as const;

/** Changing your password; other devices are signed out, this one stays. */
function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTheme();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    onClose();
    setCurrent("");
    setNext("");
    setRepeat("");
    setError(null);
  };

  const submit = async () => {
    if (next.length < MIN_PASSWORD) return setError(SHORT_NEW_PASSWORD);
    if (next !== repeat) return setError("The new passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api(apiPaths.password, { method: "PUT", body: { currentPassword: current, newPassword: next } });
      close();
      toast.show("Password changed. Other devices were signed out.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close} title="Change password">
      <View style={{ paddingHorizontal: 12, gap: 12, paddingBottom: 8 }}>
        <Field label="Current password" value={current} onChangeText={setCurrent} autoComplete="current-password" {...passwordProps} />
        <Field label="New password" placeholder={`${MIN_PASSWORD} or more characters`} value={next} onChangeText={setNext} autoComplete="new-password" {...passwordProps} />
        <Field label="Repeat new password" value={repeat} onChangeText={setRepeat} autoComplete="new-password" {...passwordProps} />
        {error ? (
          <Text variant="small" style={{ color: t.danger }} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label="Change password" onPress={() => void submit()} busy={busy} disabled={!current || !next || !repeat} />
      </View>
    </Sheet>
  );
}

// ---------- Admin: library ----------

export const useFolders = (kind: FolderKind) => useQuery({ queryKey: keys.libraryFolders(kind), queryFn: () => api<LibraryFolderDto[]>(apiPaths.folders[kind]) });

const SCAN_POLL_MS = 1000;
const SCAN_KINDS: ScanKind[] = ["books", "music", "watch"];

export const useLibraryAdmin = () =>
  useQuery({
    queryKey: keys.libraryAdmin,
    queryFn: () => api<LibraryAdminDto>(apiPaths.libraryAdmin),
    // Every second while any kind scans (started here or anywhere else), so its count and bar move.
    refetchInterval: (q) => (q.state.data && SCAN_KINDS.some((k) => q.state.data![k].scan.running) ? SCAN_POLL_MS : false),
  });

/** A thin accent bar under a scan's row, filling as it goes; nothing until it knows how much there is. */
export function ScanBar({ scan }: { scan: ScanStatusDto }) {
  const share = scanShare(scan);
  return share === null ? null : <ScanFill share={share} />;
}

function ScanFill({ share }: { share: number }) {
  const t = useTheme();
  const width = useSharedValue(share);
  useEffect(() => {
    width.value = withTiming(share, { duration: 400, easing: Easing.out(Easing.quad) });
  }, [share, width]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  return (
    <View style={{ height: 3, borderRadius: 2, backgroundColor: t.track, overflow: "hidden", marginBottom: 12 }} importantForAccessibility="no-hide-descendants">
      <Animated.View style={[{ height: "100%", backgroundColor: t.accent }, fill]} />
    </View>
  );
}

/** Books, Music, and Movies and shows: each with its count and Rescan, what needs a look, and its folders. */
function LibraryTab() {
  const admin = useLibraryAdmin();
  const video = useHealth().data?.watch?.status;
  const folders: Record<FolderKind, LibraryFolderDto[] | undefined> = {
    books: useFolders("books").data,
    music: useFolders("music").data,
    movies: useFolders("movies").data,
    shows: useFolders("shows").data,
  };
  const a = admin.data;
  if (!a) {
    if (admin.isError) {
      return (
        <Group label="Library">
          <SetRow title="Couldn't load the library" sub={<Sub danger>{admin.error.message}</Sub>} />
        </Group>
      );
    }
    return (
      <>
        <GroupBones label="Books" rows={3} />
        <GroupBones label="Music" rows={2} />
      </>
    );
  }
  return (
    <>
      <Group label="Books">
        <ScanRow kind="books" title={plural(a.books.total, "book")} scan={a.books.scan} />
        {/* Empty lists aren't worth a row; one waiting for a look gets an accent count. */}
        {a.books.attention ? <LinkRow title="Needs attention" badge={a.books.attention} href={{ pathname: "/library-list", params: { list: "attention" } }} /> : null}
        {a.books.unmatched ? (
          <LinkRow title="Not matched" value={plural(a.books.unmatched, "book")} href={{ pathname: "/library-list", params: { list: "unmatched" } }} />
        ) : null}
        {folderRows("books", folders.books)}
      </Group>
      <Group label="Music">
        <ScanRow kind="music" title={plural(a.music.albums, "album")} scan={a.music.scan} />
        {a.music.unmatched ? (
          <LinkRow title="Not matched" value={plural(a.music.unmatched, "album")} href={{ pathname: "/library-list", params: { list: "albums" } }} />
        ) : null}
        {folders.music?.length === 0 ? <SetRow title="Folders" sub="Mount your music at /music." /> : folderRows("music", folders.music)}
      </Group>
      <Group label="Movies and shows">
        <ScanRow kind="watch" title={`${plural(a.watch.movies, "movie")} and ${plural(a.watch.shows, "show")}`} scan={a.watch.scan} />
        {video ? <SetRow title="Video" sub={<Sub danger={!!video.problem}>{video.problem ?? video.working}</Sub>} /> : null}
        {folders.movies?.length === 0 && folders.shows?.length === 0 ? <SetRow title="Folders" sub="Mount your movies at /movies and shows at /shows." /> : null}
        {folderRows("movies", folders.movies)}
        {folderRows("shows", folders.shows)}
      </Group>
    </>
  );
}

/** A kind's folders with their counts. They come from what's mounted, so there's nothing to change here. */
function folderRows(kind: FolderKind, list: LibraryFolderDto[] | undefined) {
  const k = FOLDER_KINDS[kind];
  return (list ?? []).map((f) => (
    <SetRow
      key={`${kind}:${f.id}`}
      title={f.path}
      mono
      sub={<Sub danger={!f.reachable}>{f.reachable ? `${f.books} ${f.books === 1 ? k.item : k.things}` : "The server can't open this folder."}</Sub>}
    />
  ));
}

/** A kind's count and scan status, with Rescan; its icon spins until the scan is done. */
function ScanRow({ kind, title, scan: live }: { kind: ScanKind; title: string; scan: ScanStatusDto }) {
  const t = useTheme();
  const [asked, setAsked] = useState(false);
  // Until the first answer after Rescan, it counts as running with nothing found yet.
  const scan = asked && !live.running ? { ...live, running: true, progress: null } : live;
  // When a scan finishes, everything it could have changed is fetched again.
  const was = useRef(live.running);
  useEffect(() => {
    if (was.current && !live.running) void queryClient.invalidateQueries();
    was.current = live.running;
  }, [live.running]);

  const rescan = async () => {
    setAsked(true);
    try {
      await api(apiPaths.scan[kind], { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: keys.libraryAdmin });
      // A scan with nothing new can be over before the counts are fetched again.
      if (!queryClient.getQueryData<LibraryAdminDto>(keys.libraryAdmin)?.[kind].scan.running) void queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setAsked(false);
    }
  };

  return (
    <View>
      <SetRow title={title} sub={<Sub danger={!scan.running && !!scan.lastError}>{scanStatusText(scan, kind)}</Sub>}>
        <RowAction label="Rescan" icon={<RefreshIcon size={18} color={t.accent} />} spinning={scan.running} onPress={() => void rescan()} />
      </SetRow>
      <ScanBar scan={scan} />
    </View>
  );
}

// ---------- Admin: users ----------

function UsersTab() {
  const t = useTheme();
  const me = useSession().user;
  const users = useUsers();
  const [removing, setRemoving] = useState<UserDto | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.users });

  const remove = async (u: UserDto) => {
    try {
      await api(apiPaths.user(u.id), { method: "DELETE" });
      toast.show(`Removed ${u.username}`);
      refresh();
    } catch (err) {
      toast.error(errorText(err, `Couldn't remove ${u.username}.`));
    }
  };

  if (!users.data) {
    if (users.isError) {
      return (
        <Group label="People">
          <SetRow title="Couldn't load users" sub={<Sub danger>{users.error.message}</Sub>} />
        </Group>
      );
    }
    return <GroupBones label="People" rows={2} />;
  }
  return (
    <>
      <Group label="People">
        {users.data.map((u) => (
          <SetRow key={u.id} title={u.id === me?.id ? `${u.username} (you)` : u.username} sub={u.isAdmin ? "Admin" : "Listener"}>
            {u.id !== me?.id ? <RowAction label="Remove" danger onPress={() => setRemoving(u)} /> : null}
          </SetRow>
        ))}
        <SetRow title="Add a user">
          <RowAction label="Add" icon={<PlusIcon size={18} color={t.accent} />} onPress={() => setAdding(true)} />
        </SetRow>
      </Group>
      <ConfirmSheet
        open={removing !== null}
        title={`Remove ${removing?.username ?? ""}?`}
        message="Their account, listening progress and queue are deleted from the server."
        confirmLabel="Remove"
        danger
        onConfirm={() => removing && void remove(removing)}
        onClose={() => setRemoving(null)}
      />
      <AddUserSheet open={adding} onClose={() => setAdding(false)} onAdded={refresh} />
    </>
  );
}

function AddUserSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const t = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    onClose();
    setUsername("");
    setPassword("");
    setIsAdmin(false);
    setError(null);
  };

  const add = async () => {
    if (password.length < MIN_PASSWORD) return setError(SHORT_PASSWORD);
    setBusy(true);
    setError(null);
    try {
      await api(apiPaths.users, { method: "POST", body: { username: username.trim(), password, isAdmin } });
      toast.show(`Added ${username.trim()}`);
      close();
      onAdded();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close} title="Add a user">
      <View style={{ paddingHorizontal: 12, gap: 12, paddingBottom: 8 }}>
        <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off" />
        <Field label="Password" placeholder={`${MIN_PASSWORD} or more characters`} value={password} onChangeText={setPassword} autoComplete="new-password" {...passwordProps} />
        <OnOffRow title="Admin" value={isAdmin} onChange={setIsAdmin} />
        {error ? (
          <Text variant="small" style={{ color: t.danger }} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label="Add user" onPress={() => void add()} busy={busy} disabled={!username.trim() || !password} />
      </View>
    </Sheet>
  );
}

// ---------- Admin: server ----------

const appVersion = Constants.expoConfig?.version ?? "unknown";

/** The server's version and backups, then this app and where it signs in, and TMDB's credit when video is on. */
function ServerTab() {
  const t = useTheme();
  const query = useServerVersion();
  const serverUrl = useSession().serverUrl;
  const watch = !!useWatchHome().data?.enabled;
  const v = query.data;
  const update = v?.updates?.update;
  const appBehind = !!v && isNewer(v.version, appVersion);
  return (
    <>
      {v ? (
        <Group label="Server">
          <SetRow title={`Murmur ${v.version}`} sub={versionStatus(v).sub}>
            {update ? <RowAction label="What's new" onPress={() => void Linking.openURL(update.url)} /> : null}
          </SetRow>
          {/* Admins only: the server leaves it null for everyone else. */}
          {v.backup ? <SetRow title="Backups" sub={<Sub danger={v.backup.failed}>{backupLine(v.backup).sub}</Sub>} /> : null}
        </Group>
      ) : query.isError ? (
        <Group label="Server">
          <SetRow title="Server version" sub={<Sub danger>{query.error.message}</Sub>} />
        </Group>
      ) : (
        <GroupBones label="Server" rows={2} />
      )}
      <Group label="This phone">
        <SetRow title="Murmur for Android" sub={appBehind ? `Version ${appVersion}. ${v.version} is available` : `Version ${appVersion}`}>
          {appBehind ? (
            <RowAction label="Download" icon={<DownloadIcon size={18} color={t.accent} />} onPress={() => void Linking.openURL(androidAppUrl(v.version, v.devBuild))} />
          ) : null}
        </SetRow>
        {serverUrl ? <SetRow title="Server address" sub={serverUrl} /> : null}
      </Group>
      {watch ? (
        <Group>
          <View style={{ paddingVertical: 12, gap: 6 }}>
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
        </Group>
      ) : null}
    </>
  );
}

/** On You when the app and the server are on different major versions. Nothing shows within a major. */
export function VersionNotice() {
  const t = useTheme();
  const v = useServerVersion().data;
  const behind = outOfDate(Constants.expoConfig?.version, v?.version);
  if (!behind || !v) return null;
  return (
    <View style={{ marginTop: 8, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <SetRow title={behind === "app" ? UPDATE_APP : UPDATE_SERVER}>
        {behind === "app" ? (
          <RowAction label="Download" icon={<DownloadIcon size={18} color={t.accent} />} onPress={() => void Linking.openURL(androidAppUrl(v.version, v.devBuild))} />
        ) : null}
      </SetRow>
    </View>
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
