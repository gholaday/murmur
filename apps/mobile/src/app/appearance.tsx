import { THEME_CHOICES } from "@murmur/shared/client";
import { Card, Row } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { Chips } from "@/components/ui";
import { hapticsStore, useHapticsEnabled } from "@/lib/haptics";
import { setThemeMode, useThemeMode } from "@/theme";

const ON_OFF = [
  { id: true, label: "On" },
  { id: false, label: "Off" },
];

/** Theme and haptics, both kept on this phone. */
export default function AppearanceSettings() {
  const mode = useThemeMode();
  const haptics = useHapticsEnabled();
  return (
    <SettingsPage title="Appearance">
      <Card>
        <Row title="Theme">
          <Chips kind="radio" options={THEME_CHOICES} value={mode} onPick={setThemeMode} />
        </Row>
        <Row title="Haptics" sub="A light tap on play, skips and choices." last>
          <Chips kind="radio" options={ON_OFF} value={haptics} onPick={(on) => hapticsStore.set(on)} />
        </Row>
      </Card>
    </SettingsPage>
  );
}
