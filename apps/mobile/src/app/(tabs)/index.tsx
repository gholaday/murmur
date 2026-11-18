import { useState } from "react";
import { View } from "react-native";
import { Redirect } from "expo-router";
import { firstTab, type LibrarySection, librarySections } from "@murmur/shared/client";
import { useTabPrefs } from "@/lib/data";
import { librarySection } from "@/lib/library";
import { BooksSection } from "@/sections/books";
import { MusicSection } from "@/sections/music";
import { WatchSection } from "@/sections/watch";
import { useTheme } from "@/theme";

const SECTIONS: Record<LibrarySection, () => React.ReactNode> = { books: BooksSection, music: MusicSection, watch: WatchSection };

/**
 * Library: Books, Music and Watch, as You > Tabs has them. Tap a name in the title row to
 * switch; the last one open comes back next time. The app opens here, so with every section
 * off this sends you to the first tab left.
 */
export default function LibraryScreen() {
  const t = useTheme();
  const tabs = useTabPrefs();
  const sections = librarySections(tabs);
  const stored = librarySection.useValue();
  const current = sections.includes(stored) ? stored : sections[0];
  // Only the open section is drawn (and fetches) at first. Once drawn, a section is kept, so
  // coming back finds its tab and its place.
  const [drawn, setDrawn] = useState(() => new Set(current ? [current] : []));
  // With no sections, firstTab is Podcasts or You.
  if (!current) return <Redirect href={firstTab(tabs) === "podcasts" ? "/podcasts" : "/you"} />;
  if (!drawn.has(current)) setDrawn(new Set([...drawn, current]));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {sections.map((s) => {
        const Section = SECTIONS[s];
        return drawn.has(s) ? (
          <View key={s} style={{ flex: 1, display: s === current ? "flex" : "none" }}>
            <Section />
          </View>
        ) : null;
      })}
    </View>
  );
}
