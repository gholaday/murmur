import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import { LibraryIcon, PodcastIcon, QueueIcon, SettingsIcon } from "@/components/icons";
import { MiniPlayer } from "@/components/mini-player";
import { Text } from "@/components/ui";
import { restorePlayer } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

const ICONS = { index: LibraryIcon, podcasts: PodcastIcon, "up-next": QueueIcon, settings: SettingsIcon } as const;

export default function TabsLayout() {
  useEffect(() => {
    void restorePlayer();
  }, []);
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: "Library" }} />
      <Tabs.Screen name="podcasts" options={{ title: "Podcasts" }} />
      <Tabs.Screen name="up-next" options={{ title: "Up Next" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}

/** The mini player sits on top of the tabs, like Pocket Casts. */
function TabBar({ state, descriptors, navigateToTab }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: t.bg }}>
      <MiniPlayer />
      <View
        style={{
          flexDirection: "row",
          backgroundColor: t.nav,
          borderTopWidth: 1,
          borderTopColor: t.line,
          paddingBottom: insets.bottom,
        }}
      >
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const Icon = ICONS[route.name as keyof typeof ICONS] ?? LibraryIcon;
          const label = descriptors[route.key]?.options.title ?? route.name;
          const color = focused ? t.accent : t.tabInactive;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => navigateToTab(route.key)}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 3, height: 64 }}
            >
              <Icon size={24} color={color} />
              <Text style={{ fontFamily: focused ? fonts.bold : fonts.semibold, fontSize: 12, color }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
