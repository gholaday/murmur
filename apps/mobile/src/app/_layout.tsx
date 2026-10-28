import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/toast";
// Answers Android Auto's browse requests (Music) from the start, not only once a screen opens.
import "@/player/android-auto";
import { queryClient } from "@/lib/query";
import { SessionProvider, useSession } from "@/lib/session";
import { useTheme } from "@/theme";

// The fonts are built into the app (expo-font plugin in app.json), so nothing waits on loading them.
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <Navigation />
        </SessionProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

function Navigation() {
  const t = useTheme();
  const { status } = useSession();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.bg);
  }, [t.bg]);

  // The splash screen isn't held: holding it kept the app from drawing on Android 16+.
  if (status === "loading") return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const base = t.isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: t.bg, card: t.nav, text: t.text, border: t.line, primary: t.accent },
  };
  const signedIn = status === "signedIn";

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={t.isDark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="book/[id]" />
          <Stack.Screen name="show/[id]" />
          <Stack.Screen name="album/[id]" />
          <Stack.Screen name="artist/[id]" />
          <Stack.Screen name="playlist/[id]" />
          <Stack.Screen name="add-songs" />
          <Stack.Screen name="browse" />
          <Stack.Screen name="group" />
          <Stack.Screen name="shelf" />
          <Stack.Screen name="podcast-list" />
          <Stack.Screen name="preview" />
          <Stack.Screen name="account" />
          <Stack.Screen name="appearance" />
          <Stack.Screen name="playback" />
          <Stack.Screen name="server" />
          <Stack.Screen name="library" />
          <Stack.Screen name="episode-cache" />
          <Stack.Screen name="users" />
          <Stack.Screen name="tab-settings" />
          <Stack.Screen name="downloads" />
          {/* See-through, so the screen below shows as the player is pulled down to minimise it. */}
          <Stack.Screen
            name="player"
            options={{ presentation: "transparentModal", animation: "slide_from_bottom", contentStyle: { backgroundColor: "transparent" } }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
      <Toaster />
    </ThemeProvider>
  );
}
