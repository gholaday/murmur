import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import type { BookSummary, ShelfId } from "@murmur/shared";
import { useTheme } from "@/theme";
import { CountPill, Text } from "./ui";

export const PAD = 20;
export const GAP = 14;

/** Width of one cover in a three-column grid. */
export function useGridWidth(columns = 3) {
  const { width } = useWindowDimensions();
  return Math.floor((width - PAD * 2 - GAP * (columns - 1)) / columns);
}

export function Grid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: GAP, rowGap: 18 }}>{children}</View>;
}

/** One row of covers that scrolls freely sideways, bleeding to the screen edge. */
export function Shelf({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -PAD }}
      contentContainerStyle={{ paddingHorizontal: PAD, columnGap: GAP }}
    >
      {children}
    </ScrollView>
  );
}

export function openShelf(id: ShelfId) {
  router.push({ pathname: "/shelf", params: { id } });
}

/** Today's date as YYYY-MM-DD, the seed that keeps Not started in the same order all day. */
export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The line under a card on a home shelf: Next in series shows which book it is. */
export function shelfSub(id: ShelfId, b: BookSummary) {
  if (id !== "next") return undefined;
  return b.seriesPosition !== null ? `Book ${b.seriesPosition}` : b.author;
}

export function openGroup(params: { author: string } | { series: string }) {
  router.push({ pathname: "/group", params });
}

/** A titled shelf of books; the heading opens that author or series. */
export function Group({
  title,
  count,
  sub,
  side,
  onOpen,
  children,
}: {
  title: string;
  count: number;
  sub?: string | null;
  side?: string | null;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: 24 }}>
      <SectionHead title={title} count={count} sub={sub} side={side} onOpen={onOpen} />
      <Shelf>{children}</Shelf>
    </View>
  );
}

/** A section heading with its count that opens the section's full list. */
export function SectionHead({
  title,
  count,
  sub,
  side,
  onOpen,
}: {
  title: string;
  count: number;
  sub?: string | null;
  side?: string | null;
  onOpen: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
      <Pressable accessibilityRole="link" onPress={onOpen} style={{ flexShrink: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
            {title}
          </Text>
          <CountPill count={count} />
        </View>
        {sub ? <Text variant="small">{sub}</Text> : null}
      </Pressable>
      {side ? <Text variant="small" style={{ color: t.muted }}>{side}</Text> : null}
    </View>
  );
}
