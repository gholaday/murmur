import { Image } from "expo-image";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { absolute, authHeaders } from "@/lib/api";
import { fonts } from "@/theme";
import { Text } from "./ui";

/**
 * Cover art from the server, cached on disk so it shows offline. Without art, a coloured
 * tile with the title, like the web player.
 */
export function Cover({
  path,
  title,
  color,
  size,
  radius = 10,
  style,
}: {
  /** Server path from apiPaths, a full URL (e.g. podcast search artwork), or null when there's no art. */
  path: string | null;
  title: string;
  color?: string | null;
  /** Width; covers are square. Omit to fill the parent's width. */
  size?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const box: ViewStyle = {
    width: size ?? "100%",
    aspectRatio: 1,
    borderRadius: radius,
    overflow: "hidden",
    backgroundColor: color ?? "#2a3550",
  };
  if (!path) {
    return (
      <View style={[box, { padding: 10, justifyContent: "flex-end" }, style]}>
        <Text numberOfLines={3} style={{ fontFamily: fonts.bold, fontSize: 13, color: "#fff" }}>
          {title}
        </Text>
      </View>
    );
  }
  return (
    <View style={[box, style]}>
      <Image
        source={/^https?:\/\//.test(path) ? { uri: path } : { uri: absolute(path), headers: authHeaders(), cacheKey: path }}
        cachePolicy="disk"
        recyclingKey={path}
        transition={reduced ? 0 : 220}
        accessibilityIgnoresInvertColors
        style={{ width: "100%", height: "100%" }}
      />
    </View>
  );
}
