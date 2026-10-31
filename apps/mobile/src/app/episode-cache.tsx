import { EpisodeCacheSection } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";

/** Admin: You > Podcasts, how many episodes the server keeps ready per podcast, and ad detection. */
export default function PodcastSettings() {
  return (
    <SettingsPage title="Podcasts">
      <EpisodeCacheSection />
    </SettingsPage>
  );
}
