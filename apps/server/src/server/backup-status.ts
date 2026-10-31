import fs from "node:fs";
import type { BackupStatusDto } from "@murmur/shared";
import { env } from "./env";

// The nightly backup runs from the app's boot, but Settings reads its result from its own bundle.
// Next gives each bundle its own copy of this module, so the failure lives on globalThis, as the
// update checks' results do.
declare global {
  var __murmurBackupFailedAt: number | null | undefined;
}

export function noteBackupFailed() {
  globalThis.__murmurBackupFailedAt = Date.now();
}

/** When the newest nightly backup was written, from the backups folder so it survives a restart. */
export function backupStatus(): BackupStatusDto {
  let at: number | null = null;
  try {
    for (const f of fs.readdirSync(env.backupsDir)) {
      if (!f.startsWith("nightly-") || !f.endsWith(".db")) continue;
      const t = fs.statSync(`${env.backupsDir}/${f}`).mtimeMs;
      if (at === null || t > at) at = t;
    }
  } catch {
    // No backups folder yet: none have run.
  }
  const failedAt = globalThis.__murmurBackupFailedAt ?? null;
  return { at, failed: failedAt !== null && (at === null || failedAt > at), hour: env.backupHour };
}
