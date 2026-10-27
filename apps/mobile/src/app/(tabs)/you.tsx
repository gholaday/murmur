import { useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { plural, THEME_CHOICES } from "@murmur/shared/client";
import { DownloadIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { PageTitle, useTopInset } from "@/components/page";
import { Card, useEpisodeCache, useHealth, useServerVersion, useUsers } from "@/components/settings";
import { NavRow } from "@/components/settings-page";
import { LibraryTiles, ListeningStats } from "@/components/stats";
import { CardLink, Segmented } from "@/components/ui";
import { formatBytes, useDownloads } from "@/lib/downloads";
import { useSession } from "@/lib/session";
import { useTheme, useThemeMode } from "@/theme";

const VIEWS = [
  { id: "stats", label: "Stats" },
  { id: "settings", label: "Settings" },
] as const;

/**
 * Downloads at the top, then Stats (your listening and library) or Settings (a row for each
 * group). The tab stays mounted, so the one you're on is kept when you come back.
 */
export default function You() {
  const t = useTheme();
  const top = useTopInset();
  const user = useSession().user;
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("stats");

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: 32 }}>
        <PageTitle title="You" />

        <View style={{ marginTop: 16 }}>
          <DownloadsRow />
        </View>

        <Segmented options={VIEWS} value={view} onChange={setView} style={{ marginTop: 16 }} />

        {view === "stats" ? (
          <View style={{ marginTop: 24 }}>
            <ListeningStats />
            <LibraryTiles />
          </View>
        ) : (
          <View style={{ marginTop: 16 }}>
            <SettingsRows admin={!!user?.isAdmin} username={user?.username} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** The way into Downloads: how many are on this phone and their size. */
function DownloadsRow() {
  const t = useTheme();
  const all = Object.values(useDownloads());
  const bytes = all.reduce((sum, d) => sum + d.bytes, 0);
  return (
    <CardLink
      icon={<DownloadIcon size={22} color={t.accent} />}
      title="Downloads"
      sub={all.length ? `${all.length} on this phone, ${formatBytes(bytes)}` : "Nothing downloaded"}
      onPress={() => router.push("/downloads")}
    />
  );
}

function SettingsRows({ admin, username }: { admin: boolean; username?: string }) {
  const mode = useThemeMode();
  const version = useServerVersion().data;
  // Admin-only values; listeners can't read these.
  const health = useHealth(admin).data;
  const cache = useEpisodeCache(admin).data;
  const users = useUsers(admin).data;
  const perShow = cache?.settings.episodesPerShow;

  return (
    <Card>
      <NavRow title="Account" value={username} href="/account" />
      <NavRow title="Appearance" value={THEME_CHOICES.find((x) => x.id === mode)?.label} href="/appearance" />
      <NavRow title="Playback" href="/playback" />
      <NavRow title="Server" value={version ? `Murmur ${version.version}` : null} href="/server" />
      {admin ? (
        <>
          <NavRow title="Library" value={health ? plural(health.library.books, "book") : null} href="/library" />
          <NavRow title="Episode cache" value={perShow === undefined ? null : perShow === 0 ? "Off" : `${perShow} per show`} href="/episode-cache" />
          <NavRow title="Users" value={users ? String(users.length) : null} href="/users" />
        </>
      ) : null}
      <NavRow title="Tabs" href="/tab-settings" last />
    </Card>
  );
}
