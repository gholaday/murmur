// JSON kept in this browser. Private windows and blocked storage just keep nothing: reads come back
// null and writes last only as long as the value in memory.

export function getJson<T>(key: string): T | null {
  let text: string | null;
  try {
    text = localStorage.getItem(key);
  } catch {
    return null;
  }
  try {
    return JSON.parse(text ?? "null") as T | null;
  } catch {
    // Something else wrote here. Starting over is all a page can do, but it shouldn't be silent.
    console.warn(`Ignored unreadable saved data in ${key}.`);
    return null;
  }
}

export function setJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // kept for this visit only
  }
}

export function removeKey(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // as above
  }
}
