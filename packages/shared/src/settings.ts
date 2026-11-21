import { shortDate } from "./format";
import type { BackupStatusDto, ServerVersionDto, UserPrefs } from "./index";

// Settings shared by the web player and the Android app.

/** The tab the app opens on: Books, or the first one left when it's hidden. You is always there. */
export type LibrarySection = "books" | "music" | "watch";

export const LIBRARY_SECTION_LABELS: Record<LibrarySection, string> = { books: "Books", music: "Music", watch: "Watch" };

/** The sections Library shows, in order. None left hides the Library tab. */
export function librarySections(tabs: UserPrefs["tabs"]): LibrarySection[] {
  const out: LibrarySection[] = [];
  if (tabs.books !== false) out.push("books");
  if (tabs.music) out.push("music");
  if (tabs.watch) out.push("watch");
  return out;
}

/** Where the app opens: Library's first section, then Podcasts, then You. */
export function firstTab(tabs: UserPrefs["tabs"]): LibrarySection | "podcasts" | "you" {
  return librarySections(tabs)[0] ?? (tabs.podcasts ? "podcasts" : "you");
}

/** Settings' tabs on You, in order. Library, Users and Server are for admins. */
export type SettingsTab = "playback" | "appearance" | "podcasts" | "account" | "library" | "users" | "server";

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string; admin?: boolean }> = [
  { id: "playback", label: "Playback" },
  { id: "appearance", label: "Appearance" },
  { id: "podcasts", label: "Podcasts" },
  { id: "account", label: "Account" },
  { id: "library", label: "Library", admin: true },
  { id: "users", label: "Users", admin: true },
  { id: "server", label: "Server", admin: true },
];

/** The tabs this person sees. Podcasts' settings only matter while its tab shows, except to admins. */
export function settingsTabs(isAdmin: boolean, tabs: UserPrefs["tabs"]): SettingsTab[] {
  return SETTINGS_TABS.filter((t) => (isAdmin || !t.admin) && (t.id !== "podcasts" || isAdmin || tabs.podcasts)).map((t) => t.id);
}

/** The settings tab a /you/<id> address names; the old /you/tabs is now on Appearance. */
export function settingsTabFor(id: string): SettingsTab | null {
  if (id === "tabs") return "appearance";
  return SETTINGS_TABS.some((t) => t.id === id) ? (id as SettingsTab) : null;
}

const RELEASES = "https://github.com/gholaday/murmur/releases";

/** The Android app for this server's version, from its GitHub release; a dev build gets the releases page. */
export function androidAppUrl(version: string, devBuild: boolean): string {
  return devBuild ? `${RELEASES}/latest` : `${RELEASES}/download/v${version}/murmur-${version}.apk`;
}

/**
 * First-run steps, shown once per person, each with Skip: what's on the server (admins only),
 * which tabs to show, podcasts, and the app (on the web only; the app is already there).
 */
export type OnboardingStep = "library" | "tabs" | "podcasts" | "app";

export const ONBOARDING_TITLES: Record<OnboardingStep, { title: string; sub: string }> = {
  library: { title: "Your library", sub: "Murmur found these folders on the server. Scanning carries on while you set up." },
  tabs: { title: "Choose what you see", sub: "Turn on what you'll use. You can change this later in You." },
  podcasts: { title: "Your podcasts", sub: "Bring them over from another app, or find new ones." },
  app: { title: "Listen on your phone", sub: "The Android app plays offline and in the car. On iPhone, use this page." },
};

export function onboardingSteps(isAdmin: boolean, surface: "web" | "app"): OnboardingStep[] {
  const steps: OnboardingStep[] = isAdmin ? ["library", "tabs", "podcasts"] : ["tabs", "podcasts"];
  return surface === "web" ? [...steps, "app"] : steps;
}

/** The step's place: "2 of 4". */
export function stepLabel(step: OnboardingStep, steps: readonly OnboardingStep[]): string {
  return `${steps.indexOf(step) + 1} of ${steps.length}`;
}

export type ThemeChoice = "system" | "dark" | "light";

export const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "System" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

/**
 * The line under "Murmur <version>" in Settings: a newer release, "Up to date" once GitHub
 * has been asked, else "Development build" for a dev server. `warn` marks an update.
 */
export function versionStatus(v: Pick<ServerVersionDto, "devBuild" | "updates">): { sub: string | null; dot: "ok" | "warn" | null } {
  const update = v.updates?.update;
  if (update) return { sub: `Version ${update.latest} is available`, dot: "warn" };
  if (v.updates?.checked) return { sub: "Up to date", dot: "ok" };
  return { sub: v.devBuild ? "Development build" : null, dot: null };
}

/** Two nights without a backup is worth a look: the server was off at the hour, or the disk is full. */
const BACKUP_STALE_MS = 48 * 60 * 60 * 1000;

/** The line under Backups in Settings. `warn` marks a failed or overdue backup. */
export function backupLine(b: BackupStatusDto, now = Date.now()): { sub: string; dot: "ok" | "warn" } {
  if (b.failed) return { sub: "The last backup failed", dot: "warn" };
  if (b.at === null) return { sub: `The first backup runs at ${b.hour}:00`, dot: "ok" };
  const day = shortDate(b.at, now);
  const when = day === "Today" || day === "Yesterday" ? day.toLowerCase() : day;
  return { sub: `Last backed up ${when}`, dot: now - b.at > BACKUP_STALE_MS ? "warn" : "ok" };
}
