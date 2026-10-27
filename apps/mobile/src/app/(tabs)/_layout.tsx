import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import { LibraryIcon, ListeningIcon, MusicIcon, PodcastIcon, ProfileIcon } from "@/components/icons";
import { MiniPlayer } from "@/components/mini-player";
import { NumberBadge, Text } from "@/components/ui";
import { useMusicSummary, useTabPrefs } from "@/lib/data";
import { restorePlayer, usePlayer } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

const ICONS = { index: LibraryIcon, podcasts: PodcastIcon, music: MusicIcon, listening: ListeningIcon, you: ProfileIcon } as const;

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
        <Tabs.Screen name="listening" options={{ title: "Listening" }} />
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
  const queued = usePlayer().queue.length;
  const tabs = useTabPrefs();
  const music = !!useMusicSummary().data?.enabled;
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
          // Podcasts and Music can be switched off on You > Tabs; Music also needs music on the server.
          if (route.name === "podcasts" && !tabs.podcasts) return null;
          if (route.name === "music" && !(tabs.music && music)) return null;
          const focused = state.index === i;
          const Icon = ICONS[route.name as keyof typeof ICONS] ?? LibraryIcon;
          const label = descriptors[route.key]?.options.title ?? route.name;
          const color = focused ? t.accent : t.tabInactive;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={route.name === "listening" && queued > 0 ? `${label}, ${queued} queued` : label}
              onPress={() => navigateToTab(route.key)}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 3, height: 64 }}
            >
              <View>
                <Icon size={24} color={color} />
                {route.name === "listening" && queued > 0 ? (
                  <NumberBadge tone="new" value={queued > 99 ? "99+" : queued} style={{ position: "absolute", top: -6, left: 14 }} />
                ) : null}
              </View>
              <Text style={{ fontFamily: focused ? fonts.bold : fonts.semibold, fontSize: 12, color }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
