import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Modal, Pressable, type ScrollViewInstance, View } from "react-native";
import { GestureDetector, GestureHandlerRootView, ScrollView, usePanGesture } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
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

/** How far a pull, or how fast a flick, closes the sheet. */
const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 900;

/**
 * A bottom sheet for menus and pickers. Tapping outside, Back, or dragging it down closes it.
 * The drag works anywhere on the sheet: while its list is scrolled down, pulling scrolls the
 * list back first, and the sheet follows once it's at the top.
 */
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
  const listY = useSharedValue(0);
  /** How far the sheet sits below its resting place; starts off screen and slides in. */
  const drag = useSharedValue(Dimensions.get("window").height);
  const height = useSharedValue(0);
  /** The pull already spent scrolling the list back to its top. */
  const spent = useSharedValue(0);
  const speed = useSharedValue(0);
  // The sheet animates itself (the modal's own slide would move the backdrop too), so it stays
  // mounted after `open` turns false until it has slid away.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      listY.set(0);
      drag.set(withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) }));
    } else {
      const off = (height.get() || Dimensions.get("window").height) + 40;
      drag.set(withTiming(off, { duration: 200, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      }));
    }
  }, [open, drag, listY, height]);

  const pan = usePanGesture({
    activeOffsetY: [-12, 12],
    failOffsetX: [-24, 24],
    onActivate: () => {
      spent.set(0);
    },
    onUpdate: (e) => {
      speed.set(e.velocityY);
      if (listY.get() > 0) {
        spent.set(e.translationY);
        drag.set(0);
        return;
      }
      drag.set(Math.max(0, e.translationY - spent.get()));
    },
    onFinalize: () => {
      const pulled = drag.get();
      if (pulled > 0 && (pulled > CLOSE_DISTANCE || speed.get() > CLOSE_VELOCITY)) {
        drag.set(withTiming(height.get() + 40, { duration: 180 }, () => scheduleOnRN(onClose)));
      } else if (pulled > 0) {
        drag.set(withTiming(0, { duration: 180 }));
      }
    },
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));
  // The backdrop fades with the sheet: in as it slides up, out as it's dragged or slides away.
  const screen = Dimensions.get("window").height;
  const backdropStyle = useAnimatedStyle(() => {
    const span = height.value || screen;
    return { opacity: 1 - Math.min(1, drag.value / span) };
  });

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1, justifyContent: "flex-end" }}>
        {/* Behind the whole sheet, not just above it, so dragging the sheet down uncovers dimmed screen. */}
        <Animated.View style={[{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.5)" }, backdropStyle]}>
          <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            onLayout={(e) => height.set(e.nativeEvent.layout.height)}
            style={[
              {
                maxHeight: "80%",
                backgroundColor: t.surface,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingTop: 10,
                paddingBottom: Math.max(insets.bottom, keyboard) + 12,
              },
              sheetStyle,
            ]}
          >
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: t.track, marginBottom: 10 }} />
            {title ? (
              <Text variant="heading" numberOfLines={2} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
                {title}
              </Text>
            ) : null}
            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 8 }}
              // A tap on a result works straight away instead of first only closing the keyboard.
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => scrollY && scroll.current?.scrollTo({ y: scrollY, animated: false })}
              onScroll={(e) => listY.set(e.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              simultaneousWith={pan}
              ref={scroll}
            >
              <InSheet.Provider value>{children}</InSheet.Provider>
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
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
  hint,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** A short line under the label. */
  hint?: string;
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
        paddingVertical: hint ? 8 : 0,
        gap: 12,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: pressed ? t.surface2 : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text style={{ fontFamily: active ? fonts.bold : fonts.medium, fontSize: 16, color: danger ? t.danger : active ? t.accent : t.text }}>
          {label}
        </Text>
        {hint ? <Text variant="small">{hint}</Text> : null}
      </View>
      {active ? <CheckIcon size={20} color={t.accent} /> : null}
    </Pressable>
  );
}
