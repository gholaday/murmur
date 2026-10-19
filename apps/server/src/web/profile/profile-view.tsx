"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { shortDate, type UserDto } from "@murmur/shared";
import { api } from "../api";
import { PlusIcon } from "../icons";
import { usePlayer } from "../player/engine";
import { Sheet } from "../sheet";
import { applyTheme, currentTheme, type ThemeChoice } from "../theme";

const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: "system", label: "System" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];
const BACK_OPTIONS = [5, 10, 15, 30];
const FORWARD_OPTIONS = [10, 15, 30, 45, 60];

interface ServerInfo {
  version: string;
  books: number;
  scanRunning: boolean;
  lastScanAt: number | null;
  lastScanError: string | null;
  watcher: "events" | "polling" | "periodic-only";
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function ProfileView({ user, users, server }: { user: UserDto; users: UserDto[]; server: ServerInfo }) {
  const router = useRouter();
  const player = usePlayer();

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
              {BACK_OPTIONS.map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={player.skip.back === s} onClick={() => player.setSkip({ ...player.skip, back: s })}>
                  {s}s
                </button>
              ))}
            </div>
          </div>
          <div className="setting" style={{ flexWrap: "wrap", paddingBlock: 10 }}>
            <span className="setting-title">Skip forward</span>
            <div className="chips">
              {FORWARD_OPTIONS.map((s) => (
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
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Saved on this device. Playback speed is remembered per book and per show.
        </p>
      </section>

      <section className="section">
        <h2 className="section-title">Account</h2>
        <PasswordForm username={user.username} isAdmin={user.isAdmin} />
      </section>

      {user.isAdmin ? (
        <>
          <section className="section">
            <h2 className="section-title">Library</h2>
            <LibraryCard server={server} onScanned={() => router.refresh()} />
          </section>
          <section className="section">
            <h2 className="section-title">Users</h2>
            <UsersCard me={user} users={users} onChanged={() => router.refresh()} />
          </section>
        </>
      ) : null}

      <section className="section">
        <h2 className="section-title">Podcasts</h2>
        <div className="card-box">
          <div className="setting">
            <span className="setting-text">
              <span className="setting-title">Export subscriptions</span>
              <span className="setting-sub">An OPML file any podcast app can import.</span>
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
          <span className="setting-sub">Saved in this browser.</span>
        </span>
        <div className="chips" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
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
          <span className="setting-sub">
            {isAdmin ? "Can manage the library, auto-downloads and users." : "Can listen and keep their own progress."}
          </span>
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
              <span className="setting-sub">Can manage the library, auto-downloads and users.</span>
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
