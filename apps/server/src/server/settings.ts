import type { ServerSettings } from "@murmur/shared";
import type { Sqlite } from "./db";

const DEFAULTS: ServerSettings = { episodesPerShow: 3 };

/** Server-wide settings with defaults filled in; a bad stored value falls back to its default. */
export function getServerSettings(sqlite: Sqlite): ServerSettings {
  const rows = sqlite.prepare("SELECT key, value FROM server_settings").all() as Array<{ key: string; value: string }>;
  const out: ServerSettings = { ...DEFAULTS };
  for (const { key, value } of rows) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (key === "episodesPerShow" && Number.isInteger(parsed) && (parsed as number) >= 0) out.episodesPerShow = parsed as number;
    } catch {
      // keep the default
    }
  }
  return out;
}

export function saveServerSettings(sqlite: Sqlite, patch: Partial<ServerSettings>): ServerSettings {
  const upsert = sqlite.prepare(
    "INSERT INTO server_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  sqlite.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) upsert.run(key, JSON.stringify(value));
    }
  })();
  return getServerSettings(sqlite);
}

/** Small JSON values the server keeps for itself, such as the add-on's last report. */
export function readState<T>(sqlite: Sqlite, key: string): T | null {
  const row = sqlite.prepare("SELECT value FROM server_settings WHERE key = ?").get(`state:${key}`) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function writeState(sqlite: Sqlite, key: string, value: unknown) {
  sqlite
    .prepare("INSERT INTO server_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .run(`state:${key}`, JSON.stringify(value));
}
