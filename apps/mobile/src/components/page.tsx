import { useCallback, useRef } from "react";
import { Pressable, ScrollView, type ScrollViewInstance, useWindowDimensions, View } from "react-native";
import { router, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LIBRARY_SECTION_LABELS, type LibrarySection, librarySections } from "@murmur/shared/client";
import { useTabPrefs } from "@/lib/data";
import { jumpToSection } from "@/lib/library";
import { usePlayerSelect } from "@/player/engine";
import { useVideoSelect } from "@/player/video";
import { useTheme } from "@/theme";
import { BackIcon } from "./icons";
import { PAD } from "./library";
import { BottomMiniPlayer } from "./mini-player";
import { CountPill, IconButton, Text } from "./ui";

/** Back a screen, or to Library when there's nothing behind (opened from a link). */
export const goBack = () => (router.canGoBack() ? router.back() : router.replace("/"));

/** goBack for something that finishes later (Hide): only while this screen is still the one showing. */
export function useBackIfFocused() {
  const navigation = useNavigation();
  return useCallback(() => {
    if (navigation.isFocused()) goBack();
  }, [navigation]);
}

/** Nested screens: the back arrow sits alone on the top row, the title goes below it. */
export function BackRow({ right }: { right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginLeft: -10 }}>
      <IconButton label="Back" onPress={goBack}>
        <BackIcon size={24} color={t.text} />
      </IconButton>
      {right}
    </View>
  );
}

/** A nested screen's head: the back row, then the page title (with its sub line and actions). */
export function NestedHead(props: React.ComponentProps<typeof PageTitle>) {
  return (
    <>
      <BackRow />
      <PageTitle {...props} />
    </>
  );
}

/**
 * A nested screen that scrolls: the back row (with `right` beside it), the content, and the mini
 * player under it. `after` sits outside the scroll, for the screen's sheets.
 */
export function NestedScreen({
  right,
  refreshControl,
  after,
  backdrop,
  children,
}: {
  right?: React.ReactNode;
  refreshControl?: React.ComponentProps<typeof ScrollView>["refreshControl"];
  after?: React.ReactNode;
  /** Behind the top of the page and the status bar, e.g. a HeroBackdrop. */
  backdrop?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: bottom }} refreshControl={refreshControl}>
        {backdrop}
        <BackRow right={right} />
        {children}
      </ScrollView>
      <BottomMiniPlayer />
      {after}
    </View>
  );
}

/** A nested screen before its content: the back row over an error or a placeholder. */
export function NestedFallback({ children }: { children?: React.ReactNode }) {
  const t = useTheme();
  const top = useTopInset();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: top, paddingHorizontal: PAD }}>
      <BackRow />
      {children}
    </View>
  );
}

/** Large page title with optional actions on the right. */
export function PageTitle({
  title,
  sub,
  below,
  right,
}: {
  title: string;
  sub?: string | null;
  /** Shown in place of `sub`, e.g. a loading placeholder. */
  below?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, paddingVertical: 8 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="title">{title}</Text>
        {sub ? <Text variant="small">{sub}</Text> : below}
      </View>
      {right ? <View style={{ flexDirection: "row" }}>{right}</View> : null}
    </View>
  );
}

/**
 * Library's title row: its sections' names side by side at page-title size, the open one bright,
 * the others faint; a tap switches. With one section it reads as a plain title. They scroll
 * sideways when they don't fit beside the section's buttons.
 */
export function LibraryTitle({ current, right }: { current: LibrarySection; right?: React.ReactNode }) {
  const t = useTheme();
  const sections = librarySections(useTabPrefs());
  const scroll = useRef<ScrollViewInstance>(null);
  const width = useRef(0);
  const narrow = useWindowDimensions().width <= 420;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, paddingVertical: 8 }}>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        // As tall as the buttons, so a section without any keeps its tabs at the same height.
        style={{ flex: 1, minHeight: 44 }}
        // Phone widths, like the web's: a little smaller and closer, so all three fit beside a button.
        contentContainerStyle={{ columnGap: narrow ? 12 : 18, alignItems: "flex-end" }}
        onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
        accessibilityRole="tablist"
      >
        {sections.map((s) => (
          <Pressable
            key={s}
            accessibilityRole="tab"
            accessibilityState={{ selected: s === current }}
            disabled={sections.length < 2}
            onPress={() => s !== current && jumpToSection(s)}
            // The open one is kept in view.
            onLayout={(e) => {
              const { x, width: w } = e.nativeEvent.layout;
              if (s === current && x + w > width.current) scroll.current?.scrollTo({ x: x + w - width.current, animated: false });
            }}
          >
            <Text variant="title" style={[narrow ? { fontSize: 28 } : null, s === current ? null : { color: t.faint }]}>
              {LIBRARY_SECTION_LABELS[s]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {right ? <View style={{ flexDirection: "row" }}>{right}</View> : null}
    </View>
  );
}

/**
 * Bottom padding for screens outside the tabs. With nothing playing the content needs to
 * clear Android's navigation bar itself; otherwise the mini player below it does.
 */
export function useBottomPad(extra = 24) {
  const insets = useSafeAreaInsets();
  const item = usePlayerSelect((s) => !!s.item);
  const video = useVideoSelect((v) => !!v.item);
  return item || video ? extra : insets.bottom + extra;
}

/** Top padding for screens that draw under the status bar. */
export function useTopInset(extra = 8) {
  return useSafeAreaInsets().top + extra;
}

export function SectionTitle({ title, count, right }: { title: string; count?: number; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
        <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
          {title}
        </Text>
        {count !== undefined ? <CountPill count={count} /> : null}
      </View>
      {right}
    </View>
  );
}

export function Empty({ title, children }: { title?: string; children?: React.ReactNode }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 48, paddingHorizontal: 24, gap: 6 }}>
      {title ? <Text variant="bodyStrong">{title}</Text> : null}
      {children ? <Text variant="small" style={{ textAlign: "center" }}>{children}</Text> : null}
    </View>
  );
}
