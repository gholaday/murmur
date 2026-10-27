import { Switch } from "react-native";
import { plural } from "@murmur/shared/client";
import { Card, Row } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { saveTabPrefs, useMusicSummary, useTabPrefs } from "@/lib/data";
import { selectHaptic } from "@/lib/haptics";
import { useTheme } from "@/theme";

/** Which optional tabs show. Books, Listening and You are always there; Music only with music on the server. */
export default function TabsSettings() {
  const tabs = useTabPrefs();
  const music = useMusicSummary().data;
  const hasMusic = !!music?.enabled;
  return (
    <SettingsPage title="Tabs">
      <Card>
        <Row title="Podcasts" last={!hasMusic}>
          <TabSwitch label="Podcasts tab" value={tabs.podcasts} onChange={(podcasts) => saveTabPrefs({ ...tabs, podcasts })} />
        </Row>
        {hasMusic ? (
          <Row title="Music" sub={`${plural(music.albums, "album")} on your server`} last>
            <TabSwitch label="Music tab" value={tabs.music} onChange={(on) => saveTabPrefs({ ...tabs, music: on })} />
          </Row>
        ) : null}
      </Card>
    </SettingsPage>
  );
}

function TabSwitch({ label, value, onChange }: { label: string; value: boolean; onChange: (on: boolean) => void }) {
  const t = useTheme();
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      onValueChange={(on) => {
        selectHaptic();
        onChange(on);
      }}
      trackColor={{ false: t.track, true: t.accent }}
      thumbColor={value ? t.onAccent : t.faint}
    />
  );
}
