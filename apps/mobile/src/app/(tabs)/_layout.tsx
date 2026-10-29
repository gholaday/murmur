import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import { LibraryIcon, MusicIcon, PodcastIcon, ProfileIcon, WatchIcon } from "@/components/icons";
import { MiniPlayer } from "@/components/mini-player";
import { Text } from "@/components/ui";
import "@/lib/changes";
import { useTabPrefs } from "@/lib/data";
import { restorePlayer } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

const ICONS = { index: LibraryIcon, podcasts: PodcastIcon, music: MusicIcon, watch: WatchIcon, you: ProfileIcon } as const;

export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    void restorePlayer();
  }, []);
  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
        <Tabs.Screen name="index" options={{ title: "Books" }} />
        <Tabs.Screen name="podcasts" options={{ title: "Podcasts" }} />
        <Tabs.Screen name="music" options={{ title: "Music" }} />
        <Tabs.Screen name="watch" options={{ title: "Watch" }} />
        <Tabs.Screen name="you" options={{ title: "You" }} />
      </Tabs>
      {/* Lists scroll under the status bar; this keeps the clock and icons readable. */}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: t.bg }} />
    </View>
  );
}

/** The mini player sits on top of the tabs, like Pocket Casts. */
function TabBar({ state, descriptors, navigateToTab }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const tabs = useTabPrefs();
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
          // Podcasts, Music and Watch show as you've set them on You > Tabs.
          if (route.name === "podcasts" && !tabs.podcasts) return null;
          if (route.name === "music" && !tabs.music) return null;
          if (route.name === "watch" && !tabs.watch) return null;
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
