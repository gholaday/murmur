"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
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
  type ThemeChoice,
  type UserDto,
} from "@murmur/shared/client";
import { api } from "../api";
import { BackIcon, FolderIcon, PlusIcon } from "../icons";
import { AD_MODES, adPrefsStore, useAdPrefs } from "../player/ad-prefs";
import { usePlayer } from "../player/engine";
import { Sheet } from "../sheet";
import { applyTheme, currentTheme } from "../theme";

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
  user,
  users,
  folders,
  adsEnabled,
  cache,
  server,
}: {
  user: UserDto;
  users: UserDto[];
  folders: LibraryFolderDto[];
  adsEnabled: boolean;
  cache: EpisodeCacheStatusDto | null;
  server: ServerInfo;
}) {
  const router = useRouter();
  const player = usePlayer();
  const adPrefs = useAdPrefs();

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">{user.username}</div>
        </div>
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
      </div>

      <section className="section">
        <h2 className="section-title">Appearance</h2>
        <ThemePicker />
      </section>

      <section className="section">
        <h2 className="section-title">Playback</h2>
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
      </section>

      <section className="section">
        <h2 className="section-title">Account</h2>
        <PasswordForm username={user.username} isAdmin={user.isAdmin} />
      </section>

      {user.isAdmin ? (
        <>
          <section className="section">
            <h2 className="section-title">Server</h2>
            <VersionCard version={server.version} devBuild={server.devBuild} updates={server.updates} />
          </section>
          <section className="section">
            <h2 className="section-title">Library</h2>
            <LibraryCard server={server} onScanned={() => router.refresh()} />
            <FoldersCard folders={folders} onSaved={() => router.refresh()} />
          </section>
          <section className="section">
            <h2 className="section-title">Users</h2>
            <UsersCard me={user} users={users} onChanged={() => router.refresh()} />
          </section>
        </>
      ) : null}

      <section className="section">
        <h2 className="section-title">Podcasts</h2>
        {cache ? <EpisodeCacheCard cache={cache} onChanged={() => router.refresh()} /> : null}
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
      </section>
    </>
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

function VersionCard({ version, devBuild, updates }: { version: string; devBuild: boolean; updates: ServerInfo["updates"] }) {
  const update = updates?.update;
  const status = update ? `Version ${update.latest} is available` : updates?.checked ? "Up to date" : null;
  const sub = status ?? (devBuild ? "Development build" : null);
  return (
    <div className="card-box">
      <div className="setting">
        <span className="setting-text">
          <span className="setting-title">
            {status ? <span className={`status-dot ${update ? "warn" : ""}`} /> : null}
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

function FoldersCard({ folders, onSaved }: { folders: LibraryFolderDto[]; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const save = async (paths: string[], done: string) => {
    setBusy(true);
    try {
      await api<LibraryFolderDto[]>("/api/library/folders", { method: "PUT", body: { paths } });
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
              {f.reachable ? `${f.books} ${f.books === 1 ? "book" : "books"}` : "The server can't open this folder."}
            </span>
          </span>
          {folders.length > 1 ? (
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
                      "Folder removed. Its books leave the library after the rescan.",
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
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a library folder">
        {adding ? (
          <AddFolderForm
            others={folders.map((f) => f.path)}
            start={folders[0]?.path ?? ""}
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
