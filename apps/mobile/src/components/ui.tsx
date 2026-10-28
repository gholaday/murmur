import { createContext, useContext, type ComponentRef, type Ref } from "react";
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
import { selectHaptic } from "@/lib/haptics";
import { fonts, useTheme, type Theme } from "@/theme";
import { ChevronIcon, SearchIcon } from "./icons";

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

/** True inside a bottom sheet, whose background matches a field's; fields there use a lighter fill. */
export const InSheet = createContext(false);

export function Field({
  label,
  style,
  ref,
  right,
  ...rest
}: TextInputProps & { label: string; ref?: Ref<TextInputRef>; /** A button inside the field's right edge. */ right?: React.ReactNode }) {
  const t = useTheme();
  const inSheet = useContext(InSheet);
  return (
    <View style={{ gap: 6 }}>
      <Caption style={{ letterSpacing: 0.6 }}>{label}</Caption>
      <View>
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
              paddingRight: right ? 52 : 16,
              backgroundColor: inSheet ? t.surface2 : t.surface,
              color: t.text,
              fontFamily: fonts.medium,
              fontSize: 16,
            },
            style,
          ]}
        />
        {right ? <View style={{ position: "absolute", right: 4, top: 4, bottom: 4, justifyContent: "center" }}>{right}</View> : null}
      </View>
    </View>
  );
}

/**
 * Every number badge, like the web's: grey ("count") for how many are in a list, solid accent
 * ("new") for something new or waiting (Up Next tab, unplayed on covers, "N new").
 */
export function NumberBadge({ value, tone = "count", style }: { value: number | string; tone?: "count" | "new"; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const isNew = tone === "new";
  return (
    // Sized by its text rather than a fixed height, and without Android's font padding, so the
    // number stays centred at any system text size.
    <View
      style={[
        {
          minWidth: 20,
          minHeight: 20,
          paddingHorizontal: 7,
          // Plus Jakarta's digits sit a touch low in their line box; half a point up centres them.
          paddingTop: 2.5,
          paddingBottom: 3.5,
          // Stays a pill when a larger system text size makes it taller than 20.
          borderRadius: 999,
          backgroundColor: isNew ? t.accent : t.chip,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <RNText
        style={{
          fontFamily: fonts.extrabold,
          fontSize: 11,
          lineHeight: 14,
          includeFontPadding: false,
          fontVariant: ["tabular-nums"],
          color: isNew ? t.onAccent : t.muted,
          textAlign: "center",
        }}
      >
        {value}
      </RNText>
    </View>
  );
}

/** Small rounded count next to a heading, used instead of "4 books · ..." strings. */
export function CountPill({ count }: { count: number }) {
  return <NumberBadge value={count} />;
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        if (!selected) selectHaptic();
        onPress();
      }}
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

/**
 * A row of chips where one is picked: "tabs" switch what a screen shows, "radio" picks a
 * setting. `onPick` runs even for the chip already picked, as a lone Chip's onPress does.
 */
export function Chips<T extends string | number | boolean | null>({
  options,
  value,
  onPick,
  kind = "tabs",
  label,
  gap = 6,
  wrap,
  style,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onPick: (id: T) => void;
  kind?: "tabs" | "radio";
  /** Read out for the group, e.g. "Ads for this show". */
  label?: string;
  gap?: number;
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessibilityRole={kind === "radio" ? "radiogroup" : undefined}
      accessibilityLabel={label}
      style={[{ flexDirection: "row", gap }, wrap ? { flexWrap: "wrap" } : null, style]}
    >
      {options.map((o) => (
        <Chip key={String(o.id)} label={o.label} selected={o.id === value} onPress={() => onPick(o.id)} />
      ))}
    </View>
  );
}

/** Full-width tabs on a track, for switching a screen between views; the picked one is raised. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" style={[{ flexDirection: "row", gap: 4, padding: 4, borderRadius: 12, backgroundColor: t.surface }, style]}>
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              selectHaptic();
              onChange(o.id);
            }}
            style={{ flex: 1, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: selected ? t.surface2 : "transparent" }}
          >
            <RNText style={{ fontFamily: selected ? fonts.bold : fonts.semibold, fontSize: 14, color: selected ? t.text : t.muted }}>{o.label}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small uppercase label: a field's name, "Playlist" over a title, "Playing from…". */
export function Caption({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text variant="caption" style={[{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8 }, style]}>
      {children}
    </Text>
  );
}

/** A search box: a magnifier and the text, on a surface. */
export function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (text: string) => void; placeholder: string; autoFocus?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: t.surface }}>
      <SearchIcon size={20} color={t.muted} />
      <TextInput
        autoFocus={autoFocus}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.faint}
        selectionColor={t.accent}
        accessibilityLabel={placeholder}
        style={{ flex: 1, color: t.text, fontFamily: fonts.medium, fontSize: 15 }}
      />
    </View>
  );
}

/** A card that opens a screen: an icon tile, a title over a sub line, an optional badge and a chevron. */
export function CardLink({
  icon,
  title,
  sub,
  label,
  badge,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  label?: string;
  badge?: React.ReactNode;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: 14,
        borderRadius: 14,
        backgroundColor: t.surface,
        // White on the light page needs an edge to read as a card.
        borderWidth: t.isDark ? 0 : 1,
        borderColor: t.line,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: t.surface2 }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="small" numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {badge}
      <ChevronIcon size={20} color={t.faint} />
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
