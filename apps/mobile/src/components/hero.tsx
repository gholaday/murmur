import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { absolute, authHeaders } from "@/lib/api";
import { useTheme } from "@/theme";

/**
 * Header backdrop for book and show pages: a blurred copy of the artwork, so its colours
 * bleed out around the cover, fading into the page.
 */
export function HeroBackdrop({ path, color, height }: { path: string | null; color: string | null; height: number }) {
  const t = useTheme();
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height, overflow: "hidden" }}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: color ?? t.surface2, opacity: 0.18 }]} />
      {path ? (
        <Image
          source={{ uri: absolute(path), headers: authHeaders(), cacheKey: path }}
          cachePolicy="disk"
          blurRadius={90}
          contentFit="cover"
          // Larger than the box on every side: Android caps the blur, so the image's own edges must stay hidden.
          style={{ position: "absolute", top: -80, left: -120, right: -120, height: height + 160, opacity: t.isDark ? 0.55 : 0.4 }}
        />
      ) : null}
      <LinearGradient colors={["transparent", t.bg]} locations={[0.45, 1]} style={StyleSheet.absoluteFill} />
    </View>
  );
}
