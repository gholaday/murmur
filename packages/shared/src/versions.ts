// What a version number can promise (docs/spec/versions.md): within a major version nothing breaks,
// so only a different major is worth a word. Development builds aren't "x.y.z" and never count.

/** The major version, or null for one that isn't "x.y.z", like "dev". */
export function majorOf(version: string | null | undefined): number | null {
  const match = /^v?(\d+)\.\d+\.\d+/.exec(version ?? "");
  return match ? Number(match[1]) : null;
}

/** True when version a is newer than b. Both are "x.y.z", with or without a leading v. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10));
  const [x, y] = [parse(a), parse(b)];
  if (x.length !== 3 || y.length !== 3 || [...x, ...y].some((n) => !Number.isFinite(n))) return false;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i]! > y[i]!;
  }
  return false;
}

/** Which side needs updating when the app and the server are on different majors, or null when they're fine. */
export function outOfDate(appVersion: string | null | undefined, serverVersion: string | null | undefined): "app" | "server" | null {
  const app = majorOf(appVersion);
  const server = majorOf(serverVersion);
  if (app === null || server === null || app === server) return null;
  return app < server ? "app" : "server";
}

export const UPDATE_APP = "Update the app to use this server";
export const UPDATE_SERVER = "Update the server";

/** An add-on's status line when it's on another major from Murmur, or null when they work together. */
export function addonVersionProblem(name: string, addonVersion: string | null | undefined, murmurVersion: string | null | undefined): string | null {
  const addon = majorOf(addonVersion);
  const murmur = majorOf(murmurVersion);
  if (addon === null || murmur === null || addon === murmur) return null;
  return `The ${name} add-on is ${addonVersion} and Murmur is ${murmurVersion}. Update ${addon < murmur ? "the add-on" : "Murmur"} so they're on the same major version.`;
}
