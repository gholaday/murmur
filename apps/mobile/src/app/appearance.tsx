import { View } from "react-native";
import { THEME_CHOICES } from "@murmur/shared/client";
import { Card, Row } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { Chip } from "@/components/ui";
import { hapticsStore, useHapticsEnabled } from "@/lib/haptics";
import { setThemeMode, useThemeMode } from "@/theme";

/** Theme and haptics, both kept on this phone. */
export default function AppearanceSettings() {
  const mode = useThemeMode();
  const haptics = useHapticsEnabled();
  return (
    <SettingsPage title="Appearance">
      <Card>
        <Row title="Theme">
          <View style={{ flexDirection: "row", gap: 6 }}>
            {THEME_CHOICES.map((x) => (
              <Chip key={x.id} label={x.label} selected={mode === x.id} onPress={() => setThemeMode(x.id)} />
            ))}
          </View>
        </Row>
        <Row title="Haptics" sub="A light tap on play, skips and choices." last>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Chip label="On" selected={haptics} onPress={() => hapticsStore.set(true)} />
            <Chip label="Off" selected={!haptics} onPress={() => hapticsStore.set(false)} />
          </View>
        </Row>
      </Card>
    </SettingsPage>
  );
}
