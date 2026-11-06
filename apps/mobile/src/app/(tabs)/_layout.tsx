import { useEffect, useRef, useState } from "react";
import { BackHandler, Keyboard, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import Animated, {
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { firstTab } from "@murmur/shared/client";
import { CloseIcon, LibraryIcon, MusicIcon, PodcastIcon, ProfileIcon, SearchIcon, WatchIcon } from "@/components/icons";
import { MiniPlayer } from "@/components/mini-player";
import { IconButton, Text, type TextInputRef } from "@/components/ui";
import "@/lib/changes";
import { useTabPrefs } from "@/lib/data";
import { selectHaptic } from "@/lib/haptics";
import { rememberSearch, searchKind, searchText } from "@/lib/search";
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
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <Dock {...props} />}>
        <Tabs.Screen name="index" options={{ title: "Books" }} />
        <Tabs.Screen name="podcasts" options={{ title: "Podcasts" }} />
        <Tabs.Screen name="music" options={{ title: "Music" }} />
        <Tabs.Screen name="watch" options={{ title: "Watch" }} />
        <Tabs.Screen name="you" options={{ title: "You" }} />
        <Tabs.Screen name="search" options={{ title: "Search" }} />
      </Tabs>
      {/* Lists scroll under the status bar; this keeps the clock and icons readable. */}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: t.bg }} />
    </View>
  );
}

const DOCK_HEIGHT = 80;
const CLOSE = 44;
const GROW_MS = 300;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

/**
 * The bottom dock: Search first, then the tabs, all sharing the width. Tapping Search grows its
 * slot into the search box across the dock while the other tabs fold away, and an X slides in at
 * the end; closing runs it backwards. The mini player floats above it.
 */
function Dock({ state, descriptors, navigateToTab }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const tabs = useTabPrefs();
  const onTop = useIsFocused();
  const reduced = useReducedMotion();
  const current = state.routes[state.index];
  const searching = current?.name === "search";
  // The tab Search was opened from, which X and back return to.
  const [from, setFrom] = useState<string | null>(null);
  const input = useRef<TextInputRef>(null);

  // 0 is the tabs, 1 the open search box. It starts moving on the tap, not when the route changes.
  const open = useSharedValue(searching ? 1 : 0);
  const target = useRef(searching ? 1 : 0);
  const width = useSharedValue(0);
  // The same width for React, so a folding tab keeps its own size and is clipped, not squeezed.
  const [barWidth, setBarWidth] = useState(0);
  const animateTo = (to: 0 | 1) => {
    if (target.current === to) return;
    target.current = to;
    open.set(reduced ? to : withTiming(to, { duration: GROW_MS, easing: EASE }));
  };
  // Leaving Search some other way (a link, the route restored) still folds the box away.
  useEffect(() => {
    if (target.current === (searching ? 1 : 0)) return;
    target.current = searching ? 1 : 0;
    open.set(reduced ? target.current : withTiming(target.current, { duration: GROW_MS, easing: EASE }));
  }, [searching, reduced, open]);

  const visible = state.routes.filter(
    (r) =>
      r.name !== "search" &&
      // Books, Podcasts, Music and Watch show as you've set them on You > Tabs.
      !(r.name === "index" && !tabs.books) &&
      !(r.name === "podcasts" && !tabs.podcasts) &&
      !(r.name === "music" && !tabs.music) &&
      !(r.name === "watch" && !tabs.watch),
  );
  const slots = visible.length + 1;
  const keyOf = (name: string) => state.routes.find((r) => r.name === name)?.key;

  const openSearch = () => {
    selectHaptic();
    animateTo(1);
    // Focused on the tap, so the keyboard comes up as the box grows.
    input.current?.focus();
    setFrom(current?.key ?? null);
    const key = keyOf("search");
    if (key) navigateToTab(key);
  };

  const closeSearch = () => {
    animateTo(0);
    input.current?.blur();
    Keyboard.dismiss();
    searchText.set("");
    searchKind.set("all");
    const back = (from && state.routes.some((r) => r.key === from) ? from : null) ?? keyOf(firstTab(tabs) === "books" ? "index" : firstTab(tabs));
    if (back) navigateToTab(back);
  };

  // Android's back closes Search. Otherwise it goes to the first tab, then out; with Books hidden
  // that first tab isn't the navigator's own, where back would land on the Books route and be
  // sent straight on again.
  useEffect(() => {
    if (!onTop || (!searching && tabs.books)) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (searching) {
        closeSearch();
        return true;
      }
      const first = state.routes.find((r) => r.name === firstTab(tabs));
      if (first && first.key !== current?.key) navigateToTab(first.key);
      else BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  });

  // Edge to edge, Android doesn't resize the screen for the keyboard, so the dock rides up on it.
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, keyboard.height.value - insets.bottom) }] }));
  const closeSlot = useAnimatedStyle(() => ({ width: CLOSE * open.value, opacity: open.value }));

  return (
    <Animated.View style={[{ backgroundColor: t.bg }, lift]}>
      {searching ? null : <MiniPlayer />}
      <View
        style={{
          height: DOCK_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          paddingHorizontal: 6,
          backgroundColor: t.nav,
          borderTopWidth: 1,
          borderTopColor: t.line,
        }}
      >
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }} onLayout={(e) => {
            width.set(e.nativeEvent.layout.width);
            setBarWidth(e.nativeEvent.layout.width);
          }}
        >
          <SearchSlot open={open} width={width} slots={slots} searching={searching} input={input} onOpen={openSearch} />
          {visible.map((route) => {
            const focused = current?.key === route.key;
            const Icon = ICONS[route.name as keyof typeof ICONS] ?? LibraryIcon;
            const label = descriptors[route.key]?.options.title ?? route.name;
            const color = focused ? t.accent : t.tabInactive;
            return (
              <TabSlot key={route.key} open={open} width={width} slots={slots} face={barWidth / slots}>
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: focused }}
                  accessibilityLabel={label}
                  disabled={searching}
                  onPress={() => {
                    if (!focused) selectHaptic();
                    navigateToTab(route.key);
                  }}
                  style={{ height: DOCK_HEIGHT, alignItems: "center", justifyContent: "center", gap: 3 }}
                >
                  <Icon size={24} color={color} />
                  <Text numberOfLines={1} style={{ fontFamily: focused ? fonts.bold : fonts.semibold, fontSize: 11, color }}>
                    {label}
                  </Text>
                </Pressable>
              </TabSlot>
            );
          })}
          <Animated.View style={[{ overflow: "hidden", alignItems: "flex-end" }, closeSlot]}>
            <IconButton label="Close search" onPress={closeSearch} disabled={!searching} style={{ width: CLOSE }}>
              <CloseIcon size={24} color={t.text} />
            </IconButton>
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

/** An even share of the dock, folding to nothing as Search opens. Its face keeps its width, so it's clipped rather than squeezed. */
function TabSlot({
  open,
  width,
  slots,
  face,
  children,
}: {
  open: SharedValue<number>;
  width: SharedValue<number>;
  slots: number;
  face: number;
  children: React.ReactNode;
}) {
  const share = useAnimatedStyle(() =>
    width.value
      ? { flex: 0, width: (width.value / slots) * (1 - open.value), opacity: 1 - open.value }
      : { flex: 1, opacity: 1 },
  );
  return (
    <Animated.View style={[{ overflow: "hidden", alignItems: "center" }, share]}>
      <View style={{ width: face || "100%" }}>{children}</View>
    </Animated.View>
  );
}

/** Search's slot: a tab like the others, which grows across the dock into the search box. */
function SearchSlot({
  open,
  width,
  slots,
  searching,
  input,
  onOpen,
}: {
  open: SharedValue<number>;
  width: SharedValue<number>;
  slots: number;
  searching: boolean;
  input: React.RefObject<TextInputRef | null>;
  onOpen: () => void;
}) {
  const t = useTheme();
  const text = searchText.useValue();
  const grow = useAnimatedStyle(() =>
    width.value ? { flex: 0, width: interpolate(open.value, [0, 1], [width.value / slots, width.value - CLOSE]) } : { flex: 1 },
  );
  // The tab fades out quickly; the box follows a little behind.
  const face = useAnimatedStyle(() => ({ opacity: interpolate(open.value, [0, 0.4], [1, 0], "clamp") }));
  const box = useAnimatedStyle(() => ({ opacity: interpolate(open.value, [0.2, 1], [0, 1], "clamp") }));
  return (
    <Animated.View style={[{ height: DOCK_HEIGHT, justifyContent: "center" }, grow]}>
      <Animated.View style={face} pointerEvents={searching ? "none" : "auto"}>
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Search"
          onPress={onOpen}
          style={{ height: DOCK_HEIGHT, alignItems: "center", justifyContent: "center", gap: 3 }}
        >
          <SearchIcon size={24} color={t.tabInactive} />
          <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 11, color: t.tabInactive }}>
            Search
          </Text>
        </Pressable>
      </Animated.View>
      <Animated.View
        pointerEvents={searching ? "auto" : "none"}
        style={[{ position: "absolute", left: 4, right: 4, top: (DOCK_HEIGHT - 48) / 2 }, box]}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            height: 48,
            paddingHorizontal: 14.5,
            borderRadius: 24,
            borderWidth: 1.5,
            borderColor: t.accent,
            backgroundColor: t.surface2,
            overflow: "hidden",
          }}
        >
          <SearchIcon size={20} color={t.muted} />
          <TextInput
            ref={input}
            value={text}
            onChangeText={searchText.set}
            onSubmitEditing={() => rememberSearch(searchText.get())}
            placeholder="Search"
            placeholderTextColor={t.faint}
            selectionColor={t.accent}
            returnKeyType="search"
            accessibilityLabel="Search"
            style={{ flex: 1, minWidth: 0, color: t.text, fontFamily: fonts.semibold, fontSize: 15, paddingVertical: 0 }}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}
