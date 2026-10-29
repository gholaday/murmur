import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { LoginResponse, UserDto } from "@murmur/shared/client";
import { flushProgress, forgetProgress, stop as stopPlayer } from "@/player/engine";
import { api, clearEtags, configureApi, normalizeServerUrl, probeServer } from "./api";
import { APP_NAME } from "./platform";
import { clearPersistedCache, queryClient } from "./query";
import { getJson, removeKey, secrets, setJson } from "./storage";

const SERVER_KEY = "murmur.server";
const USER_KEY = "murmur.user";

interface Session {
  /** "loading" until the stored token has been read. */
  status: "loading" | "signedOut" | "signedIn";
  serverUrl: string | null;
  user: UserDto | null;
  signIn: (server: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

/**
 * Keeps the server URL, token and user. The token is stored in the Android keystore (the iOS keychain) and
 * kept until the server revokes it, so you sign in once per device.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Session["status"]>("loading");
  const [serverUrl, setServerUrl] = useState<string | null>(() => getJson<string>(SERVER_KEY));
  const [user, setUser] = useState<UserDto | null>(() => getJson<UserDto>(USER_KEY));

  // Everything of this account's goes, in memory and on disk, so the next one doesn't inherit its
  // lists or its unsent progress. Downloads stay: they're the server's files, and whoever signs in
  // next can play what's already here.
  const forget = useCallback(async () => {
    stopPlayer();
    await secrets.clearToken();
    removeKey(USER_KEY);
    configureApi({ serverUrl: getJson<string>(SERVER_KEY), token: null });
    clearEtags();
    forgetProgress();
    queryClient.clear();
    clearPersistedCache();
    setUser(null);
    setStatus("signedOut");
  }, []);

  useEffect(() => {
    void (async () => {
      const token = await secrets.getToken();
      configureApi({ serverUrl, token, onUnauthorized: () => void forget() });
      setStatus(token && serverUrl && user ? "signedIn" : "signedOut");
    })();
    // Runs once at startup with whatever was stored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(
    async (server: string, username: string, password: string) => {
      const url = normalizeServerUrl(server);
      await probeServer(url);
      let res: Response;
      try {
        res = await fetch(`${url}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, client: "app", deviceName: APP_NAME }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new Error("Couldn't reach the server.");
      }
      const body = (await res.json().catch(() => null)) as (LoginResponse & { error?: string }) | null;
      if (!res.ok || !body?.token) throw new Error(body?.error ?? "Sign-in failed.");
      await secrets.setToken(body.token);
      setJson(SERVER_KEY, url);
      setJson(USER_KEY, body.user);
      configureApi({ serverUrl: url, token: body.token, onUnauthorized: () => void forget() });
      setServerUrl(url);
      setUser(body.user);
      setStatus("signedIn");
    },
    [forget],
  );

  const signOut = useCallback(async () => {
    // What's playing saves its place, and anything listened to offline goes up, while the token still works.
    stopPlayer();
    await flushProgress();
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Signing out locally is what matters; the server token can be revoked later.
    }
    await forget();
  }, [forget]);

  const value = useMemo(() => ({ status, serverUrl, user, signIn, signOut }), [status, serverUrl, user, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
