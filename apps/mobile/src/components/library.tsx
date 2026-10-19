import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
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

/** One row of covers that scrolls sideways, bleeding to the screen edge and snapping to cards. */
export function Shelf({ children }: { children: React.ReactNode }) {
  const width = useGridWidth();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={width + GAP}
      decelerationRate="fast"
      style={{ marginHorizontal: -PAD }}
      contentContainerStyle={{ paddingHorizontal: PAD, columnGap: GAP }}
    >
      {children}
    </ScrollView>
  );
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
  const t = useTheme();
  return (
    <View style={{ marginTop: 24 }}>
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
      <Shelf>{children}</Shelf>
    </View>
  );
}
