import { useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@/theme";
import { Cover } from "./cover";
import { Bone, Skeleton } from "./skeleton";
import { Button, Input, LinkButton, Text } from "./ui";

export interface PictureOption {
  key: string;
  thumb: string;
  label: string;
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

/**
 * An edit sheet's picture tab, for a book's cover and a movie or show's poster and background: the
 * picture with where it came from and Remove, then upload and link beside it, and suggestions below.
 */
export function PictureEdit({
  path,
  title,
  color,
  aspectRatio = 1,
  source,
  removeLabel,
  onRemove,
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
  source: string;
  /** Shown only when there's a chosen picture to take off. */
  removeLabel?: string | null;
  onRemove: () => void;
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
  const wide = aspectRatio > 1.2;
  const columns = wide ? 3 : 4;
  // The sheet's content is the screen less 20 each side; thumbs are spread with gaps of 8.
  const thumbWidth = Math.floor((width - 40 - 8 * (columns - 1)) / columns);
  const thumb = { width: thumbWidth, gap: 4 };

  const choose = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const file = picked.canceled ? null : picked.assets[0];
    if (file) onUpload(file);
  };
  const link = () => void onLink(url.trim()).then((ok) => ok !== false && setUrl(""));

  return (
    <>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <View style={{ width: wide ? 140 : 112, gap: 6 }}>
          <Cover path={path} title={title} color={color} aspectRatio={aspectRatio} radius={10} />
          <Text variant="small">{source}</Text>
          {removeLabel ? <LinkButton label={removeLabel} disabled={busy} onPress={onRemove} /> : null}
        </View>
        <View style={{ flex: 1, gap: 10 }}>
          <Button label="Choose an image" kind="secondary" small disabled={busy} onPress={() => void choose()} style={{ alignSelf: "flex-start" }} />
          <Input value={url} onChangeText={setUrl} placeholder="Or paste an image link" accessibilityLabel="Image link" keyboardType="url" autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={() => url.trim() && link()} />
          <Button label="Use link" kind="secondary" small disabled={busy || !url.trim()} onPress={link} style={{ alignSelf: "flex-start" }} />
        </View>
      </View>
      {options !== undefined ? (
        <View style={{ gap: 10 }}>
          <Text variant="bodyStrong" style={{ fontSize: 14 }}>
            Suggestions
          </Text>
          {options === null ? (
            <Skeleton style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {Array.from({ length: columns }, (_, i) => (
                <Bone key={i} width={thumbWidth} height={(thumbWidth - 8) / aspectRatio + 8} radius={10} />
              ))}
            </Skeleton>
          ) : options.length === 0 ? (
            <Text variant="small">{emptyText}</Text>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {options.map((o) => {
                const on = picked === o.key;
                return (
                  <Pressable
                    key={o.key}
                    accessibilityRole="button"
                    accessibilityLabel={o.label}
                    accessibilityState={{ selected: on }}
                    disabled={busy}
                    onPress={() => onPick(on ? null : o)}
                    style={({ pressed }) => [thumb, { opacity: pressed || busy ? 0.6 : 1 }]}
                  >
                    {/* The outline is always there, so picking doesn't shift the grid. */}
                    <View style={{ borderWidth: 2, borderColor: on ? t.accent : "transparent", borderRadius: 10, padding: 2 }}>
                      <Cover path={o.thumb} title={title} color={t.surface2} aspectRatio={aspectRatio} radius={6} />
                    </View>
                    {o.caption ? (
                      <Text variant="small" numberOfLines={1} style={{ fontSize: 11 }}>
                        {o.caption}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      ) : null}
    </>
  );
}
