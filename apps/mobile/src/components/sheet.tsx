import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Modal, Pressable, ScrollView, type ScrollViewInstance, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, useTheme } from "@/theme";
import { CheckIcon } from "./icons";
import { Button, InSheet, Text } from "./ui";

/** "Are you sure?" for actions that delete something: a message, then Cancel and the action. */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <View style={{ paddingHorizontal: 12, gap: 14, paddingBottom: 8 }}>
        <Text>{message}</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button label="Cancel" kind="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button
            label={confirmLabel}
            onPress={() => {
              onClose();
              onConfirm();
            }}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </Sheet>
  );
}

/** Confirmation for removing one download from the phone. */
export function RemoveDownloadSheet({ open, title, onConfirm, onClose }: { open: boolean; title: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <ConfirmSheet
      open={open}
      title="Remove download?"
      message={`${title} will be deleted from this phone. It stays on the server, so you can download it again.`}
      confirmLabel="Remove"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

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
  const keyboard = useKeyboardHeight();
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
          paddingBottom: Math.max(insets.bottom, keyboard) + 12,
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
        >
          <InSheet.Provider value>{children}</InSheet.Provider>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** The sheet draws edge to edge, so Android doesn't resize it for the keyboard; it lifts itself instead. */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setHeight(Dimensions.get("screen").height - e.endCoordinates.screenY));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
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
