import { ScrollView, View } from "react-native";
import { plural, THEME_CHOICES } from "@murmur/shared/client";
import { PAD } from "@/components/library";
import { PageTitle, useTopInset } from "@/components/page";
import { Card, useEpisodeCache, useHealth, useServerVersion, useUsers } from "@/components/settings";
import { NavRow } from "@/components/settings-page";
import { Eyebrow } from "@/components/listening";
import { LibraryTiles, ListeningStats } from "@/components/stats";
import { useTabPrefs } from "@/lib/data";
import { useSession } from "@/lib/session";
import { useTheme, useThemeMode } from "@/theme";

/** Your listening stats and library at the top, then a row for each group of settings. */
export default function You() {
  const t = useTheme();
  const top = useTopInset();
  const user = useSession().user;
  const tabs = useTabPrefs();

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: 32 }}>
        <PageTitle title="You" sub={user?.username} />

        <View style={{ marginTop: 16 }}>
          <ListeningStats />
          <LibraryTiles podcasts={tabs.podcasts} />
        </View>

        <View style={{ gap: 10, marginTop: 24 }}>
          <Eyebrow>Settings</Eyebrow>
          <SettingsRows admin={!!user?.isAdmin} username={user?.username} />
        </View>
      </ScrollView>
    </View>
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
