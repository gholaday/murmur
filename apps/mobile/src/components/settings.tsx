import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
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
  type LibraryFolderDto,
  shortDate,
  type UserDto,
} from "@murmur/shared/client";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { fonts, useTheme } from "@/theme";
import { BackIcon, CheckIcon, FolderIcon } from "./icons";
import { ConfirmSheet, Sheet } from "./sheet";
import { Bone, FadeIn, Skeleton } from "./skeleton";
import { toast } from "./toast";
import { Button, Chip, Field, Text } from "./ui";

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
  children,
}: {
  title: string;
  sub?: string | null;
  subDanger?: boolean;
  stacked?: boolean;
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
function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
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

// ---------- Admin: library ----------

const libraryKeys = { health: ["health"], folders: ["library-folders"], users: ["users"], cache: ["episode-cache"] } as const;

/** Admin: how many recent episodes the server keeps ready per show, and how ad detection is doing. */
export function EpisodeCacheSection() {
  const t = useTheme();
  const cache = useQuery({ queryKey: libraryKeys.cache, queryFn: () => api<EpisodeCacheStatusDto>("/api/server/cache") });
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
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {KEEP_PER_SHOW_OPTIONS.map((n) => (
              <Chip
                key={n}
                label={n === 0 ? "Off" : String(n)}
                selected={c.settings.episodesPerShow === n}
                onPress={() => {
                  if (busy || c.settings.episodesPerShow === n) return;
                  void run(() => api("/api/server/cache", { method: "PUT", body: { episodesPerShow: n } }));
                }}
              />
            ))}
          </View>
        </Row>
        {ads.enabled ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 14 }}>
            <View style={{ flexShrink: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: scan.state === "ok" ? "#5ccf8a" : "#f0b45a" }} />
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

function scanStatus(h: HealthDto) {
  if (h.scan.running) return "Scanning now…";
  if (h.scan.lastError) return h.scan.lastError;
  if (!h.scan.lastFinishedAt) return "Not scanned yet";
  const time = new Date(h.scan.lastFinishedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Last scanned ${shortDate(h.scan.lastFinishedAt).toLowerCase()} at ${time}`;
}

/** Book count, last scan, Rescan, and the folders the server reads books from. */
export function LibrarySection() {
  const health = useQuery({ queryKey: libraryKeys.health, queryFn: () => api<HealthDto>("/api/health") });
  const folders = useQuery({ queryKey: libraryKeys.folders, queryFn: () => api<LibraryFolderDto[]>("/api/library/folders") });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<LibraryFolderDto | null>(null);
  const [adding, setAdding] = useState(false);
  const list = folders.data ?? [];

  const refreshSoon = () => {
    void queryClient.invalidateQueries({ queryKey: libraryKeys.health });
    void queryClient.invalidateQueries({ queryKey: libraryKeys.folders });
    // A scan runs on the server after this; check back once it has had a moment.
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: libraryKeys.health });
      void queryClient.invalidateQueries({ queryKey: libraryKeys.folders });
      void queryClient.invalidateQueries({ queryKey: ["books"] });
    }, 3000);
  };

  const rescan = async () => {
    setBusy(true);
    try {
      await api("/api/library/scan", { method: "POST" });
      toast.show("Scan started. New books appear when it finishes.");
      refreshSoon();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async (paths: string[], done: string) => {
    setBusy(true);
    try {
      await api<LibraryFolderDto[]>("/api/library/folders", { method: "PUT", body: { paths } });
      toast.show(done);
      refreshSoon();
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const h = health.data;
  return (
    <>
      <Card>
        {health.isPending ? (
          <Skeleton>
            <RowBone last />
          </Skeleton>
        ) : (
          <FadeIn>
            <Row
              title={h ? `${h.library.books} ${h.library.books === 1 ? "book" : "books"}` : "Library"}
              sub={h ? scanStatus(h) : health.isError ? health.error.message : null}
              subDanger={!!h?.scan.lastError || health.isError}
              last
            >
              <SmallButton label="Rescan" onPress={() => void rescan()} disabled={busy || !!h?.scan.running} />
            </Row>
          </FadeIn>
        )}
      </Card>
      <View style={{ height: 12 }} />
      <Card>
        {folders.isPending ? (
          <Skeleton>
            <RowBone />
          </Skeleton>
        ) : null}
        {folders.data ? (
          <FadeIn>
            {list.map((f) => (
              <Row
                key={f.id}
                title={f.path}
                sub={f.reachable ? `${f.books} ${f.books === 1 ? "book" : "books"}` : "The server can't open this folder."}
                subDanger={!f.reachable}
              >
                {list.length > 1 ? <SmallButton label="Remove" danger onPress={() => setRemoving(f)} /> : null}
              </Row>
            ))}
          </FadeIn>
        ) : null}
        <Row title="Add a folder" last>
          <SmallButton label="Add" onPress={() => setAdding(true)} />
        </Row>
      </Card>

      <ConfirmSheet
        open={removing !== null}
        title="Remove this folder?"
        message={`${removing?.path ?? ""} is removed from the library, and its books leave after the rescan. The files themselves aren't touched.`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) void save(list.filter((o) => o.id !== removing.id).map((o) => o.path), "Folder removed. Its books leave the library after the rescan.");
        }}
        onClose={() => setRemoving(null)}
      />
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a library folder">
        {adding ? (
          <AddFolder
            others={list.map((f) => f.path)}
            start={list[0]?.path ?? ""}
            busy={busy}
            onAdd={async (path) => {
              if (await save([...list.map((f) => f.path), path], "Folder added. Scanning it now.")) setAdding(false);
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
  const users = useQuery({ queryKey: libraryKeys.users, queryFn: () => api<UserDto[]>("/api/users") });
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
