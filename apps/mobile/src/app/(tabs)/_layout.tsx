import { useEffect } from "react";
import { BackHandler, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import { firstTab, librarySections } from "@murmur/shared/client";
import { LibraryIcon, PodcastIcon, ProfileIcon, SearchIcon } from "@/components/icons";
import { MiniPlayer } from "@/components/mini-player";
import { Text } from "@/components/ui";
import "@/lib/changes";
import { useTabPrefs } from "@/lib/data";
import { selectHaptic } from "@/lib/haptics";
import { restorePlayer } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

const ICONS = { search: SearchIcon, index: LibraryIcon, podcasts: PodcastIcon, you: ProfileIcon } as const;

export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    void restorePlayer();
  }, []);
  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <Dock {...props} />}>
        <Tabs.Screen name="index" options={{ title: "Library" }} />
        <Tabs.Screen name="podcasts" options={{ title: "Podcasts" }} />
        <Tabs.Screen name="you" options={{ title: "You" }} />
        <Tabs.Screen name="search" options={{ title: "Search" }} />
      </Tabs>
      {/* Lists scroll under the status bar; this keeps the clock and icons readable. */}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: t.bg }} />
    </View>
  );
}

const DOCK_HEIGHT = 80;

/** The bottom dock: Search first, then the tabs, sharing the width. The mini player floats above it. */
function Dock({ state, descriptors, navigateToTab }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const tabs = useTabPrefs();
  const onTop = useIsFocused();
  const current = state.routes[state.index];

  const library = librarySections(tabs).length > 0;
  const shown = state.routes.filter(
    (r) =>
      // Library and Podcasts show as you've set them on You > Tabs.
      !(r.name === "index" && !library) && !(r.name === "podcasts" && !tabs.podcasts),
  );
  // Search sits first in the dock, but the app opens on the first tab after it.
  const visible = [...shown.filter((r) => r.name === "search"), ...shown.filter((r) => r.name !== "search")];

  // Android's back goes to the first tab, then out. With Library hidden that first tab isn't the
  // navigator's own, where back would land on the Library route and be sent straight on again.
  useEffect(() => {
    if (!onTop || library) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const first = state.routes.find((r) => r.name === firstTab(tabs));
      if (first && first.key !== current?.key) navigateToTab(first.key);
      else BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  });

  return (
    <View style={{ backgroundColor: t.bg }}>
      <MiniPlayer />
      <View
        style={{
          height: DOCK_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          paddingHorizontal: 6,
          backgroundColor: t.nav,
          borderTopWidth: 1,
          borderTopColor: t.line,
          flexDirection: "row",
        }}
      >
        {visible.map((route) => {
          const focused = current?.key === route.key;
          const Icon = ICONS[route.name as keyof typeof ICONS] ?? LibraryIcon;
          const label = descriptors[route.key]?.options.title ?? route.name;
          const color = focused ? t.accent : t.tabInactive;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => {
                if (!focused) selectHaptic();
                navigateToTab(route.key);
              }}
              style={{ flex: 1, height: DOCK_HEIGHT, alignItems: "center", justifyContent: "center", gap: 3 }}
            >
              <Icon size={24} color={color} />
              <Text numberOfLines={1} style={{ fontFamily: focused ? fonts.bold : fonts.semibold, fontSize: 11, color }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
