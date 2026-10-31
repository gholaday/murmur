import { shortDate } from "./format";
import type { BackupStatusDto, ServerVersionDto } from "./index";

// Settings shared by the web player and the Android app.

export type ThemeChoice = "system" | "dark" | "light";

export const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "System" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

/**
 * The line under "Murmur <version>" in Settings: a newer release, "Up to date" once GitHub
 * has been asked, else "Development build" for a dev server. `warn` marks an update.
 */
export function versionStatus(v: Pick<ServerVersionDto, "devBuild" | "updates">): { sub: string | null; dot: "ok" | "warn" | null } {
  const update = v.updates?.update;
  if (update) return { sub: `Version ${update.latest} is available`, dot: "warn" };
  if (v.updates?.checked) return { sub: "Up to date", dot: "ok" };
  return { sub: v.devBuild ? "Development build" : null, dot: null };
}

/** Two nights without a backup is worth a look: the server was off at the hour, or the disk is full. */
const BACKUP_STALE_MS = 48 * 60 * 60 * 1000;

/** The line under Backups in Settings. `warn` marks a failed or overdue backup. */
export function backupLine(b: BackupStatusDto, now = Date.now()): { sub: string; dot: "ok" | "warn" } {
  if (b.failed) return { sub: "The last backup failed", dot: "warn" };
  if (b.at === null) return { sub: `The first backup runs at ${b.hour}:00`, dot: "ok" };
  const day = shortDate(b.at, now);
  const when = day === "Today" || day === "Yesterday" ? day.toLowerCase() : day;
  return { sub: `Last backed up ${when}`, dot: now - b.at > BACKUP_STALE_MS ? "warn" : "ok" };
}
