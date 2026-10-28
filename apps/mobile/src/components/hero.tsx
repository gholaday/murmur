import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/theme";
import { imageSource } from "./cover";

/**
 * Header backdrop for book and show pages and the player: a blurred copy of the artwork, so its
 * colours bleed out around the cover, fading into the page (or into `fade`, on a tinted page).
 * `strength` scales the image's opacity. With `top`, it starts that far down (below a bar it
 * shouldn't sit behind) and fades in from `fadeFrom`, the page's colour there.
 */
export function HeroBackdrop({
  path,
  color,
  height,
  fade,
  strength = 1,
  top = 0,
  fadeFrom,
}: {
  path: string | null;
  color: string | null;
  height: number;
  fade?: string;
  strength?: number;
  top?: number;
  fadeFrom?: string;
}) {
  const t = useTheme();
  return (
    <View pointerEvents="none" style={{ position: "absolute", top, left: 0, right: 0, height, overflow: "hidden" }}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: color ?? t.surface2, opacity: 0.18 }]} />
      {path ? (
        <Image
          // A feed's own artwork (a full URL) loads directly, without our sign-in.
          source={imageSource(path)}
          cachePolicy="disk"
          blurRadius={90}
          contentFit="cover"
          // Larger than the box on every side: Android caps the blur, so the image's own edges must stay hidden.
          style={{ position: "absolute", top: -80, left: -120, right: -120, height: height + 160, opacity: Math.min(1, (t.isDark ? 0.55 : 0.4) * strength) }}
        />
      ) : null}
      <LinearGradient colors={[fade ? `${fade}00` : "transparent", fade ?? t.bg]} locations={[0.45, 1]} style={StyleSheet.absoluteFill} />
      {fadeFrom ? <LinearGradient colors={[fadeFrom, `${fadeFrom}00`]} locations={[0, 0.22]} style={StyleSheet.absoluteFill} /> : null}
    </View>
  );
}
