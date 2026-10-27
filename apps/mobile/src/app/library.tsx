import { LibrarySection } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";

/** Admin: rescan, and the folders the server reads books from. */
export default function LibrarySettings() {
  return (
    <SettingsPage title="Library">
      <LibrarySection />
    </SettingsPage>
  );
}
