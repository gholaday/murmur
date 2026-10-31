"use client";

import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";
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
  type BackupStatusDto,
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
  plural,
} from "@murmur/shared/client";
import { api } from "../api";
import { RefreshIcon } from "../icons";
import { AD_MODES, adPrefsStore, useAdPrefs } from "../player/ad-prefs";
import { usePlayer } from "../player/engine";
import { ConfirmSheet, Sheet } from "../sheet";
import { applyTheme, currentTheme } from "../theme";
import { BackRow, Chip, Chips, Segmented, Setting, SettingLink, SettingsCard, SettingSub, StatTile, SwitchRow } from "../ui";
import { SECTIONS, type SettingsSection } from "./sections";
import { ListeningStats } from "./stats";

interface ServerInfo extends ServerVersionDto {
  books: number;
  watcher: "events" | "polling" | "periodic-only";
}

export function ProfileView({
  section,
  user,
  users,
  folders,
  adsEnabled,
  cache,
  libraryAdmin,
  server,
  shows,
  tabs,
  videoQuality,
  autoplayNext,
  musicFolders,
  movieFolders,
  showFolders,
  music,
  watch,
  video,
}: {
  /** One settings group on its own page; none is You itself. */
  section?: SettingsSection;
  musicFolders: LibraryFolderDto[];
  movieFolders: LibraryFolderDto[];
  showFolders: LibraryFolderDto[];
  watch: WatchSummaryDto;
  /** The video add-on, for admins once there are movie or show folders. */
  video: VideoStatus | null;
  music: MusicSummaryDto;
  shows: number;
  tabs: UserPrefs["tabs"];
  videoQuality: UserPrefs["videoQuality"];
  autoplayNext: boolean;
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
  const params = useSearchParams();
  const player = usePlayer();
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const view = params.get("tab") === "settings" ? "settings" : "stats";
  // Same as the library tabs: no server round trip, and Next keeps useSearchParams in step.
  const show = (next: "stats" | "settings") => window.history.pushState(null, "", next === "stats" ? "/you" : "/you?tab=settings");
  useEffect(() => setTheme(currentTheme()), []);

  if (section) {
    const refresh = () => router.refresh();
    return (
      <>
        <BackRow fallback="/you" />
        <div className="page-head">
          <h1 className="page-title">{SECTIONS.find((s) => s.id === section)!.title}</h1>
        </div>
        <div className="settings-page">
          {section === "account" ? (
            <>
              <PasswordForm username={user.username} isAdmin={user.isAdmin} />
              <SignOut onSignOut={player.stop} />
            </>
          ) : section === "appearance" ? (
            <ThemePicker />
          ) : section === "playback" ? (
            <PlaybackCard adsEnabled={adsEnabled} watch={watch.enabled} videoQuality={videoQuality} autoplayNext={autoplayNext} />
          ) : section === "server" ? (
            <>
              <VersionCard version={server.version} devBuild={server.devBuild} updates={server.updates} />
              {server.backup ? <BackupCard backup={server.backup} /> : null}
              {watch.enabled ? <TmdbCredit /> : null}
            </>
          ) : section === "library" ? (
            <>
              {libraryAdmin ? <LibraryAdmin libraryAdmin={libraryAdmin} folders={folders} musicFolders={musicFolders} movieFolders={movieFolders} showFolders={showFolders} video={video} /> : null}
            </>
          ) : section === "podcasts" ? (
            <>
              {cache ? <EpisodeCacheCard cache={cache} onChanged={refresh} /> : null}
              <SettingsCard>
                <Setting title="Export subscriptions">
                  <a className="btn" href="/api/podcasts/opml" download="murmur-podcasts.opml">
                    Export
                  </a>
                </Setting>
              </SettingsCard>
            </>
          ) : section === "users" ? (
            <UsersCard me={user} users={users} onChanged={refresh} />
          ) : (
            <TabsCard tabs={tabs} music={music} watch={watch} onSaved={refresh} />
          )}
        </div>
      </>
    );
  }
  const statsKinds = statsKindsShown(tabs);

  const values: Partial<Record<SettingsSection, string | null>> = {
    account: user.username,
    appearance: THEME_CHOICES.find((t) => t.id === theme)?.label,
    server: `Murmur ${server.version}`,
    users: String(users.length),
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">You</h1>
      </div>

      <Segmented
        label="You view"
        options={[
          { id: "stats", label: "Stats" },
          { id: "settings", label: "Settings" },
        ]}
        value={view}
        onChange={show}
      />

      {view === "stats" ? (
        <>
          <ListeningStats kinds={statsKinds} />

          <section className="section">
            <h2 className="section-title">Your library</h2>
            <div className="stats-tiles library-tiles">
              <StatTile value={server.books} label={server.books === 1 ? "Book" : "Books"} />
              {statsKinds.includes("episode") ? <StatTile value={shows} label={shows === 1 ? "Podcast" : "Podcasts"} /> : null}
              {statsKinds.includes("music") ? <StatTile value={music.mine.albums} label={music.mine.albums === 1 ? "Album" : "Albums"} /> : null}
              {statsKinds.includes("watch") && watch.movies ? <StatTile value={watch.movies} label={watch.movies === 1 ? "Movie" : "Movies"} /> : null}
              {statsKinds.includes("watch") && watch.shows ? <StatTile value={watch.shows} label={watch.shows === 1 ? "Show" : "Shows"} /> : null}
            </div>
          </section>
        </>
      ) : (
        <section className="section">
          <SettingsCard>
            {/* Library holds only Podcasts for everyone but admins, so it goes when that tab is hidden. */}
            {SECTIONS.filter((s) => (user.isAdmin || !s.admin) && (s.id !== "podcasts" || tabs.podcasts || user.isAdmin)).map((s) => (
              <SettingLink key={s.id} title={s.title} value={values[s.id]} href={`/you/${s.id}`} />
            ))}
          </SettingsCard>
        </section>
      )}
    </>
  );
}

/** Skip lengths, and what to do about ads when they're found. */
function PlaybackCard({
  adsEnabled,
  watch,
  videoQuality,
  autoplayNext,
}: {
  adsEnabled: boolean;
  watch: boolean;
  videoQuality: UserPrefs["videoQuality"];
  autoplayNext: boolean;
}) {
  const player = usePlayer();
  const adPrefs = useAdPrefs();
  const [quality, setQuality] = useState(videoQuality);
  const [nextOn, setNextOn] = useState(autoplayNext);
  const toggleNext = (on: boolean) => {
    setNextOn(on);
    api(apiPaths.prefs, { method: "PUT", body: { autoplayNext: on } }).catch((err: unknown) => {
      setNextOn(!on);
      toast.error(errorText(err));
    });
  };
  const pickQuality = (q: UserPrefs["videoQuality"]) => {
    setQuality(q);
    api(apiPaths.prefs, { method: "PUT", body: { videoQuality: q } }).catch((err: unknown) => {
      setQuality(quality);
      toast.error(errorText(err));
    });
  };
  return (
    <SettingsCard>
      <Setting title="Skip back" wrap>
        <Chips kind="radio" label="Skip back">
          {SKIP_BACK_OPTIONS.map((s) => (
            <Chip key={s} selected={player.skip.back === s} onClick={() => player.setSkip({ ...player.skip, back: s })}>
              {s}s
            </Chip>
          ))}
        </Chips>
      </Setting>
      <Setting title="Skip forward" wrap>
        <Chips kind="radio" label="Skip forward">
          {SKIP_FORWARD_OPTIONS.map((s) => (
            <Chip key={s} selected={player.skip.forward === s} onClick={() => player.setSkip({ ...player.skip, forward: s })}>
              {s}s
            </Chip>
          ))}
        </Chips>
      </Setting>
      {watch ? (
        <Setting title="Converted video" sub={<SettingSub>When the server has to convert a video. 720p is easier on a small server</SettingSub>} wrap>
          <Chips kind="radio" label="Converted video">
            <Chip selected={quality === "full"} onClick={() => pickQuality("full")}>
              1080p
            </Chip>
            <Chip selected={quality === "light"} onClick={() => pickQuality("light")}>
              720p
            </Chip>
          </Chips>
        </Setting>
      ) : null}
      {watch ? <SwitchRow title="Play next episode" label="Play next episode" checked={nextOn} onChange={toggleNext} /> : null}
      {adsEnabled ? (
        <Setting title="Ads" sub={<SettingSub>{`This device only. ${AD_MODES.find((m) => m.id === adPrefs.mode)?.hint}.`}</SettingSub>} wrap>
          <Chips kind="radio" label="Ads">
            {AD_MODES.map((m) => (
              <Chip key={m.id} selected={adPrefs.mode === m.id} onClick={() => adPrefsStore.set({ ...adPrefs, mode: m.id })}>
                {m.label}
              </Chip>
            ))}
          </Chips>
        </Setting>
      ) : null}
    </SettingsCard>
  );
}

/** Which optional tabs show, saved to your account so every device matches. */
function TabsCard({
  tabs,
  music,
  watch,
  onSaved,
}: {
  tabs: UserPrefs["tabs"];
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
    <SettingsCard>
      <SwitchRow title="Podcasts" label="Podcasts tab" checked={shown.podcasts} onChange={(on) => toggle("podcasts", on)} />
      <SwitchRow
        title="Music"
        sub={music.enabled ? `${plural(music.albums, "album")} on your server` : undefined}
        label="Music tab"
        checked={!!shown.music}
        onChange={(on) => toggle("music", on)}
      />
      <SwitchRow
        title="Watch"
        sub={
          watch.enabled
            ? [watch.movies ? plural(watch.movies, "movie") : null, watch.shows ? plural(watch.shows, "show") : null].filter(Boolean).join(" and ") || "Nothing found yet"
            : undefined
        }
        label="Watch tab"
        checked={!!shown.watch}
        onChange={(on) => toggle("watch", on)}
      />

    </SettingsCard>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  useEffect(() => setTheme(currentTheme()), []);
  return (
    <SettingsCard>
      <Setting title="Theme" wrap>
        <Chips kind="radio" label="Theme">
          {THEME_CHOICES.map((t) => (
            <Chip
              key={t.id}
              selected={theme === t.id}
              onClick={() => {
                applyTheme(t.id);
                setTheme(t.id);
              }}
            >
              {t.label}
            </Chip>
          ))}
        </Chips>
      </Setting>
    </SettingsCard>
  );
}

function PasswordForm({ username, isAdmin }: { username: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <SettingsCard>
      <Setting title={username}>
        <span className={`role-pill ${isAdmin ? "admin" : ""}`}>{isAdmin ? "Admin" : "Listener"}</span>
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
              await api("/api/me/password", {
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
    </SettingsCard>
  );
}

function VersionCard({ version, devBuild, updates }: Omit<ServerVersionDto, "backup">) {
  const update = updates?.update;
  const { sub, dot } = versionStatus({ devBuild, updates });
  return (
    <SettingsCard>
      <Setting title={`Murmur ${version}`} dot={dot ? (dot === "warn" ? "warn" : "ok") : undefined} sub={sub ? <SettingSub>{sub}</SettingSub> : null}>
        {update ? (
          <a className="btn" href={update.url} target="_blank" rel="noreferrer">
            What&apos;s new
          </a>
        ) : null}
      </Setting>
    </SettingsCard>
  );
}

/** The nightly database backup, for admins. Getting started explains restoring one. */
function BackupCard({ backup }: { backup: BackupStatusDto }) {
  const { sub, dot } = backupLine(backup);
  return (
    <SettingsCard>
      <Setting title="Backups" dot={dot} sub={<SettingSub error={backup.failed}>{sub}</SettingSub>} />
    </SettingsCard>
  );
}

/** TMDB's terms ask for their logo and this notice wherever their data shows. */
function TmdbCredit() {
  return (
    <SettingsCard>
      <Setting
        title={
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" aria-label="TMDB">
            {/* eslint-disable-next-line @next/next/no-img-element -- a small local SVG */}
            <img src="/tmdb.svg" alt="TMDB" height={12} style={{ display: "block", marginBottom: 4 }} />
          </a>
        }
        sub={<SettingSub>This product uses the TMDB API but is not endorsed or certified by TMDB.</SettingSub>}
      />
    </SettingsCard>
  );
}

const SCAN_POLL_MS = 2000;

/** A kind's count and scan status, with Rescan; spins until the scan is done, then refreshes. */
function ScanRow({ title, scan, url, kind }: { title: string; scan: ScanStatusDto; url: string; kind: keyof LibraryAdminDto }) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const running = scanning || scan.running;
  const rescan = async () => {
    setScanning(true);
    try {
      await api(url, { method: "POST" });
      for (;;) {
        await new Promise((r) => setTimeout(r, SCAN_POLL_MS));
        if (!(await api<LibraryAdminDto>("/api/library/admin"))[kind].scan.running) break;
      }
      router.refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setScanning(false);
    }
  };
  return (
    <Setting
      title={title}
      dot={scan.lastError ? "warn" : undefined}
      sub={<SettingSub error={!!scan.lastError}>{running ? "Scanning now" : scanStatusText(scan)}</SettingSub>}
    >
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
    <SettingsCard>
      <Setting
        title="Episodes kept ready per podcast"
        sub={<SettingSub error={!cache.available}>{cache.available ? `${gigabytes(cache.usedBytes)} of ${gigabytes(cache.maxBytes)} used` : cache.error}</SettingSub>}
        wrap
      >
        <Chips kind="radio" label="Episodes kept ready per podcast">
          {KEEP_PER_SHOW_OPTIONS.map((n) => (
            <Chip
              key={n}
              disabled={busy}
              selected={cache.settings.episodesPerShow === n}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/api/server/cache", { method: "PUT", body: { episodesPerShow: n } });
                  onChanged();
                } catch (err) {
                  toast.error(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {n === 0 ? "Off" : n}
            </Chip>
          ))}
        </Chips>
      </Setting>
      {ads.enabled ? (
        <Setting
          title="Ad detection"
          dot={scan.state === "ok" ? "ok" : "warn"}
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
                  await api("/api/server/ads/retry", { method: "POST" });
                  toast("Failed scans will run again.");
                  onChanged();
                } catch (err) {
                  toast.error(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Retry
            </button>
          ) : null}
        </Setting>
      ) : null}
    </SettingsCard>
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
  return (
    <>
      <h2 className="section-title">Books</h2>
      <SettingsCard>
        <ScanRow title={plural(libraryAdmin.books.total, "book")} scan={libraryAdmin.books.scan} url="/api/library/scan" kind="books" />
        <SettingLink title="Needs attention" dot={libraryAdmin.books.attention ? "warn" : undefined} value={plural(libraryAdmin.books.attention, "book")} href="/you/library/attention" />
        <SettingLink title="Not matched" value={plural(libraryAdmin.books.unmatched, "book")} href="/you/library/unmatched" />
      </SettingsCard>
      <FoldersCard folders={folders} />
      <h2 className="section-title">Music</h2>
      <SettingsCard>
        <ScanRow title={plural(libraryAdmin.music.albums, "album")} scan={libraryAdmin.music.scan} url="/api/music/scan" kind="music" />
        <SettingLink title="Not matched" value={plural(libraryAdmin.music.unmatched, "album")} href="/you/library/albums" />
      </SettingsCard>
      {musicFolders.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          Mount your music at /music.
        </p>
      ) : (
        <FoldersCard kind="music" folders={musicFolders} />
      )}
      <h2 className="section-title">Movies and shows</h2>
      <SettingsCard>
        <ScanRow
          title={`${plural(libraryAdmin.watch.movies, "movie")} and ${plural(libraryAdmin.watch.shows, "show")}`}
          scan={libraryAdmin.watch.scan}
          url="/api/watch/scan"
          kind="watch"
        />
        {video ? (
          <Setting title="Video" dot={video.problem ? "warn" : "ok"} sub={<SettingSub error={!!video.problem}>{video.problem ?? video.working}</SettingSub>} />
        ) : null}
      </SettingsCard>
      {movieFolders.length + showFolders.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          Mount your movies at /movies and shows at /shows.
        </p>
      ) : null}
      {movieFolders.length ? <FoldersCard kind="movies" folders={movieFolders} /> : null}
      {showFolders.length ? <FoldersCard kind="shows" folders={showFolders} /> : null}
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
function FoldersCard({ kind = "books", folders }: { kind?: keyof typeof FOLDER_KINDS; folders: LibraryFolderDto[] }) {
  const k = FOLDER_KINDS[kind];
  return (
    <SettingsCard>
      {folders.map((f) => (
        <div key={f.id} className="setting" style={{ paddingBlock: 8 }}>
          <span className="setting-text">
            <span className="folder-path">{f.path}</span>
            <SettingSub error={!f.reachable}>
              {f.reachable ? `${f.books} ${f.books === 1 ? k.item : k.things}` : "The server can't open this folder."}
            </SettingSub>
          </span>
        </div>
      ))}
    </SettingsCard>
  );
}

/** Sign out, after asking, as in the app. */
function SignOut({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <SettingsCard>
        <Setting title="Sign out">
          <button type="button" className="btn btn-danger" onClick={() => setAsking(true)}>
            Sign out
          </button>
        </Setting>
      </SettingsCard>
      <ConfirmSheet
        open={asking}
        title="Sign out?"
        message="Your progress is saved on the server."
        confirmLabel="Sign out"
        danger={false}
        onConfirm={async () => {
          // The last progress save has to land before the token goes.
          await onSignOut();
          await fetch("/api/auth/logout", { method: "POST" });
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
      await api(`/api/users/${u.id}`, { method: "DELETE" });
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
    <SettingsCard>
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
              await api("/api/users", {
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
    </SettingsCard>
  );
}
