import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";

// Small synchronous key-value store for settings and caches (SQLite-backed, survives restarts).
// Secrets go in SecureStore instead.

export function getJson<T>(key: string): T | null {
  try {
    const raw = Storage.getItemSync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function setJson(key: string, value: unknown) {
  Storage.setItemSync(key, JSON.stringify(value));
}

export function removeKey(key: string) {
  Storage.removeItemSync(key);
}

const TOKEN_KEY = "murmur.token";

export const secrets = {
  getToken: () => SecureStore.getItemAsync(TOKEN_KEY),
  setToken: (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token),
  clearToken: () => SecureStore.deleteItemAsync(TOKEN_KEY),
};
