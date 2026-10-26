import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Modal, Pressable, type ScrollViewInstance, View } from "react-native";
import { GestureDetector, GestureHandlerRootView, ScrollView, usePanGesture } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
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

const SheetScroll = Animated.createAnimatedComponent(ScrollView);
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
  keepInView,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  /**
   * A row to have in view when the sheet opens, e.g. the current chapter. The list only starts
   * scrolled when the row would be out of sight, since a scrolled list spends the start of a
   * pull scrolling back before the sheet follows.
   */
  keepInView?: { top: number; height: number };
  children: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollViewInstance>(null);
  const keyboard = useKeyboardHeight();
  const listY = useSharedValue(0);
  /** Where the list starts within the sheet, and whether the current pull started on it. */
  const listTop = useSharedValue(0);
  const inList = useSharedValue(false);
  // On the UI thread, so the sheet takes over the same frame the list reaches its top.
  const onScroll = useAnimatedScrollHandler((e) => {
    listY.set(e.contentOffset.y);
  });
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
  // The slide in waits until the sheet has been measured, then starts just below the screen's
  // edge. From the full screen height, a short sheet would spend half the slide out of sight and
  // then pop up.
  const waiting = useRef(false);
  const measured = useRef(false);
  const slideIn = (h: number) => {
    waiting.current = false;
    drag.set(h + 40);
    drag.set(withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) }));
  };
  // Once both the list and its contents are measured, scroll just far enough to centre the
  // row, and only if it's out of sight.
  const fit = useRef({ view: 0, content: 0, done: false });
  const bringIntoView = () => {
    const { view, content, done } = fit.current;
    if (done || !keepInView || !view || !content) return;
    fit.current.done = true;
    const { top, height } = keepInView;
    if (top + height <= view) return;
    scroll.current?.scrollTo({ y: Math.min(content - view, top + height / 2 - view / 2), animated: false });
  };
  const closed = () => {
    measured.current = false;
    fit.current = { view: 0, content: 0, done: false };
    setMounted(false);
  };

  useEffect(() => {
    if (open) {
      listY.set(0);
      if (measured.current) slideIn(height.get());
      else waiting.current = true;
    } else {
      const off = (height.get() || Dimensions.get("window").height) + 40;
      drag.set(withTiming(off, { duration: 200, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(closed);
      }));
    }
    // slideIn and closed only touch refs and shared values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, drag, listY, height]);

  const pan = usePanGesture({
    activeOffsetY: [-12, 12],
    failOffsetX: [-24, 24],
    onActivate: (e) => {
      spent.set(0);
      // Where the finger went down: the handle and title, or the list.
      inList.set(e.y - e.translationY >= listTop.get());
    },
    onUpdate: (e) => {
      speed.set(e.velocityY);
      // A pull on the handle or title always moves the sheet; one on the list scrolls it back first.
      if (inList.get() && listY.get() > 0) {
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
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              height.set(h);
              measured.current = true;
              if (waiting.current) slideIn(h);
            }}
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
            {/* The list starts where the handle and title end. */}
            <View onLayout={(e) => listTop.set(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
              <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: t.track, marginBottom: 10 }} />
              {title ? (
                <Text variant="heading" numberOfLines={2} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
                  {title}
                </Text>
              ) : null}
            </View>
            <SheetScroll
              contentContainerStyle={{ paddingHorizontal: 8 }}
              // A tap on a result works straight away instead of first only closing the keyboard.
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={(_, h) => {
                fit.current.content = h;
                bringIntoView();
              }}
              onLayout={(e) => {
                fit.current.view = e.nativeEvent.layout.height;
                bringIntoView();
              }}
              onScroll={onScroll}
              scrollEventThrottle={16}
              simultaneousWith={pan}
              ref={scroll}
            >
              <InSheet.Provider value>{children}</InSheet.Provider>
            </SheetScroll>
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
