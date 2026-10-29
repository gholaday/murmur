import crypto from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { count, eq } from "drizzle-orm";
import type { UserDto } from "@murmur/shared";
import { CAST_HEADER, CAST_PATH, castKey, checkCastToken } from "./cast";
import type { AppContext } from "./context";
import { sessions, users } from "./db/schema";
import { HttpError } from "./http";

export const SESSION_COOKIE = "murmur_session";
export const SESSION_MAX_AGE_SEC = 400 * 24 * 60 * 60; // browsers cap cookies at 400 days
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
/** A session unused for this long (the cookie's own life) is over on the server too, so a leaked token doesn't last forever. */
const SESSION_IDLE_MS = SESSION_MAX_AGE_SEC * 1000;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export const hashPassword = (password: string) => hash(password);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// A real hash to compare against when the username doesn't exist, so timing doesn't reveal valid names.
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash() {
  dummyHash ??= hash("murmur-timing-equaliser");
  return dummyHash;
}

export function userCount(ctx: AppContext): number {
  return ctx.db.select({ n: count() }).from(users).get()?.n ?? 0;
}

export function toUserDto(u: { id: number; username: string; isAdmin: boolean }): UserDto {
  return { id: u.id, username: u.username, isAdmin: u.isAdmin };
}

export function createSession(ctx: AppContext, userId: number, kind: "web" | "app", deviceName?: string): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  // Sessions nobody has used in over a year go, so the table doesn't keep every device ever signed in.
  ctx.sqlite.prepare("DELETE FROM sessions WHERE last_used_at < ?").run(now - SESSION_IDLE_MS);
  ctx.db
    .insert(sessions)
    .values({ id: sha256(token), userId, kind, deviceName: deviceName ?? null, createdAt: now, lastUsedAt: now })
    .run();
  return token;
}

export function deleteSession(ctx: AppContext, token: string) {
  ctx.db.delete(sessions).where(eq(sessions.id, sha256(token))).run();
}

/** Signs a user out everywhere except the session making this request. */
export function deleteOtherSessions(ctx: AppContext, userId: number, keepToken: string) {
  ctx.sqlite.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, sha256(keepToken));
}

export function userFromToken(ctx: AppContext, token: string): UserDto | null {
  const id = sha256(token);
  const row = ctx.db
    .select({ id: users.id, username: users.username, isAdmin: users.isAdmin, lastUsedAt: sessions.lastUsedAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  const now = Date.now();
  if (now - row.lastUsedAt > SESSION_IDLE_MS) {
    ctx.db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  if (now - row.lastUsedAt > TOUCH_INTERVAL_MS) {
    ctx.db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, id)).run();
  }
  return toUserDto(row);
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k !== name) continue;
    try {
      return decodeURIComponent(v.join("="));
    } catch {
      return null; // a mangled cookie is no session, not an error
    }
  }
  return null;
}

export function tokenFromRequest(req: Request): { token: string; viaCookie: boolean } | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return { token: auth.slice(7).trim(), viaCookie: false };
  const cookie = cookieValue(req.headers.get("cookie"), SESSION_COOKIE);
  return cookie ? { token: cookie, viaCookie: true } : null;
}

/**
 * Cookie-authenticated writes must come from our own origin. Bearer tokens can't be
 * sent by another site's page, so they need no such check.
 */
function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  // `URL.canParse` fails on "null" (a sandboxed or file page), which is cross-site too.
  if (!host || !URL.canParse(origin) || new URL(origin).host !== host) throw new HttpError(403, "Cross-site request blocked.");
}

/** A Chromecast's read of a stream or picture its cast link covers (see cast.ts). */
function castUser(ctx: AppContext, req: Request): UserDto | null {
  // The route sees the link as asked for (`/api/cast/<token>/<path>`), which the proxy always
  // serves as `<path>`; where it sees the rewritten path instead, the token comes in the header.
  const pathname = new URL(req.url).pathname;
  const link = CAST_PATH.exec(pathname);
  const token = link ? link[1]! : req.headers.get(CAST_HEADER);
  if (!token) return null;
  const id = checkCastToken(castKey(ctx.sqlite), token, req.method, link ? link[2]! : pathname);
  if (id === null) return null;
  const row = ctx.db.select({ id: users.id, username: users.username, isAdmin: users.isAdmin }).from(users).where(eq(users.id, id)).get();
  return row ? toUserDto(row) : null;
}

export function requireUser(ctx: AppContext, req: Request): UserDto {
  const found = tokenFromRequest(req);
  const user = (found ? userFromToken(ctx, found.token) : null) ?? castUser(ctx, req);
  if (!user) throw new HttpError(401, "Sign in to continue.");
  if (found?.viaCookie) assertSameOrigin(req);
  return user;
}

export function requireAdmin(ctx: AppContext, req: Request): UserDto {
  const user = requireUser(ctx, req);
  if (!user.isAdmin) throw new HttpError(403, "Only an admin can do that.");
  return user;
}

export function isSecureRequest(req: Request): boolean {
  return req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
}
