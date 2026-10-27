// The settings rows on You, shared by the page (rows) and /you/<id> (one group per page).

export type SettingsSection = "account" | "appearance" | "playback" | "server" | "library" | "podcasts" | "users" | "tabs";

/** In the app's order; each opens /you/<id>. */
export const SECTIONS: Array<{ id: SettingsSection; title: string; admin?: boolean }> = [
  { id: "account", title: "Account" },
  { id: "appearance", title: "Appearance" },
  { id: "playback", title: "Playback" },
  { id: "server", title: "Server" },
  { id: "library", title: "Library", admin: true },
  { id: "podcasts", title: "Podcasts" },
  { id: "users", title: "Users", admin: true },
  { id: "tabs", title: "Tabs" },
];

/** The section a /you/<id> address names, if this person may open it. */
export function settingsSection(id: string, admin: boolean): SettingsSection | null {
  const s = SECTIONS.find((x) => x.id === id);
  return s && (admin || !s.admin) ? s.id : null;
}
