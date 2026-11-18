import { View } from "react-native";
import { Card, EpisodeCacheSection, SwitchRow } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { saveExplicitShows, useExplicitShows } from "@/lib/data";
import { useSession } from "@/lib/session";

/**
 * You > Podcasts: Explicit shows in Browse, which is yours; for admins, also how many episodes the
 * server keeps ready per podcast, and ad detection.
 */
export default function PodcastSettings() {
  const admin = !!useSession().user?.isAdmin;
  const explicit = useExplicitShows();
  return (
    <SettingsPage title="Podcasts">
      <View style={{ gap: 16 }}>
        {admin ? <EpisodeCacheSection /> : null}
        {/* A server from before Browse has no such setting. */}
        {explicit !== undefined ? (
          <Card>
            <SwitchRow title="Explicit shows in Browse" label="Explicit shows in Browse" value={explicit} onChange={saveExplicitShows} last />
          </Card>
        ) : null}
      </View>
    </SettingsPage>
  );
}
