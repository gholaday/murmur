import type { ComponentRef, Ref } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { fonts, useTheme, type Theme } from "@/theme";

type Variant = "title" | "heading" | "body" | "bodyStrong" | "small" | "caption";

const variants: Record<Variant, (t: Theme) => TextStyle> = {
  title: (t) => ({ fontFamily: fonts.extrabold, fontSize: 30, letterSpacing: -0.5, color: t.text }),
  heading: (t) => ({ fontFamily: fonts.bold, fontSize: 17, color: t.text }),
  body: (t) => ({ fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: t.text2 }),
  bodyStrong: (t) => ({ fontFamily: fonts.bold, fontSize: 15, color: t.text }),
  small: (t) => ({ fontFamily: fonts.medium, fontSize: 13, color: t.muted }),
  caption: (t) => ({ fontFamily: fonts.semibold, fontSize: 11, color: t.muted }),
};

/** Text in the app font, styled by role so screens don't repeat font settings. */
export function Text({ variant = "body", style, ...rest }: TextProps & { variant?: Variant }) {
  const t = useTheme();
  return <RNText {...rest} style={[variants[variant](t), style]} />;
}

export function Button({
  label,
  onPress,
  busy,
  disabled,
  kind = "primary",
  style,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  kind?: "primary" | "secondary";
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const primary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        {
          height: 52,
          borderRadius: 26,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 24,
          backgroundColor: primary ? t.accent : t.surface2,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? t.onAccent : t.text} />
      ) : (
        <RNText style={{ fontFamily: fonts.bold, fontSize: 16, color: primary ? t.onAccent : t.text }}>{label}</RNText>
      )}
    </Pressable>
  );
}

/** A round icon button with a 48dp touch target. */
export function IconButton({
  label,
  children,
  style,
  ...rest
}: Omit<PressableProps, "style"> & { label: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => [
        { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export type TextInputRef = ComponentRef<typeof TextInput>;

export function Field({ label, style, ref, ...rest }: TextInputProps & { label: string; ref?: Ref<TextInputRef> }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="caption" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        placeholderTextColor={t.faint}
        selectionColor={t.accent}
        {...rest}
        style={[
          {
            height: 52,
            borderRadius: 14,
            paddingHorizontal: 16,
            backgroundColor: t.surface,
            color: t.text,
            fontFamily: fonts.medium,
            fontSize: 16,
          },
          style,
        ]}
      />
    </View>
  );
}

/** Small rounded count next to a heading, used instead of "4 books · ..." strings. */
export function CountPill({ count }: { count: number }) {
  const t = useTheme();
  return (
    <View style={{ minWidth: 22, height: 20, paddingHorizontal: 7, borderRadius: 10, backgroundColor: t.chip, justifyContent: "center" }}>
      <RNText style={{ fontFamily: fonts.bold, fontSize: 12, color: t.muted, textAlign: "center" }}>{count}</RNText>
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        height: 36,
        paddingHorizontal: 16,
        borderRadius: 18,
        justifyContent: "center",
        backgroundColor: selected ? t.accent : t.chip,
      }}
    >
      <RNText style={{ fontFamily: fonts.semibold, fontSize: 14, color: selected ? t.onAccent : t.text2 }}>{label}</RNText>
    </Pressable>
  );
}

/** Thin progress bar. */
export function Bar({ pct, height = 3, color }: { pct: number; height?: number; color?: string }) {
  const t = useTheme();
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: t.track, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", backgroundColor: color ?? t.accent }} />
    </View>
  );
}
