import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import { fonts, useTheme } from "@/theme";
import { ChevronIcon } from "./icons";
import { NestedScreen, PageTitle } from "./page";
import { Row } from "./settings";
import { Text } from "./ui";

/** One settings group's own screen, opened from its row on the You tab. */
export function SettingsPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <NestedScreen>
      <PageTitle title={title} />
      <View style={{ marginTop: 16 }}>{children}</View>
    </NestedScreen>
  );
}

/** A row on the You tab that opens a settings screen, with its current value when there's a short one. */
export function NavRow({ title, value, href, last }: { title: string; value?: string | null; href: Href; last?: boolean }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={value ? `${title}, ${value}` : title} onPress={() => router.push(href)}>
      {({ pressed }) => (
        <View style={{ opacity: pressed ? 0.6 : 1 }}>
          <Row title={title} last={last}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
              {value ? (
                <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 14, color: t.muted, flexShrink: 1 }}>
                  {value}
                </Text>
              ) : null}
              <ChevronIcon size={20} color={t.faint} />
            </View>
          </Row>
        </View>
      )}
    </Pressable>
  );
}
