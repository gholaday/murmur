"use client";

import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { BackIcon, ChevronIcon, FolderIcon, PlusIcon } from "../icons";
import { AD_MODES, adPrefsStore, useAdPrefs } from "../player/ad-prefs";
import { usePlayer } from "../player/engine";
import { Sheet } from "../sheet";
import { applyTheme, currentTheme } from "../theme";
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

/** A settings row: its name, an optional current value, and a chevron. */
function NavRow({ title, value, href }: { title: string; value?: string | null; href: string }) {
  return (
    <Link href={href} className="setting setting-link">
      <span className="setting-title">{title}</span>
      <span className="setting-value">
        {value ? <span>{value}</span> : null}
        <ChevronIcon />
      </span>
    </Link>
  );
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
  const player = usePlayer();
  const [theme, setTheme] = useState<ThemeChoice>("system");
  useEffect(() => setTheme(currentTheme()), []);

  if (section) {
    const refresh = () => router.refresh();
    return (
      <>
        <div className="back-row">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? router.back() : router.push("/you"))}>
            <BackIcon />
          </button>
        </div>
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
              <div className="card-box">
                <div className="setting">
                  <span className="setting-text">
                    <span className="setting-title">Export subscriptions</span>
                  </span>
                  <a className="btn" href="/api/podcasts/opml" download="murmur-podcasts.opml">
                    Export
                  </a>
                </div>
              </div>
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
    podcasts: tabs.podcasts ? plural(shows, "show") : "Hidden",
    users: String(users.length),
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">You</h1>
          <div className="page-sub">{user.username}</div>
        </div>
      </div>

      <ListeningStats />

      <section className="section">
        <h2 className="section-title">Your library</h2>
        <div className="stats-tiles">
          <div className="stats-tile">
            <div className="stats-tile-value">{server.books}</div>
            <div className="muted small">Books</div>
          </div>
          {tabs.podcasts ? (
            <div className="stats-tile">
              <div className="stats-tile-value">{shows}</div>
              <div className="muted small">Podcasts</div>
            </div>
          ) : null}
          {tabs.music && music.enabled ? (
            <div className="stats-tile">
              <div className="stats-tile-value">{music.mine.albums}</div>
              <div className="muted small">Albums</div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Settings</h2>
        <div className="card-box">
          {SECTIONS.filter((s) => user.isAdmin || !s.admin).map((s) => (
            <NavRow key={s.id} title={s.title} value={values[s.id]} href={`/you/${s.id}`} />
          ))}
        </div>
      </section>
    </>
  );
}

/** Skip lengths, and what to do about ads when they're found. */
function PlaybackCard({ adsEnabled }: { adsEnabled: boolean }) {
  const player = usePlayer();
  const adPrefs = useAdPrefs();
  return (
        <div className="card-box">
          <div className="setting" style={{ flexWrap: "wrap", paddingBlock: 10 }}>
            <span className="setting-title">Skip back</span>
            <div className="chips">
              {SKIP_BACK_OPTIONS.map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={player.skip.back === s} onClick={() => player.setSkip({ ...player.skip, back: s })}>
                  {s}s
                </button>
              ))}
            </div>
          </div>
          <div className="setting" style={{ flexWrap: "wrap", paddingBlock: 10 }}>
            <span className="setting-title">Skip forward</span>
            <div className="chips">
              {SKIP_FORWARD_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  aria-pressed={player.skip.forward === s}
                  onClick={() => player.setSkip({ ...player.skip, forward: s })}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
          {adsEnabled ? (
            <div className="setting" style={{ flexWrap: "wrap", paddingBlock: 10 }}>
              <span className="setting-text">
                <span className="setting-title">Ads</span>
                <span className="setting-sub">This device only</span>
              </span>
              <div className="chips" role="radiogroup" aria-label="Ads">
                {AD_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    className="chip"
                    aria-checked={adPrefs.mode === m.id}
                    aria-pressed={adPrefs.mode === m.id}
                    onClick={() => adPrefsStore.set({ ...adPrefs, mode: m.id })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
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
    <div className="card-box">
      <label className="switch">
        <span className="setting-title">Podcasts</span>
        <input type="checkbox" role="switch" aria-label="Podcasts tab" checked={shown.podcasts} onChange={(e) => toggle("podcasts", e.target.checked)} />
      </label>
      {/* Music can only be shown once the server has some. */}
      {music.enabled ? (
        <label className="switch">
          <span className="setting-text">
            <span className="setting-title">Music</span>
            <span className="setting-sub">{plural(music.albums, "album")} on your server</span>
          </span>
          <input type="checkbox" role="switch" aria-label="Music tab" checked={shown.music} onChange={(e) => toggle("music", e.target.checked)} />
        </label>
      ) : null}
    </div>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  useEffect(() => setTheme(currentTheme()), []);
  return (
    <div className="card-box">
      <div className="setting" style={{ flexWrap: "wrap", paddingBlock: 10 }}>
        <span className="setting-text">
          <span className="setting-title">Theme</span>
        </span>
        <div className="chips" role="radiogroup" aria-label="Theme">
          {THEME_CHOICES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              className="chip"
              aria-checked={theme === t.id}
              aria-pressed={theme === t.id}
              onClick={() => {
                applyTheme(t.id);
                setTheme(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PasswordForm({ username, isAdmin }: { username: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card-box">
      <div className="setting">
        <span className="setting-text">
          <span className="setting-title">{username}</span>
        </span>
        <span className={`role-pill ${isAdmin ? "admin" : ""}`}>{isAdmin ? "Admin" : "Listener"}</span>
      </div>
      <div className="setting">
        <span className="setting-text">
          <span className="setting-title">Password</span>
        </span>
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
      </div>
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
    </div>
  );
}

function VersionCard({ version, devBuild, updates }: ServerVersionDto) {
  const update = updates?.update;
  const { sub, dot } = versionStatus({ version, devBuild, updates });
  return (
    <div className="card-box">
      <div className="setting">
        <span className="setting-text">
          <span className="setting-title">
            {dot ? <span className={`status-dot ${dot === "warn" ? "warn" : ""}`} /> : null}
            Murmur {version}
          </span>
          {sub ? <span className="setting-sub">{sub}</span> : null}
        </span>
        {update ? (
          <a className="btn" href={update.url} target="_blank" rel="noreferrer">
            What&apos;s new
          </a>
        ) : null}
      </div>
    </div>
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
    <div className="card-box">
      <div className="setting">
        <span className="setting-text">
          <span className="setting-title">
            <span className={`status-dot ${server.lastScanError ? "warn" : ""}`} />
            {server.books} books
          </span>
          <span className={`setting-sub ${server.lastScanError ? "error" : ""}`}>{status}</span>
        </span>
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
      </div>
    </div>
  );
}

function EpisodeCacheCard({ cache, onChanged }: { cache: EpisodeCacheStatusDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const { ads } = cache;
  const scan = adScanStatus(ads, Date.now());

  return (
    <div className="card-box">
      <div className="setting" style={{ flexWrap: "wrap", paddingBlock: 10 }}>
        <span className="setting-text">
          <span className="setting-title">Episodes kept ready per show</span>
          <span className={`setting-sub ${cache.available ? "" : "error"}`}>
            {cache.available ? `${gigabytes(cache.usedBytes)} of ${gigabytes(cache.maxBytes)} used` : cache.error}
          </span>
        </span>
        <div className="chips" role="radiogroup" aria-label="Episodes kept ready per show">
          {KEEP_PER_SHOW_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              className="chip"
              disabled={busy}
              aria-checked={cache.settings.episodesPerShow === n}
              aria-pressed={cache.settings.episodesPerShow === n}
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
            </button>
          ))}
        </div>
      </div>
      {ads.enabled ? (
        <div className="setting">
          <span className="setting-text">
            <span className="setting-title">
              <span className={`status-dot ${scan.state === "ok" ? "" : "warn"}`} />
              Ad detection
            </span>
            <span className={`setting-sub ${scan.state === "error" ? "error" : ""}`}>{scan.text}</span>
            {scan.groqText ? <span className={`setting-sub ${scan.groqStuck ? "error" : ""}`}>{scan.groqText}</span> : null}
            <span className="setting-sub">{scan.counts}</span>
          </span>
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
        </div>
      ) : null}
    </div>
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
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
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
    <div className="card-box">
      {folders.map((f) => (
        <div key={f.id} className="setting" style={{ paddingBlock: 8 }}>
          <span className="setting-text">
            <span className="folder-path">{f.path}</span>
            <span className={`setting-sub ${f.reachable ? "" : "error"}`}>
              {f.reachable ? `${f.books} ${f.books === 1 ? k.item : k.things}` : "The server can't open this folder."}
            </span>
          </span>
          {folders.length > k.min ? (
            confirmRemove === f.id ? (
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button type="button" className="btn" onClick={() => setConfirmRemove(null)}>
                  Keep
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={async () => {
                    await save(
                      folders.filter((o) => o.id !== f.id).map((o) => o.path),
                      `Folder removed. Its ${k.things} leave the library after the rescan.`,
                    );
                    setConfirmRemove(null);
                  }}
                >
                  Remove
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-danger" style={{ flexShrink: 0 }} onClick={() => setConfirmRemove(f.id)}>
                Remove
              </button>
            )
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
    </div>
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
          {browse.folders.length === 0 ? <div className="empty">No folders inside {browse.path}</div> : null}
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
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="card-box">
      {users.map((u) => (
        <div key={u.id} className="setting">
          <span className="setting-text">
            <span className="setting-title">
              {u.username}
              {u.id === me.id ? " (you)" : ""}
            </span>
            <span className="setting-sub">{u.isAdmin ? "Admin" : "Listener"}</span>
          </span>
          {u.id !== me.id ? (
            confirmDelete === u.id ? (
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>
                  Keep
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={async () => {
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
                      setConfirmDelete(null);
                    }
                  }}
                >
                  Delete
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(u.id)}>
                Remove
              </button>
            )
          ) : null}
        </div>
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
          <label className="switch">
            <span className="setting-text">
              <span className="setting-title" style={{ fontSize: 14 }}>Admin</span>
            </span>
            <input type="checkbox" name="isAdmin" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Add user
          </button>
          {error ? <p className="error small" style={{ margin: 0 }}>{error}</p> : null}
        </form>
      </Sheet>
    </div>
  );
}
