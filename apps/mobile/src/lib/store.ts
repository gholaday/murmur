import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { getJson, setJson } from "./storage";

// One value kept outside React, so code away from any screen can read and change it, and a screen
// only renders again when what it reads changes.

export interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
  useValue(): T;
  /** Part of the value. Return a primitive, or something that keeps its identity, or this renders every time. */
  useSelect<S>(select: (value: T) => S): S;
}

/**
 * `foregroundOnly` is for values that change many times a second: in the background nothing on
 * screen shows them, so listeners skip React entirely and catch up when the app comes back.
 */
export function createStore<T>(initial: T, opts: { foregroundOnly?: boolean } = {}): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  let active = true;
  if (opts.foregroundOnly) {
    active = AppState.currentState !== "background";
    AppState.addEventListener("change", (s) => {
      active = s !== "background";
      if (active) notify();
    });
  }
  const get = () => value;
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  };
  return {
    get,
    set(next) {
      value = next;
      if (active) notify();
    },
    subscribe,
    useValue: () => useSyncExternalStore(subscribe, get),
    useSelect: (select) => useSyncExternalStore(subscribe, () => select(value)),
  };
}

/** A store kept on the phone under `key`. */
export function createSavedStore<T>(key: string, fallback: T): Store<T> {
  const store = createStore<T>(getJson<T>(key) ?? fallback);
  return {
    ...store,
    set(next) {
      setJson(key, next);
      store.set(next);
    },
  };
}
