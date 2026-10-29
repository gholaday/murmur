import { View } from "react-native";
import { ServerSection, TmdbCredit } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { useWatchHome } from "@/lib/watch";

/** The server's version and whether there's a newer one, then this app's version, and TMDB's credit when Watch is on. */
export default function ServerSettings() {
  const watch = !!useWatchHome().data?.enabled;
  return (
    <SettingsPage title="Server">
      <View style={{ gap: 12 }}>
        <ServerSection />
        {watch ? <TmdbCredit /> : null}
      </View>
    </SettingsPage>
  );
}
