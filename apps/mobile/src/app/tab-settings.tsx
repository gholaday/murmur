import { plural } from "@murmur/shared/client";
import { Card, SwitchRow } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { saveTabPrefs, useMusicSummary, useTabPrefs } from "@/lib/data";

/** Which optional tabs show. Books, Listening and You are always there; Music only with music on the server. */
export default function TabsSettings() {
  const tabs = useTabPrefs();
  const music = useMusicSummary().data;
  const hasMusic = !!music?.enabled;
  return (
    <SettingsPage title="Tabs">
      <Card>
        <SwitchRow
          title="Podcasts"
          label="Podcasts tab"
          value={tabs.podcasts}
          onChange={(podcasts) => saveTabPrefs({ ...tabs, podcasts })}
          last={!hasMusic}
        />
        {hasMusic ? (
          <SwitchRow
            title="Music"
            sub={`${plural(music.albums, "album")} on your server`}
            label="Music tab"
            value={tabs.music}
            onChange={(on) => saveTabPrefs({ ...tabs, music: on })}
            last
          />
        ) : null}
      </Card>
    </SettingsPage>
  );
}
