import { useEffect, useState } from "react";
import { AppState, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { onlineManager } from "@tanstack/react-query";
import { useReducedMotion } from "react-native-reanimated";
import { FALLBACK_TINT } from "@murmur/shared/client";
import { absolute, authHeaders } from "@/lib/api";
import { savedArt } from "@/lib/downloads";
import { fonts } from "@/theme";
import { Text } from "./ui";

/** A full URL as it is; a server path from its downloaded copy (movie and TV pictures), else the server. */
export function imageSource(path: string) {
  if (/^https?:\/\//.test(path)) return { uri: path };
  const saved = savedArt(path);
  return saved ? { uri: saved } : { uri: absolute(path), headers: authHeaders(), cacheKey: path };
}

/** Covers shown already this session; they come from memory, so fading them in again only flickers. */
const loaded = new Set<string>();

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
  aspectRatio = 1,
  style,
}: {
  /** Server path from apiPaths, a full URL (e.g. podcast search artwork), or null when there's no art. */
  path: string | null;
  title: string;
  color?: string | null;
  /** Width; covers are square unless `aspectRatio` says otherwise. Omit to fill the parent's width. */
  size?: number;
  radius?: number;
  /** Width over height: 2/3 for posters, 16/9 for video stills. */
  aspectRatio?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const attempt = useRetryOnFail(path);
  const box: ViewStyle = {
    width: size ?? "100%",
    aspectRatio,
    borderRadius: radius,
    overflow: "hidden",
    backgroundColor: color ?? FALLBACK_TINT.page,
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
        // A new image view for each try: one that failed won't ask for the same source again.
        key={attempt.count}
        onError={attempt.failed}
        source={imageSource(path)}
        // Memory too, so covers scrolled back into view aren't decoded again; the memory cache is size-capped.
        cachePolicy="memory-disk"
        recyclingKey={path}
        transition={reduced || loaded.has(path) ? 0 : 220}
        onLoad={() => loaded.add(path)}
        accessibilityIgnoresInvertColors
        style={{ width: "100%", height: "100%" }}
      />
    </View>
  );
}

const RETRY_MS = 5_000;
const RETRY_MAX_MS = 60_000;

/**
 * A cover that failed to load (offline, signed out, the server restarting) tries again when the
 * connection comes back, when the app comes back to the front, and every so often in between.
 * Without this it stayed blank for as long as its screen stayed open, which for a tab is until
 * the app restarts.
 */
export function useRetryOnFail(path: string | null) {
  const [state, setState] = useState({ path, count: 0, failed: false });
  // A different cover starts over.
  const current = state.path === path ? state : { path, count: 0, failed: false };
  const { failed, count } = current;
  useEffect(() => {
    if (!failed) return;
    const retry = () => setState({ path, count: count + 1, failed: false });
    const timer = setTimeout(retry, Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** count));
    const offline = onlineManager.subscribe((online) => {
      if (online) retry();
    });
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") retry();
    });
    return () => {
      clearTimeout(timer);
      offline();
      app.remove();
    };
  }, [failed, count, path]);
  return { count, failed: () => setState({ path, count, failed: true }) };
}
