"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  apiPaths,
  adScanStatus,
  errorText,
  gigabytes,
  KEEP_PER_SHOW_OPTIONS,
  scanStatusText,
  type LibraryAdminDto,
  type ScanStatusDto,
  SKIP_BACK_OPTIONS,
  SKIP_FORWARD_OPTIONS,
  THEME_CHOICES,
  type EpisodeCacheStatusDto,
  type LibraryFolderDto,
  androidAppUrl,
  backupLine,
  type ServerVersionDto,
  type ThemeChoice,
  versionStatus,
  type UserDto,
  type UserPrefs,
  type VideoStatus,
  type MusicSummaryDto,
  type WatchSummaryDto,
  statsKindsShown,
  SETTINGS_TABS,
  type SettingsTab,
  settingsTabs,
  plural,
} from "@murmur/shared/client";
import { api } from "../api";
import { CopyIcon, DownloadIcon, PlusIcon, RefreshIcon } from "../icons";
import { AD_MODES, adPrefsStore, useAdPrefs } from "../player/ad-prefs";
import { usePlayerControls, usePlayerSelect } from "../player/engine";
import { forgetBookmarks } from "../bookmarks";
import { ConfirmSheet, Sheet } from "../sheet";
import { applyTheme, currentTheme } from "../theme";
import { useQualityPref } from "../watch/quality-pref";
import { Chip, Chips, ChoiceRow, NestedHead, Setting, SettingLink, SettingsGroup, SettingSub, SwitchRow } from "../ui";
import { HiddenList } from "./hidden-list";

import { StatsCard } from "./stats";

interface ServerInfo extends ServerVersionDto {
  watcher: "events" | "polling" | "periodic-only";
}

export function ProfileView({
  tab: initialTab = "playback",
  user,
  users,
  folders,
  adsEnabled,
  cache,
  libraryAdmin,
  server,
  tabs,
  autoplayNext,
  explicitShows,
  musicFolders,
  movieFolders,
  showFolders,
  books,
  music,
  watch,
  video,
}: {
  /** The settings tab shown under the stats, or Hidden on its own page. */
  tab?: SettingsTab | "hidden";
  /** How many books are on the server. */
  books: number;
  musicFolders: LibraryFolderDto[];
  movieFolders: LibraryFolderDto[];
  showFolders: LibraryFolderDto[];
  watch: WatchSummaryDto;
  /** The video add-on, for admins once there are movie or show folders. */
  video: VideoStatus | null;
  music: MusicSummaryDto;
  tabs: UserPrefs["tabs"];
  autoplayNext: boolean;
  /** Browse's charts and suggestions include explicit shows. */
  explicitShows: boolean;
  user: UserDto;
  users: UserDto[];
  folders: LibraryFolderDto[];
  adsEnabled: boolean;
  cache: EpisodeCacheStatusDto | null;
  /** You > Library's counts and scans, for admins. */
  libraryAdmin: LibraryAdminDto | null;
  server: ServerInfo;
}) {
  const router = useRouter();
  const player = usePlayerControls();
  const shown = settingsTabs(user.isAdmin, tabs);
  const [tab, setTab] = useState<SettingsTab>(initialTab !== "hidden" && shown.includes(initialTab) ? initialTab : "playback");
  const refresh = () => router.refresh();

  // What you hid is a list of covers, so it gets its own page under Account.
  if (initialTab === "hidden") {
    return (
      <>
        <NestedHead title="Hidden" fallback="/you/account" />
        <HiddenList />
      </>
    );
  }

  // Switching tabs stays on the page; the address follows so a tab can be linked and reloaded.
  const pick = (next: SettingsTab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "playback" ? "/you" : `/you/${next}`);
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">You</h1>
      </div>

      <section className="section">
        <StatsCard kinds={statsKindsShown(tabs)} />
      </section>

      <section className="section">
        <h2 className="you-heading">Settings</h2>
        <div className="set-tabs">
          <Chips kind="tabs" label="Settings">
            {shown.map((id) => (
              <Chip key={id} selected={tab === id} onClick={() => pick(id)}>
                {SETTINGS_TABS.find((t) => t.id === id)!.label}
              </Chip>
            ))}
          </Chips>
        </div>
      </section>

      <div key={tab} className="set-tabs-body view-fade" role="tabpanel">
        {tab === "playback" ? (
          <PlaybackCard adsEnabled={adsEnabled} watch={watch.enabled} autoplayNext={autoplayNext} />
        ) : tab === "appearance" ? (
          <>
            <ThemePicker />
            <TabsCard tabs={tabs} books={books} music={music} watch={watch} onSaved={refresh} />
          </>
        ) : tab === "podcasts" ? (
          <>
            {cache ? <EpisodeCacheCard cache={cache} onChanged={refresh} /> : null}
            <SettingsGroup label="Browse and export">
              <ExplicitSwitch initial={explicitShows} />
              <Setting title="Your subscriptions" sub={<SettingSub>An OPML file other podcast apps can import</SettingSub>}>
                <a className="btn" href={apiPaths.podcastsOpml} download="murmur-podcasts.opml">
                  <DownloadIcon size={18} />
                  Export
                </a>
              </Setting>
            </SettingsGroup>
          </>
        ) : tab === "account" ? (
          <>
            <PasswordForm username={user.username} isAdmin={user.isAdmin} />
            <SettingsGroup label="Your lists">
              <SettingLink title="Hidden" href="/you/hidden" />
            </SettingsGroup>
            <SignOut onSignOut={player.stop} />
          </>
        ) : tab === "library" && libraryAdmin ? (
          <LibraryAdmin libraryAdmin={libraryAdmin} folders={folders} musicFolders={musicFolders} movieFolders={movieFolders} showFolders={showFolders} video={video} />
        ) : tab === "users" ? (
          <UsersCard me={user} users={users} onChanged={refresh} />
        ) : tab === "server" ? (
          <>
            <VersionCard version={server.version} devBuild={server.devBuild} updates={server.updates} backup={server.backup} />
            <AppCard version={server.version} devBuild={server.devBuild} />
            {watch.enabled ? <TmdbCredit /> : null}
          </>
        ) : null}
      </div>
    </>
  );
}

/** Server: the Android app for this version, and the address to sign in with. */
function AppCard({ version, devBuild }: { version: string; devBuild: boolean }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <SettingsGroup label="Android app">
      <Setting title="Murmur for Android" sub={<SettingSub>{devBuild ? "The latest release on GitHub" : `Version ${version}, from GitHub`}</SettingSub>}>
        <a className="btn" href={androidAppUrl(version, devBuild)} target="_blank" rel="noreferrer">
          <DownloadIcon size={18} />
          Download
        </a>
      </Setting>
      <Setting title="Server address" sub={<SettingSub>{origin || " "}</SettingSub>}>
        <button
          type="button"
          className="btn"
          disabled={!origin}
          onClick={() =>
            void navigator.clipboard.writeText(origin).then(
              () => toast("Copied the server address"),
              () => toast.error("Couldn't copy it. Select the address instead."),
            )
          }
        >
          <CopyIcon size={18} />
          Copy
        </button>
      </Setting>
    </SettingsGroup>
  );
}

/** Whether Browse's charts and suggestions include explicit shows. Search always does. */
function ExplicitSwitch({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const toggle = (next: boolean) => {
    setOn(next);
    api(apiPaths.prefs, { method: "PUT", body: { explicitShows: next } }).catch((err: unknown) => {
      setOn(!next);
      toast.error(errorText(err));
    });
  };
  return <SwitchRow title="Explicit shows in Browse" label="Explicit shows in Browse" checked={on} onChange={toggle} />;
}

/** Skip lengths, and what to do about ads when they're found. */
function PlaybackCard({
  adsEnabled,
  watch,
  autoplayNext,
}: {
  adsEnabled: boolean;
  watch: boolean;
  autoplayNext: boolean;
}) {
  const { setSkip } = usePlayerControls();
  const skip = usePlayerSelect((p) => p.skip);
  const adPrefs = useAdPrefs();
  const { quality, save: pickQuality } = useQualityPref();
  const [nextOn, setNextOn] = useState(autoplayNext);
  const toggleNext = (on: boolean) => {
    setNextOn(on);
    api(apiPaths.prefs, { method: "PUT", body: { autoplayNext: on } }).catch((err: unknown) => {
      setNextOn(!on);
      toast.error(errorText(err));
    });
  };
  return (
    <>
      <SettingsGroup label="Skipping">
        <ChoiceRow title="Skip back" value={skip.back} choices={SKIP_BACK_OPTIONS.map((s) => ({ id: s, label: `${s} seconds` }))} onPick={(s) => setSkip({ ...skip, back: s })} />
        <ChoiceRow
          title="Skip forward"
          value={skip.forward}
          choices={SKIP_FORWARD_OPTIONS.map((s) => ({ id: s, label: `${s} seconds` }))}
          onPick={(s) => setSkip({ ...skip, forward: s })}
        />
      </SettingsGroup>
      {watch ? (
        <SettingsGroup label="Video">
          <ChoiceRow
            title="Converted video"
            sub={<SettingSub>When the server has to convert a video. 720p is easier on a small server</SettingSub>}
            value={quality}
            choices={[
              { id: "full", label: "1080p" },
              { id: "light", label: "720p" },
            ]}
            onPick={pickQuality}
          />
          <SwitchRow title="Play next episode" label="Play next episode" checked={nextOn} onChange={toggleNext} />
        </SettingsGroup>
      ) : null}
      {adsEnabled ? (
        <SettingsGroup label="Podcasts">
          <ChoiceRow
            title="Ads"
            sub={<SettingSub>{`This device only. ${AD_MODES.find((m) => m.id === adPrefs.mode)?.hint}.`}</SettingSub>}
            value={adPrefs.mode}
            choices={AD_MODES}
            onPick={(mode) => adPrefsStore.set({ ...adPrefs, mode })}
          />
        </SettingsGroup>
      ) : null}
    </>
  );
}

/** Which optional tabs show, saved to your account so every device matches. */
function TabsCard({
  tabs,
  books,
  music,
  watch,
  onSaved,
}: {
  tabs: UserPrefs["tabs"];
  books: number;
  music: MusicSummaryDto;
  watch: WatchSummaryDto;
  onSaved: () => void;
}) {
  const [shown, setShown] = useState(tabs);
  const toggle = (tab: keyof UserPrefs["tabs"], on: boolean) => {
    const next = { ...shown, [tab]: on };
    setShown(next);
    api(apiPaths.prefs, { method: "PUT", body: { tabs: next } }).then(onSaved, (err: unknown) => {
      setShown(shown);
      toast.error(errorText(err));
    });
  };
  return (
    <SettingsGroup label="Choose what you see">
      <SwitchRow
        title="Books in Library"
        sub={books ? plural(books, "book") : undefined}
        label="Books in Library"
        checked={shown.books !== false}
        onChange={(on) => toggle("books", on)}
      />
      <SwitchRow
        title="Music in Library"
        sub={music.enabled ? plural(music.albums, "album") : undefined}
        label="Music in Library"
        checked={!!shown.music}
        onChange={(on) => toggle("music", on)}
      />
      <SwitchRow
        title="Watch in Library"
        sub={
          watch.enabled
            ? [watch.movies ? plural(watch.movies, "movie") : null, watch.shows ? plural(watch.shows, "show") : null].filter(Boolean).join(" and ") || "Nothing found yet"
            : undefined
        }
        label="Watch in Library"
        checked={!!shown.watch}
        onChange={(on) => toggle("watch", on)}
      />
      <SwitchRow title="Podcasts" label="Podcasts tab" checked={shown.podcasts} onChange={(on) => toggle("podcasts", on)} />
    </SettingsGroup>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  useEffect(() => setTheme(currentTheme()), []);
  return (
    <SettingsGroup label="Look">
      <ChoiceRow
        title="Theme"
        value={theme}
        choices={THEME_CHOICES}
        onPick={(t) => {
          applyTheme(t);
          setTheme(t);
        }}
      />
    </SettingsGroup>
  );
}

function PasswordForm({ username, isAdmin }: { username: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <SettingsGroup label="Account">
      <Setting title="User" sub={<SettingSub>{isAdmin ? "Admin" : "Listener"}</SettingSub>}>
        <span className="setting-value set-plain">{username}</span>
      </Setting>
      <Setting title="Password">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          Change
        </button>
      </Setting>
      <Sheet open={open} onClose={() => setOpen(false)} title="Change password">
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            if (data.get("newPassword") !== data.get("confirm")) {
              setError("The new passwords don't match.");
              return;
            }
            setBusy(true);
            setError(null);
            try {
              await api(apiPaths.password, {
                method: "PUT",
                body: { currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") },
              });
              form.reset();
              setOpen(false);
              toast("Password changed. Other devices were signed out.");
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {/* Tells password managers whose password this is, so they don't suggest emails. */}
          <input className="sr-only" type="text" name="username" autoComplete="username" value={username} readOnly tabIndex={-1} aria-hidden="true" />
          <input className="input" name="currentPassword" type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" required />
          <input className="input" name="newPassword" type="password" autoComplete="new-password" placeholder="8 or more characters" aria-label="New password" minLength={8} required />
          <input className="input" name="confirm" type="password" autoComplete="new-password" placeholder="Repeat new password" aria-label="Repeat new password" minLength={8} required />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Change password
          </button>
          {error ? (
            <p className="error small" role="status" style={{ margin: 0 }}>
              {error}
            </p>
          ) : null}
        </form>
      </Sheet>
    </SettingsGroup>
  );
}

/** The server's version, with What's new when there's a newer one, and the nightly database backup. */
function VersionCard({ version, devBuild, updates, backup }: ServerVersionDto) {
  const update = updates?.update;
  const { sub } = versionStatus({ devBuild, updates });
  return (
    <SettingsGroup label="Server">
      <Setting title={`Murmur ${version}`} sub={sub ? <SettingSub>{sub}</SettingSub> : null}>
        {update ? (
          <a className="btn" href={update.url} target="_blank" rel="noreferrer">
            What&apos;s new
          </a>
        ) : null}
      </Setting>
      {/* Getting started explains restoring one. */}
      {backup ? <Setting title="Backups" sub={<SettingSub error={backup.failed}>{backupLine(backup).sub}</SettingSub>} /> : null}
    </SettingsGroup>
  );
}

/** TMDB's terms ask for their logo and this notice wherever their data shows. */
function TmdbCredit() {
  return (
    <SettingsGroup>
      <Setting
        title={
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" aria-label="TMDB">
            {/* eslint-disable-next-line @next/next/no-img-element -- a small local SVG */}
            <img src="/tmdb.svg" alt="TMDB" height={12} style={{ display: "block", marginBottom: 4 }} />
          </a>
        }
        sub={<SettingSub>This product uses the TMDB API but is not endorsed or certified by TMDB.</SettingSub>}
      />
    </SettingsGroup>
  );
}

const SCAN_POLL_MS = 2000;

/** A kind's count and scan status, with Rescan; spins until the scan is done, then refreshes. */
function ScanRow({ title, scan, kind }: { title: string; scan: ScanStatusDto; kind: keyof typeof apiPaths.scan }) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const running = scanning || scan.running;
  const rescan = async () => {
    setScanning(true);
    try {
      await api(apiPaths.scan[kind], { method: "POST" });
      for (;;) {
        await new Promise((r) => setTimeout(r, SCAN_POLL_MS));
        if (!(await api<LibraryAdminDto>(apiPaths.libraryAdmin))[kind].scan.running) break;
      }
      router.refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setScanning(false);
    }
  };
  return (
    <Setting title={title} sub={<SettingSub error={!!scan.lastError}>{running ? "Scanning now" : scanStatusText(scan)}</SettingSub>}>
      <button type="button" className={`btn ${running ? "spinning" : ""}`} disabled={running} onClick={() => void rescan()}>
        <RefreshIcon size={16} /> Rescan
      </button>
    </Setting>
  );
}

function EpisodeCacheCard({ cache, onChanged }: { cache: EpisodeCacheStatusDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const { ads } = cache;
  const scan = adScanStatus(ads, Date.now());

  return (
    <SettingsGroup label="Kept on the server">
      <ChoiceRow
        title="Episodes kept ready per podcast"
        sub={<SettingSub error={!cache.available}>{cache.available ? `${gigabytes(cache.usedBytes)} of ${gigabytes(cache.maxBytes)} used` : cache.error}</SettingSub>}
        value={cache.settings.episodesPerShow}
        choices={KEEP_PER_SHOW_OPTIONS.map((n) => ({ id: n, label: n === 0 ? "Off" : String(n) }))}
        disabled={busy}
        onPick={async (n) => {
          setBusy(true);
          try {
            await api(apiPaths.episodeCache, { method: "PUT", body: { episodesPerShow: n } });
            onChanged();
          } catch (err) {
            toast.error(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      />
      {ads.enabled ? (
        <Setting
          title="Ad detection"
          sub={
            <>
              <SettingSub error={scan.state === "error"}>{scan.text}</SettingSub>
              {scan.groqText ? <SettingSub error={scan.groqStuck}>{scan.groqText}</SettingSub> : null}
              <SettingSub>{scan.counts}</SettingSub>
            </>
          }
        >
          {ads.failed ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(apiPaths.adsRetry, { method: "POST" });
                  toast("Failed scans will run again.");
                  onChanged();
                } catch (err) {
                  toast.error(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshIcon size={18} />
              Retry
            </button>
          ) : null}
        </Setting>
      ) : null}
    </SettingsGroup>
  );
}

/** You > Library for admins: each kind's count, scan and lists, then its folders. */
function LibraryAdmin({
  libraryAdmin,
  folders,
  musicFolders,
  movieFolders,
  showFolders,
  video,
}: {
  libraryAdmin: LibraryAdminDto;
  folders: LibraryFolderDto[];
  musicFolders: LibraryFolderDto[];
  movieFolders: LibraryFolderDto[];
  showFolders: LibraryFolderDto[];
  video: VideoStatus | null;
}) {
  const b = libraryAdmin.books;
  return (
    <>
      <SettingsGroup label="Books">
        <ScanRow title={plural(b.total, "book")} scan={b.scan} kind="books" />
        {/* Empty lists aren't worth a row (audit WB43); one waiting for a look gets an accent count. */}
        {b.attention ? <SettingLink title="Needs attention" badge={b.attention} href="/you/library/attention" /> : null}
        {b.unmatched ? <SettingLink title="Not matched" value={plural(b.unmatched, "book")} href="/you/library/unmatched" /> : null}
        <FolderRows folders={folders} />
      </SettingsGroup>
      <SettingsGroup label="Music">
        <ScanRow title={plural(libraryAdmin.music.albums, "album")} scan={libraryAdmin.music.scan} kind="music" />
        {libraryAdmin.music.unmatched ? <SettingLink title="Not matched" value={plural(libraryAdmin.music.unmatched, "album")} href="/you/library/albums" /> : null}
        {musicFolders.length === 0 ? <Setting title="Folders" sub={<SettingSub>Mount your music at /music.</SettingSub>} /> : <FolderRows kind="music" folders={musicFolders} />}
      </SettingsGroup>
      <SettingsGroup label="Movies and shows">
        <ScanRow
          title={`${plural(libraryAdmin.watch.movies, "movie")} and ${plural(libraryAdmin.watch.shows, "show")}`}
          scan={libraryAdmin.watch.scan}
          kind="watch"
        />
        {video ? <Setting title="Video" sub={<SettingSub error={!!video.problem}>{video.problem ?? video.working}</SettingSub>} /> : null}
        {movieFolders.length + showFolders.length === 0 ? (
          <Setting title="Folders" sub={<SettingSub>Mount your movies at /movies and shows at /shows.</SettingSub>} />
        ) : null}
        <FolderRows kind="movies" folders={movieFolders} />
        <FolderRows kind="shows" folders={showFolders} />
      </SettingsGroup>
    </>
  );
}

const FOLDER_KINDS = {
  books: { item: "book", things: "books" },
  music: { item: "album", things: "albums" },
  movies: { item: "movie", things: "movies" },
  shows: { item: "show", things: "shows" },
};

/** A kind's folders with their counts. They come from what's mounted, so there's nothing to edit here. */
function FolderRows({ kind = "books", folders }: { kind?: keyof typeof FOLDER_KINDS; folders: LibraryFolderDto[] }) {
  const k = FOLDER_KINDS[kind];
  return folders.map((f) => (
    <div key={f.id} className="setting">
      <span className="setting-text">
        <span className="folder-path">{f.path}</span>
        <SettingSub error={!f.reachable}>{f.reachable ? `${f.books} ${f.books === 1 ? k.item : k.things}` : "The server can't open this folder."}</SettingSub>
      </span>
    </div>
  ));
}

/** Sign out, after asking, as in the app. */
function SignOut({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <SettingsGroup>
        {/* One "Sign out" on the row, not two (audit AB33). */}
        <button type="button" className="setting setting-link set-danger" onClick={() => setAsking(true)}>
          <span className="setting-title">Sign out</span>
        </button>
      </SettingsGroup>
      <ConfirmSheet
        open={asking}
        title="Sign out?"
        message="Your progress is saved on the server."
        confirmLabel="Sign out"
        danger={false}
        onConfirm={async () => {
          // The last progress save has to land before the token goes.
          await onSignOut();
          forgetBookmarks();
          await fetch(apiPaths.logout, { method: "POST" });
          window.location.href = "/login";
        }}
        onClose={() => setAsking(false)}
      />
    </>
  );
}

function UsersCard({ me, users, onChanged }: { me: UserDto; users: UserDto[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<UserDto | null>(null);

  const remove = async (u: UserDto) => {
    setBusy(true);
    try {
      await api(apiPaths.user(u.id), { method: "DELETE" });
      toast(`Removed ${u.username}`);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, `Couldn't remove ${u.username}.`));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  return (
    <SettingsGroup label="People">
      {users.map((u) => (
        <Setting key={u.id} title={`${u.username}${u.id === me.id ? " (you)" : ""}`} sub={<SettingSub>{u.isAdmin ? "Admin" : "Listener"}</SettingSub>}>
          {u.id !== me.id ? (
            <button type="button" className="btn btn-danger" onClick={() => setRemoving(u)}>
              Remove
            </button>
          ) : null}
        </Setting>
      ))}
      <Setting title="Add a user">
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <PlusIcon size={18} />
          Add
        </button>
      </Setting>
      <ConfirmSheet
        open={removing !== null}
        title={`Remove ${removing?.username ?? ""}?`}
        message="Their account, listening progress and queue are deleted from the server."
        confirmLabel="Remove"
        busy={busy}
        onConfirm={() => removing && void remove(removing)}
        onClose={() => setRemoving(null)}
      />
      {error && !adding ? <p className="error small">{error}</p> : null}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a user">
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            setBusy(true);
            setError(null);
            try {
              await api(apiPaths.users, {
                method: "POST",
                body: { username: data.get("username"), password: data.get("password"), isAdmin: data.get("isAdmin") === "on" },
              });
              form.reset();
              setAdding(false);
              toast(`Added ${String(data.get("username"))}`);
              onChanged();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input className="input" name="username" placeholder="Username" aria-label="New username" autoComplete="off" data-1p-ignore data-lpignore="true" required />
          <input
            className="input"
            name="password"
            type="password"
            placeholder="8 or more characters"
            aria-label="New user's password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <SwitchRow title={<span style={{ fontSize: 14 }}>Admin</span>} name="isAdmin" />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Add user
          </button>
          {error ? <p className="error small" style={{ margin: 0 }}>{error}</p> : null}
        </form>
      </Sheet>
    </SettingsGroup>
  );
}
