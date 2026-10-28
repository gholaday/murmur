import { plural } from "@murmur/shared/client";
import { Card, SwitchRow } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { saveTabPrefs, useMusicSummary, useTabPrefs } from "@/lib/data";
import { useMovies, useShows, useWatchHome } from "@/lib/watch";

/** Which optional tabs show. Books, Listening and You are always there; Music and Watch only with them on the server. */
export default function TabsSettings() {
  const tabs = useTabPrefs();
  const music = useMusicSummary().data;
  const hasMusic = !!music?.enabled;
  const hasWatch = !!useWatchHome().data?.enabled;
  const movies = useMovies(hasWatch).data?.length ?? 0;
  const shows = useShows(hasWatch).data?.length ?? 0;
  return (
    <SettingsPage title="Tabs">
      <Card>
        <SwitchRow
          title="Podcasts"
          label="Podcasts tab"
          value={tabs.podcasts}
          onChange={(podcasts) => saveTabPrefs({ ...tabs, podcasts })}
          last={!hasMusic && !hasWatch}
        />
        {hasMusic ? (
          <SwitchRow
            title="Music"
            sub={`${plural(music.albums, "album")} on your server`}
            label="Music tab"
            value={tabs.music}
            onChange={(on) => saveTabPrefs({ ...tabs, music: on })}
            last={!hasWatch}
          />
        ) : null}
        {hasWatch ? (
          <SwitchRow
            title="Watch"
            sub={[movies ? plural(movies, "movie") : null, shows ? plural(shows, "show") : null].filter(Boolean).join(" and ") || "Nothing found yet"}
            label="Watch tab"
            value={tabs.watch !== false}
            onChange={(on) => saveTabPrefs({ ...tabs, watch: on })}
            last
          />
        ) : null}
      </Card>
    </SettingsPage>
  );
}
