import type { ApiError } from "@murmur/shared/client";

/** Same-origin JSON call that throws the server's error message on failure. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown; keepalive?: boolean }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    keepalive: init?.keepalive,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("Signed out.");
  }
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) throw new Error((data as ApiError | null)?.error ?? `Request failed (${res.status}).`);
  return data as T;
}
