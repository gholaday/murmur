import { bookSections, type UserPrefs, type UserPrefsPatch, userPrefsPatchSchema } from "@murmur/shared";
import type { AppContext } from "./context";

/** What's stored, keeping only the parts that still validate; a bad value falls back to its default. */
function readSaved(ctx: AppContext, userId: number): UserPrefsPatch {
  const row = ctx.sqlite.prepare("SELECT prefs FROM users WHERE id = ?").get(userId) as { prefs: string } | undefined;
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(row?.prefs ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(userPrefsPatchSchema.shape)) {
    const parsed = field.safeParse(raw[key]);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out as UserPrefsPatch;
}

/** Your settings with defaults filled in. */
export function getPrefs(ctx: AppContext, userId: number): UserPrefs {
  const saved = readSaved(ctx, userId);
  return { bookSections: bookSections(saved.bookSections) };
}

/** Saves the settings that were sent and leaves the rest as they were. */
export function updatePrefs(ctx: AppContext, userId: number, patch: UserPrefsPatch): UserPrefs {
  const next = { ...readSaved(ctx, userId), ...patch };
  ctx.sqlite.prepare("UPDATE users SET prefs = ? WHERE id = ?").run(JSON.stringify(next), userId);
  return getPrefs(ctx, userId);
}
