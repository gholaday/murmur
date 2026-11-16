import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/theme";
import { Cover, imageSource, useRetryOnFail } from "./cover";
import { Bone } from "./skeleton";
import { Text } from "./ui";

/** How wide the cover is at the top of a book's, album's or show's page. */
export const HERO_COVER = 210;
/** A movie's or TV show's poster there: 2:3, so it stands about as tall as a cover. */
export const HERO_POSTER = 150;

/**
 * The top of a book's, album's, playlist's, show's or movie's page, centred: the cover (or a 2:3
 * poster) with its shadow and `corner` on its top right, then `above` (a book's series, else a
 * little space), the title, and `children` (author lines and the facts line).
 */
export function ItemHero({
  cover,
  color,
  title,
  poster,
  art,
  corner,
  above,
  children,
}: {
  cover: string | null;
  color: string | null;
  title: string;
  poster?: boolean;
  /** Drawn in place of the cover, e.g. a playlist's mosaic. */
  art?: React.ReactNode;
  /** On the cover's top right, e.g. a show's subscribe button. */
  corner?: React.ReactNode;
  above?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", gap: 6, marginTop: 4 }}>
      <View
        style={{
          width: poster ? HERO_POSTER : HERO_COVER,
          borderRadius: 12,
          elevation: 12,
          shadowColor: "#000",
          shadowOpacity: 0.4,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 12 },
        }}
      >
        {art ?? <Cover path={cover} title={title} color={color} radius={12} aspectRatio={poster ? 2 / 3 : 1} />}
        {corner ? <View style={{ position: "absolute", top: 8, right: 8 }}>{corner}</View> : null}
      </View>
      {above ?? <View style={{ height: 14 }} />}
      <Text variant="title" style={{ fontSize: 24, textAlign: "center" }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** A page header's line of facts (length, year, episodes), spaced apart rather than dotted. */
export function MetaLine({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", columnGap: 14 }}>{children}</View>;
}

/** A facts line from plain words, e.g. albumFacts. */
export function Facts({ items }: { items: string[] }) {
  return (
    <MetaLine>
      {items.map((s) => (
        <Text key={s} variant="small">
          {s}
        </Text>
      ))}
    </MetaLine>
  );
}

/** ItemHero's shape while the page loads: cover (or poster), title and two lines. */
export function HeroBones({ poster }: { poster?: boolean }) {
  return (
    <View style={{ alignItems: "center", gap: 6, marginTop: 4 }}>
      <Bone width={poster ? HERO_POSTER : HERO_COVER} height={poster ? HERO_POSTER * 1.5 : HERO_COVER} radius={12} />
      <Bone width="60%" height={26} style={{ marginTop: 14 }} />
      <Bone width="40%" height={14} />
      <Bone width="50%" height={14} />
    </View>
  );
}

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
  const attempt = useRetryOnFail(path);
  return (
    <View pointerEvents="none" style={{ position: "absolute", top, left: 0, right: 0, height, overflow: "hidden" }}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: color ?? t.surface2, opacity: 0.18 }]} />
      {path ? (
        <Image
          key={attempt.count}
          onError={attempt.failed}
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
