import { useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { SETTINGS_TABS, type SettingsTab, settingsTabs } from "@murmur/shared/client";
import { DownloadIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { PageTitle, useTopInset } from "@/components/page";
import { SettingsTabBody, VersionNotice } from "@/components/settings";
import { StatsBoundary, StatsCard } from "@/components/stats";
import { TextTabs } from "@/components/text-tabs";
import { CardLink, Text } from "@/components/ui";
import { useTabPrefs } from "@/lib/data";
import { formatBytes, useDownloads } from "@/lib/downloads";
import { useSession } from "@/lib/session";
import { fonts, useTheme } from "@/theme";

/** Any version problem, then Downloads, this week's stats, and Settings as text tabs, like the web's. */
export default function You() {
  const t = useTheme();
  const top = useTopInset();
  const admin = !!useSession().user?.isAdmin;
  const shown = settingsTabs(admin, useTabPrefs());
  const [picked, setPicked] = useState<SettingsTab>("playback");
  // A tab that went away (Podcasts turned off) falls back to the first.
  const tab = shown.includes(picked) ? picked : shown[0]!;
  const options = SETTINGS_TABS.filter((s) => shown.includes(s.id));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* 16 plus the last row's own 8 makes the 24 other screens leave at the bottom. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: 16 }}>
        <PageTitle title="You" />

        <VersionNotice />

        <View style={{ marginTop: 16 }}>
          <DownloadsRow />
        </View>

        <View style={{ marginTop: 16 }}>
          <StatsBoundary>
            <StatsCard />
          </StatsBoundary>
        </View>

        {/* The same size as the stats card's Stats, with a section's space above. */}
        <Text accessibilityRole="header" style={{ marginTop: 28, marginBottom: 8, fontFamily: fonts.extrabold, fontSize: 22, lineHeight: 30, letterSpacing: -0.3, color: t.text }}>
          Settings
        </Text>
        <TextTabs label="Settings" options={options} value={tab} onPick={setPicked} />
        <SettingsTabBody key={tab} tab={tab} />
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
