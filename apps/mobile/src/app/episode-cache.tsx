import { EpisodeCacheSection } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";

/** Admin: how many episodes the server keeps ready per show, and ad detection. */
export default function EpisodeCacheSettings() {
  return (
    <SettingsPage title="Episode cache">
      <EpisodeCacheSection />
    </SettingsPage>
  );
}
