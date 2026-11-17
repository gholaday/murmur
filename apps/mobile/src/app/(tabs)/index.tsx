import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Redirect } from "expo-router";
import PagerView from "react-native-pager-view";
import { firstTab, type LibrarySection, librarySections } from "@murmur/shared/client";
import { useTabPrefs } from "@/lib/data";
import { librarySection, librarySwipeLocked, onShelfTouch } from "@/lib/library";
import { BooksSection } from "@/sections/books";
import { MusicSection } from "@/sections/music";
import { WatchSection } from "@/sections/watch";
import { useTheme } from "@/theme";

const SECTIONS: Record<LibrarySection, () => React.ReactNode> = { books: BooksSection, music: MusicSection, watch: WatchSection };

/**
 * Library: Books, Music and Watch side by side, as You > Tabs has them. Swipe sideways or tap a
 * name in the title row to switch; the last one open comes back next time. The app opens here,
 * so with every section off this sends you to the first tab left.
 */
export default function LibraryScreen() {
  const tabs = useTabPrefs();
  const sections = librarySections(tabs);
  // With no sections, firstTab is Podcasts or You.
  if (!sections.length) return <Redirect href={firstTab(tabs) === "podcasts" ? "/podcasts" : "/you"} />;
  // A new set of sections starts the pager over.
  return <Pager key={sections.join()} sections={sections} />;
}

function Pager({ sections }: { sections: LibrarySection[] }) {
  const t = useTheme();
  const stored = librarySection.useValue();
  const current = sections.includes(stored) ? stored : sections[0]!;
  const index = sections.indexOf(current);
  const locked = librarySwipeLocked.useValue();
  const pager = useRef<PagerView>(null);
  // Where the pager is, so a tap on a name moves it and a swipe doesn't move it twice.
  const at = useRef(index);
  // Only the open section is drawn (and fetches) at first; its neighbours join once a swipe starts,
  // so the next one is there coming in. Once drawn, a section is kept.
  const [drawn, setDrawn] = useState(() => new Set([current]));
  if (!drawn.has(current)) setDrawn(new Set([...drawn, current]));
  const drawNeighbours = () => {
    const near = sections.filter((_, i) => Math.abs(i - at.current) <= 1);
    if (near.some((s) => !drawn.has(s))) setDrawn(new Set([...drawn, ...near]));
  };

  const swipes = !locked && sections.length > 1;
  useEffect(() => {
    // Starts free, in case a shelf held it and went away.
    pager.current?.setScrollEnabled(swipes);
    onShelfTouch((held) => pager.current?.setScrollEnabled(swipes && !held));
    return () => onShelfTouch(null);
  }, [swipes]);

  useEffect(() => {
    if (at.current === index) return;
    at.current = index;
    // A tapped name jumps straight there; the section fades its content in.
    pager.current?.setPageWithoutAnimation(index);
  }, [index]);

  return (
    <PagerView
      ref={pager}
      style={{ flex: 1, backgroundColor: t.bg }}
      initialPage={index}
      scrollEnabled={swipes}
      onPageScrollStateChanged={(e) => {
        if (e.nativeEvent.pageScrollState === "dragging") drawNeighbours();
      }}
      onPageSelected={(e) => {
        const i = e.nativeEvent.position;
        at.current = i;
        const s = sections[i];
        if (s && s !== librarySection.get()) librarySection.set(s);
      }}    >
      {sections.map((s) => {
        const Section = SECTIONS[s];
        return (
          <View key={s} collapsable={false} style={{ flex: 1 }}>
            {drawn.has(s) ? <Section /> : null}
          </View>
        );
      })}
    </PagerView>
  );
}
