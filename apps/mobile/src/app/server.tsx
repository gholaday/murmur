import { ServerSection } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";

/** The server's version and whether there's a newer one, then this app's version. */
export default function ServerSettings() {
  return (
    <SettingsPage title="Server">
      <ServerSection />
    </SettingsPage>
  );
}
