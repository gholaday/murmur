import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Toaster } from "@/components/toast";
import { queryClient } from "@/lib/query";
import { SessionProvider, useSession } from "@/lib/session";
import { useTheme } from "@/theme";


export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>{fontsLoaded ? <Navigation /> : <View style={{ flex: 1, backgroundColor: "#111214" }} />}</SessionProvider>
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
          <Stack.Screen name="group" />
          <Stack.Screen name="shelf" />
          <Stack.Screen name="player" options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
      <Toaster />
    </ThemeProvider>
  );
}
