import { plural } from "@murmur/shared/client";
import { Card, SwitchRow } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { saveTabPrefs, useBooks, useMusicSummary, useTabPrefs } from "@/lib/data";
import { useMovies, useShows, useWatchHome } from "@/lib/watch";

/** What shows: Library's Books, Music and Watch, then the Podcasts tab. With all three off, Library hides. */
export default function TabsSettings() {
  const tabs = useTabPrefs();
  const books = useBooks().data?.filter((b) => b.missingSince === null).length ?? 0;
  const music = useMusicSummary().data;
  const hasWatch = !!useWatchHome().data?.enabled;
  const movies = useMovies(hasWatch).data?.length ?? 0;
  const shows = useShows(hasWatch).data?.length ?? 0;
  return (
    <SettingsPage title="Tabs">
      <Card>
        <SwitchRow
          title="Books in Library"
          sub={books ? `${plural(books, "book")} on your server` : undefined}
          label="Books in Library"
          value={tabs.books}
          onChange={(on) => saveTabPrefs({ ...tabs, books: on })}
        />
        <SwitchRow
          title="Music in Library"
          sub={music?.enabled ? `${plural(music.albums, "album")} on your server` : undefined}
          label="Music in Library"
          value={tabs.music}
          onChange={(on) => saveTabPrefs({ ...tabs, music: on })}
        />
        <SwitchRow
          title="Watch in Library"
          sub={
            hasWatch
              ? [movies ? plural(movies, "movie") : null, shows ? plural(shows, "show") : null].filter(Boolean).join(" and ") || "Nothing found yet"
              : undefined
          }
          label="Watch in Library"
          value={tabs.watch}
          onChange={(on) => saveTabPrefs({ ...tabs, watch: on })}
        />
        <SwitchRow title="Podcasts" label="Podcasts tab" value={tabs.podcasts} onChange={(podcasts) => saveTabPrefs({ ...tabs, podcasts })} last />
      </Card>
    </SettingsPage>
  );
}
