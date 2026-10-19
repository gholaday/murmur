import { useRef } from "react";
import { Modal, Pressable, ScrollView, type ScrollViewInstance, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, useTheme } from "@/theme";
import { CheckIcon } from "./icons";
import { Text } from "./ui";

/** A bottom sheet for menus and pickers. Tapping outside or Back closes it. */
export function Sheet({
  open,
  onClose,
  title,
  scrollY = 0,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Where the list starts, e.g. so the current chapter is in view. */
  scrollY?: number;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollViewInstance>(null);
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} />
      <View
        style={{
          maxHeight: "80%",
          backgroundColor: t.surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingTop: 10,
          paddingBottom: insets.bottom + 12,
        }}
      >
        <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: t.track, marginBottom: 10 }} />
        {title ? (
          <Text variant="heading" numberOfLines={2} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            {title}
          </Text>
        ) : null}
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 8 }}
          onContentSizeChange={() => scrollY && scroll.current?.scrollTo({ y: scrollY, animated: false })}
          ref={scroll}
        >{children}</ScrollView>
      </View>
    </Modal>
  );
}

export function SheetItem({
  label,
  onPress,
  active,
  danger,
  disabled,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: 12,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: pressed ? t.surface2 : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Text style={{ fontFamily: active ? fonts.bold : fonts.medium, fontSize: 16, color: danger ? t.danger : active ? t.accent : t.text }}>
        {label}
      </Text>
      {active ? <CheckIcon size={20} color={t.accent} /> : null}
    </Pressable>
  );
}
