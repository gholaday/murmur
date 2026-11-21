import { useState } from "react";
import { Pressable, TextInput, View, useWindowDimensions } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { selectHaptic } from "@/lib/haptics";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { CheckIcon, LinkIcon, PlusIcon } from "./icons";
import { Bone, Skeleton } from "./skeleton";
import { Button, Caption, Text } from "./ui";

export interface PictureOption {
  key: string;
  thumb: string;
  label: string;
  /** Where it's from, under it: "Audible", "Google Books". */
  caption?: string;
  /** Puts this picture on; resolves once it's done or has failed. */
  apply: () => Promise<unknown>;
}

/**
 * The picked suggestion and the sheet-foot button that puts it on: tapping a suggestion only picks
 * it, and Use this picture applies it. The sheet holds this so the button sits in its foot.
 */
export function usePicturePick() {
  const [picked, setPicked] = useState<PictureOption | null>(null);
  const [saving, setSaving] = useState(false);
  const use = async (o: PictureOption) => {
    setSaving(true);
    try {
      await o.apply();
    } finally {
      setSaving(false);
      setPicked(null);
    }
  };
  const foot = picked ? <Button label={saving ? "Saving…" : "Use this picture"} disabled={saving} onPress={() => void use(picked)} /> : null;
  return { picked: picked?.key ?? null, setPicked, foot };
}

const COLUMNS = 3;

/**
 * An edit sheet's picture tab, for a book's cover and a movie or show's poster and background, like
 * the web's: the current picture with where it's from and a way back to the default, then "Choose
 * another" (Upload first, then suggestions) and a link field. Nothing applies on a tap.
 */
export function PictureEdit({
  path,
  title,
  color,
  aspectRatio = 1,
  source,
  reset,
  busy,
  onUpload,
  onLink,
  options,
  emptyText,
  picked,
  onPick,
}: {
  path: string | null;
  title: string;
  color?: string | null;
  aspectRatio?: number;
  /** Where it's from: "Custom cover", "From the files". */
  source: string;
  /** Going back to the default picture, when there's one to go back to. */
  reset?: { label: string; onPress: () => void };
  busy: boolean;
  onUpload: (file: ImagePicker.ImagePickerAsset) => void;
  /** Resolves false when the link wasn't used, so the field keeps it. */
  onLink: (url: string) => Promise<unknown>;
  /** Null while loading; undefined when there are no suggestions to show at all. */
  options?: PictureOption[] | null;
  emptyText: string;
  /** The picked suggestion's key, from usePicturePick. */
  picked: string | null;
  onPick: (o: PictureOption | null) => void;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const [url, setUrl] = useState("");
  // The sheet's content is the screen less 20 each side; thumbs are spread with gaps of 12.
  const thumbWidth = Math.floor((width - 40 - 12 * (COLUMNS - 1)) / COLUMNS);

  const choose = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const file = res.canceled ? null : res.assets[0];
    if (file) onUpload(file);
  };
  const link = () => {
    const u = url.trim();
    if (u) void onLink(u).then((ok) => ok !== false && setUrl(""));
  };

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 16 }}>
        <View style={{ elevation: 8, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, borderRadius: 12 }}>
          <Cover path={path} title={title} color={color} size={aspectRatio > 1.2 ? 200 : 132} aspectRatio={aspectRatio} radius={12} />
        </View>
        <View style={{ flex: 1, gap: 2, paddingBottom: 4 }}>
          <Text variant="bodyStrong" style={{ fontSize: 15 }}>
            Current
          </Text>
          <Text variant="small">{source}</Text>
          {reset ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={reset.onPress} hitSlop={8} style={({ pressed }) => ({ paddingTop: 8, opacity: busy ? 0.45 : pressed ? 0.6 : 1 })}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: t.accent }}>{reset.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={{ gap: 10, marginTop: 10 }}>
        <Caption style={{ letterSpacing: 0.6 }}>Choose another</Caption>
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 14 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Upload a picture" disabled={busy} onPress={() => void choose()} style={({ pressed }) => ({ width: thumbWidth, gap: 6, opacity: pressed || busy ? 0.6 : 1 })}>
            <View style={{ width: thumbWidth, aspectRatio, borderRadius: 8, backgroundColor: t.surface2, alignItems: "center", justifyContent: "center" }}>
              <PlusIcon size={28} color={t.accent} />
            </View>
            <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: t.text }}>Upload</Text>
          </Pressable>
          {options === null ? (
            <Skeleton style={{ flexDirection: "row", columnGap: 12 }}>
              {[0, 1].map((i) => (
                <Bone key={i} width={thumbWidth} height={thumbWidth / aspectRatio} radius={8} />
              ))}
            </Skeleton>
          ) : (
            (options ?? []).map((o) => {
              const on = picked === o.key;
              return (
                <Pressable
                  key={o.key}
                  accessibilityRole="button"
                  accessibilityLabel={o.label}
                  accessibilityState={{ selected: on }}
                  disabled={busy}
                  onPress={() => {
                    selectHaptic();
                    onPick(on ? null : o);
                  }}
                  style={({ pressed }) => ({ width: thumbWidth, gap: 6, opacity: pressed || busy ? 0.6 : 1 })}
                >
                  <View>
                    <Cover path={o.thumb} title={title} color={t.surface2} size={thumbWidth} aspectRatio={aspectRatio} radius={8} />
                    {on ? (
                      <>
                        <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: 8, borderWidth: 3, borderColor: t.accent }} />
                        <View style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
                          <CheckIcon size={14} color={t.onAccent} />
                        </View>
                      </>
                    ) : null}
                  </View>
                  {o.caption ? (
                    <Text numberOfLines={1} style={{ fontFamily: on ? fonts.bold : fonts.semibold, fontSize: 12, color: on ? t.accent : t.muted }}>
                      {o.caption}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </View>
        {options && options.length === 0 ? <Text variant="small">{emptyText}</Text> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 44, marginTop: 4, borderBottomWidth: 1, borderBottomColor: t.line }}>
          <LinkIcon size={18} color={t.muted} />
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="Paste an image link"
            placeholderTextColor={t.muted}
            selectionColor={t.accent}
            accessibilityLabel="Image link"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            editable={!busy}
            onSubmitEditing={link}
            style={{ flex: 1, height: 44, padding: 0, color: t.text, fontFamily: fonts.regular, fontSize: 14 }}
          />
        </View>
      </View>
    </>
  );
}
