import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayer } from "@/player/engine";
import { useVideo } from "@/player/video";
import { useTheme } from "@/theme";
import { BackIcon } from "./icons";
import { PAD } from "./library";
import { BottomMiniPlayer } from "./mini-player";
import { CountPill, IconButton, Text } from "./ui";

/** Nested screens: the back arrow sits alone on the top row, the title goes below it. */
export function BackRow({ right }: { right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginLeft: -10 }}>
      <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
        <BackIcon size={24} color={t.text} />
      </IconButton>
      {right}
    </View>
  );
}

/** A nested screen's head: the back row, then the page title (with its count, sub line and actions). */
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
  children,
}: {
  right?: React.ReactNode;
  refreshControl?: React.ComponentProps<typeof ScrollView>["refreshControl"];
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: bottom }} refreshControl={refreshControl}>
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

/** Large page title with optional count and actions on the right. */
export function PageTitle({
  title,
  count,
  sub,
  below,
  right,
}: {
  title: string;
  count?: number;
  sub?: string | null;
  /** Shown in place of `sub`, e.g. a loading placeholder. */
  below?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, paddingVertical: 8 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text variant="title">{title}</Text>
          {count !== undefined ? <CountPill count={count} /> : null}
        </View>
        {sub ? <Text variant="small">{sub}</Text> : below}
      </View>
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
  const { item } = usePlayer();
  const video = useVideo().item;
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
