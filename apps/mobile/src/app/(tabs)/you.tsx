import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { THEME_CHOICES } from "@murmur/shared/client";
import { DownloadIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { PageTitle, SectionTitle, useTopInset } from "@/components/page";
import { Card, useServerVersion, useUsers } from "@/components/settings";
import { NavRow } from "@/components/settings-page";
import { StatsBoundary, StatsCard } from "@/components/stats";
import { CardLink } from "@/components/ui";
import { formatBytes, useDownloads } from "@/lib/downloads";
import { useSession } from "@/lib/session";
import { useTheme, useThemeMode } from "@/theme";

/** Downloads at the top, then this week's stats card and Settings (a row for each group). */
export default function You() {
  const t = useTheme();
  const top = useTopInset();
  const user = useSession().user;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: 32 }}>
        <PageTitle title="You" />

        <View style={{ marginTop: 16 }}>
          <DownloadsRow />
        </View>

        <View style={{ marginTop: 16 }}>
          <StatsBoundary>
            <StatsCard />
          </StatsBoundary>
        </View>

        <SectionTitle title="Settings" />
        <SettingsRows admin={!!user?.isAdmin} username={user?.username} />
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
  // Admin-only; listeners can't read it.
  const users = useUsers(admin).data;

  return (
    <Card>
      <NavRow title="Account" value={username} href="/account" />
      <NavRow title="Appearance" value={THEME_CHOICES.find((x) => x.id === mode)?.label} href="/appearance" />
      <NavRow title="Playback" href="/playback" />
      <NavRow title="Server" value={version ? `Murmur ${version.version}` : null} href="/server" />
      {admin ? (
        <>
          <NavRow title="Library" href="/library" />
          <NavRow title="Podcasts" href="/episode-cache" />
          <NavRow title="Users" value={users ? String(users.length) : null} href="/users" />
        </>
      ) : null}
      <NavRow title="Tabs" href="/tab-settings" last />
    </Card>
  );
}
