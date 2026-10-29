import { plural } from "@murmur/shared/client";
import { Card, SwitchRow } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { saveTabPrefs, useMusicSummary, useTabPrefs } from "@/lib/data";
import { useMovies, useShows, useWatchHome } from "@/lib/watch";

/** Which optional tabs show. Books and You are always there; Music and Watch are off until switched on. */
export default function TabsSettings() {
  const tabs = useTabPrefs();
  const music = useMusicSummary().data;
  const hasWatch = !!useWatchHome().data?.enabled;
  const movies = useMovies(hasWatch).data?.length ?? 0;
  const shows = useShows(hasWatch).data?.length ?? 0;
  return (
    <SettingsPage title="Tabs">
      <Card>
        <SwitchRow title="Podcasts" label="Podcasts tab" value={tabs.podcasts} onChange={(podcasts) => saveTabPrefs({ ...tabs, podcasts })} />
        <SwitchRow
          title="Music"
          sub={music?.enabled ? `${plural(music.albums, "album")} on your server` : undefined}
          label="Music tab"
          value={tabs.music}
          onChange={(on) => saveTabPrefs({ ...tabs, music: on })}
        />
        <SwitchRow
          title="Watch"
          sub={
            hasWatch
              ? [movies ? plural(movies, "movie") : null, shows ? plural(shows, "show") : null].filter(Boolean).join(" and ") || "Nothing found yet"
              : undefined
          }
          label="Watch tab"
          value={tabs.watch}
          onChange={(on) => saveTabPrefs({ ...tabs, watch: on })}
          last
        />
      </Card>
    </SettingsPage>
  );
}
