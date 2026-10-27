"use client";

import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  apiPaths,
  adScanStatus,
  errorText,
  gigabytes,
  joinPath,
  KEEP_PER_SHOW_OPTIONS,
  shortDate,
  SKIP_BACK_OPTIONS,
  SKIP_FORWARD_OPTIONS,
  THEME_CHOICES,
  type EpisodeCacheStatusDto,
  type FolderBrowseDto,
  type FolderCheckDto,
  type LibraryFolderDto,
  type ServerVersionDto,
  type ThemeChoice,
  versionStatus,
  type UserDto,
  type UserPrefs,
  type MusicSummaryDto,
  plural,
} from "@murmur/shared/client";
import { api } from "../api";
import { BackIcon, FolderIcon, PlusIcon } from "../icons";
import { AD_MODES, adPrefsStore, useAdPrefs } from "../player/ad-prefs";
import { usePlayer } from "../player/engine";
import { Sheet } from "../sheet";
import { applyTheme, currentTheme } from "../theme";
import { BackRow, Chip, Chips, ConfirmRemove, EmptyState, Segmented, Setting, SettingLink, SettingsCard, SettingSub, StatTile, SwitchRow } from "../ui";
import { SECTIONS, type SettingsSection } from "./sections";
import { ListeningStats } from "./stats";

interface ServerInfo {
  version: string;
  devBuild: boolean;
  /** For admins: whether GitHub has been asked yet, and any newer release it has. */
  updates: { checked: boolean; update: { latest: string; url: string } | null } | null;
  books: number;
  scanRunning: boolean;
  lastScanAt: number | null;
  lastScanError: string | null;
  watcher: "events" | "polling" | "periodic-only";
}

export function ProfileView({
  section,
  user,
  users,
  folders,
  adsEnabled,
  cache,
  server,
  shows,
  tabs,
  musicFolders,
  music,
}: {
  /** One settings group on its own page; none is You itself. */
  section?: SettingsSection;
  musicFolders: LibraryFolderDto[];
  music: MusicSummaryDto;
  shows: number;
  tabs: UserPrefs["tabs"];
  user: UserDto;
  users: UserDto[];
  folders: LibraryFolderDto[];
  adsEnabled: boolean;
  cache: EpisodeCacheStatusDto | null;
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
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  player.stop();
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.href = "/login";
                }}
              >
                Sign out
              </button>
            </>
          ) : section === "appearance" ? (
            <ThemePicker />
          ) : section === "playback" ? (
            <PlaybackCard adsEnabled={adsEnabled} />
          ) : section === "server" ? (
            <VersionCard version={server.version} devBuild={server.devBuild} updates={server.updates} />
          ) : section === "library" ? (
            <>
              <LibraryCard server={server} onScanned={refresh} />
              <h2 className="section-title">Book folders</h2>
              <FoldersCard folders={folders} otherPaths={musicFolders.map((f) => f.path)} onSaved={refresh} />
              <h2 className="section-title">Music folders</h2>
              {musicFolders.length === 0 ? (
                <p className="muted small" style={{ margin: 0 }}>
                  Add a folder of music to turn on the Music tab. Albums come from the songs' tags, or from Artist/Album folders when there are none.
                </p>
              ) : null}
              <FoldersCard kind="music" folders={musicFolders} otherPaths={folders.map((f) => f.path)} onSaved={refresh} />
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
            <TabsCard tabs={tabs} music={music} onSaved={refresh} />
          )}
        </div>
      </>
    );
  }

  const values: Partial<Record<SettingsSection, string | null>> = {
    account: user.username,
    appearance: THEME_CHOICES.find((t) => t.id === theme)?.label,
    server: `Murmur ${server.version}`,
    library: plural(server.books, "book"),
    podcasts: plural(shows, "show"),
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
          <ListeningStats tabs={tabs} />

          <section className="section">
            <h2 className="section-title">Your library</h2>
            <div className="stats-tiles">
              <StatTile value={server.books} label="Books" />
              {tabs.podcasts ? <StatTile value={shows} label="Podcasts" /> : null}
              {tabs.music && music.enabled ? <StatTile value={music.mine.albums} label="Albums" /> : null}
            </div>
          </section>
        </>
      ) : (
        <section className="section">
          <SettingsCard>
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
function PlaybackCard({ adsEnabled }: { adsEnabled: boolean }) {
  const player = usePlayer();
  const adPrefs = useAdPrefs();
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
      {adsEnabled ? (
        <Setting title="Ads" sub={<SettingSub>This device only</SettingSub>} wrap>
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
function TabsCard({ tabs, music, onSaved }: { tabs: UserPrefs["tabs"]; music: MusicSummaryDto; onSaved: () => void }) {
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
      {/* Music can only be shown once the server has some. */}
      {music.enabled ? (
        <SwitchRow
          title="Music"
          sub={`${plural(music.albums, "album")} on your server`}
          label="Music tab"
          checked={shown.music}
          onChange={(on) => toggle("music", on)}
        />
      ) : null}
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
          <input className="input" name="newPassword" type="password" autoComplete="new-password" placeholder="New password (8+ characters)" aria-label="New password" minLength={8} required />
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

function VersionCard({ version, devBuild, updates }: ServerVersionDto) {
  const update = updates?.update;
  const { sub, dot } = versionStatus({ version, devBuild, updates });
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

function LibraryCard({ server, onScanned }: { server: ServerInfo; onScanned: () => void }) {
  const [busy, setBusy] = useState(false);
  const status = server.scanRunning
    ? "Scanning now…"
    : server.lastScanError
      ? server.lastScanError
      : server.lastScanAt
        ? `Last scanned ${shortDate(server.lastScanAt).toLowerCase()} at ${new Date(server.lastScanAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
        : "Not scanned yet";
  return (
    <SettingsCard>
      <Setting
        title={`${server.books} books`}
        dot={server.lastScanError ? "warn" : "ok"}
        sub={<SettingSub error={!!server.lastScanError}>{status}</SettingSub>}
      >
        <button
          type="button"
          className="btn"
          disabled={busy || server.scanRunning}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/api/library/scan", { method: "POST" });
              toast("Scan started. New books appear when it finishes.");
              setTimeout(onScanned, 3000);
            } catch (err) {
              toast.error(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Rescan
        </button>
      </Setting>
    </SettingsCard>
  );
}

function EpisodeCacheCard({ cache, onChanged }: { cache: EpisodeCacheStatusDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const { ads } = cache;
  const scan = adScanStatus(ads, Date.now());

  return (
    <SettingsCard>
      <Setting
        title="Episodes kept ready per show"
        sub={<SettingSub error={!cache.available}>{cache.available ? `${gigabytes(cache.usedBytes)} of ${gigabytes(cache.maxBytes)} used` : cache.error}</SettingSub>}
        wrap
      >
        <Chips kind="radio" label="Episodes kept ready per show">
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

const FOLDER_KINDS = {
  books: { url: "/api/library/folders", item: "book", things: "books", title: "Add a library folder", min: 1 },
  music: { url: "/api/music/folders", item: "album", things: "albums", title: "Add a music folder", min: 0 },
};

function FoldersCard({
  kind = "books",
  folders,
  otherPaths,
  onSaved,
}: {
  kind?: keyof typeof FOLDER_KINDS;
  folders: LibraryFolderDto[];
  /** The other kind's folders, which these may not overlap. */
  otherPaths: string[];
  onSaved: () => void;
}) {
  const k = FOLDER_KINDS[kind];
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const save = async (paths: string[], done: string) => {
    setBusy(true);
    try {
      await api<LibraryFolderDto[]>(k.url, { method: "PUT", body: { paths } });
      toast(done);
      onSaved();
      setTimeout(onSaved, 3000);
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

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
          {folders.length > k.min ? (
            <ConfirmRemove
              busy={busy}
              onConfirm={() =>
                save(
                  folders.filter((o) => o.id !== f.id).map((o) => o.path),
                  `Folder removed. Its ${k.things} leave the library after the rescan.`,
                )
              }
            />
          ) : null}
        </div>
      ))}
      <div className="setting">
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <PlusIcon size={18} />
          Add folder
        </button>
      </div>
      <Sheet open={adding} onClose={() => setAdding(false)} title={k.title}>
        {adding ? (
          <AddFolderForm
            others={[...folders.map((f) => f.path), ...otherPaths]}
            start={folders[0]?.path ?? otherPaths[0] ?? ""}
            busy={busy}
            onAdd={async (path) => {
              if (await save([...folders.map((f) => f.path), path], "Folder added. Scanning it now.")) setAdding(false);
            }}
          />
        ) : null}
      </Sheet>
    </SettingsCard>
  );
}

function AddFolderForm({
  others,
  start,
  busy,
  onAdd,
}: {
  others: string[];
  start: string;
  busy: boolean;
  onAdd: (path: string) => void;
}) {
  const [path, setPath] = useState("");
  const [check, setCheck] = useState<FolderCheckDto | null>(null);
  const [browse, setBrowse] = useState<FolderBrowseDto | null>(null);
  const othersKey = others.join("\n");

  // Checks what's typed after a short pause, so the result follows along without a button.
  useEffect(() => {
    setCheck(null);
    if (!path.trim()) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const body = { path, others: othersKey ? othersKey.split("\n") : [] };
        const result = await api<FolderCheckDto>("/api/library/folders/check", { method: "POST", body });
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
  // Start browsing next to the existing folder, where new ones usually live.
  useEffect(() => {
    void api<FolderBrowseDto>(`/api/library/browse?path=${encodeURIComponent(start)}`)
      .then((b) => (b.parent ? api<FolderBrowseDto>(`/api/library/browse?path=${encodeURIComponent(b.parent)}`) : b))
      .then(setBrowse, () => undefined);
  }, [start]);

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (check?.ok) onAdd(check.path);
      }}
    >
      <input
        className="input folder-path"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/audiobooks"
        aria-label="Folder path"
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
      <p className={`folder-check ${check ? (check.ok ? "ok" : "bad") : ""}`} role="status">
        {check ? check.message : path.trim() ? "Checking…" : "Type a path or pick a folder below."}
      </p>
      {browse ? (
        <div className="folder-browse">
          {browse.parent ? (
            <button type="button" onClick={() => void open(browse.parent!)}>
              <BackIcon size={18} />
              <span className="folder-path">{browse.parent}</span>
            </button>
          ) : null}
          {browse.folders.map((name) => {
            const full = joinPath(browse.path, name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={path === full}
                onClick={() => {
                  setPath(full);
                  void open(full);
                }}
              >
                <FolderIcon size={18} />
                {name}
              </button>
            );
          })}
          {browse.folders.length === 0 ? <EmptyState>No folders inside {browse.path}</EmptyState> : null}
        </div>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy || !check?.ok}>
        Add folder
      </button>
    </form>
  );
}

function UsersCard({ me, users, onChanged }: { me: UserDto; users: UserDto[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  return (
    <SettingsCard>
      {users.map((u) => (
        <Setting key={u.id} title={`${u.username}${u.id === me.id ? " (you)" : ""}`} sub={<SettingSub>{u.isAdmin ? "Admin" : "Listener"}</SettingSub>}>
          {u.id !== me.id ? (
            <ConfirmRemove
              confirmLabel="Delete"
              busy={busy}
              onConfirm={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api(`/api/users/${u.id}`, { method: "DELETE" });
                  toast(`Removed ${u.username}`);
                  onChanged();
                } catch (err) {
                  toast.error(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}
        </Setting>
      ))}
      <div className="setting">
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <PlusIcon size={18} />
          Add user
        </button>
      </div>
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
            placeholder="Password (8+ characters)"
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
