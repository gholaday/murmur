import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Keyboard, Pressable, TextInput, View } from "react-native";
import { fonts, useTheme } from "@/theme";
import { CloseIcon, SearchIcon } from "./icons";
import type { TextInputRef } from "./ui";

/** A search box: a pill with an accent outline while typing, and an X once there's text. Search's and Browse's. */
export function SearchPill({
  ref,
  value,
  onChangeText,
  placeholder,
  autoFocus,
  onSubmitEditing,
  links,
}: {
  /** Takes links as well as words: no capitals or corrections. */
  links?: boolean;
  ref?: Ref<TextInputRef>;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInputRef>(null);
  useImperativeHandle(ref, () => input.current!, []);
  // Android keeps the box focused when back closes the keyboard; it should look done with.
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidHide", () => input.current?.blur());
    return () => sub.remove();
  }, []);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: 48,
        paddingLeft: 14.5,
        paddingRight: value ? 6 : 14.5,
        borderRadius: 24,
        borderWidth: 1.5,
        borderColor: focused ? t.accent : t.track,
        backgroundColor: focused ? t.surface2 : t.surface,
      }}
    >
      <SearchIcon size={20} color={t.muted} />
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmitEditing}
        autoFocus={autoFocus}
        placeholder={placeholder}
        placeholderTextColor={t.faint}
        selectionColor={t.accent}
        returnKeyType="search"
        // Browse's box takes feed links too.
        autoCapitalize={links ? "none" : undefined}
        autoCorrect={links ? false : undefined}
        accessibilityLabel={placeholder}
        // Android's font padding sits the text low; without it, centred, it lines up with the magnifier.
        style={{
          flex: 1,
          minWidth: 0,
          height: 44,
          color: t.text,
          fontFamily: fonts.semibold,
          fontSize: 15,
          lineHeight: 20,
          paddingVertical: 0,
          includeFontPadding: false,
          textAlignVertical: "center",
        }}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={4}
          onPress={() => {
            onChangeText("");
            input.current?.focus();
          }}
          style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <CloseIcon size={18} color={t.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}
