import { useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EyeIcon, EyeOffIcon, Logo } from "@/components/icons";
import { Button, Field, IconButton, Text, type TextInputRef } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";

/** First run: server address, then username and password. The token is kept until revoked. */
export default function Login() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const [server, setServer] = useState(session.serverUrl ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<TextInputRef>(null);
  const passRef = useRef<TextInputRef>(null);

  const ready = server.trim() !== "" && username.trim() !== "" && password !== "";

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.signIn(server, username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in. Try again.");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          gap: 28,
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <View style={{ alignItems: "center", gap: 14 }}>
          <Logo color={t.accent} />
          <Text variant="title">Sign in to Murmur</Text>
        </View>

        <View style={{ gap: 16 }}>
          <Field
            label="Server address"
            value={server}
            onChangeText={setServer}
            placeholder="murmur.example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            returnKeyType="next"
            onSubmitEditing={() => userRef.current?.focus()}
          />
          <Field
            ref={userRef}
            label="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passRef.current?.focus()}
          />
          <Field
            ref={passRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            // Without these, Android's default sentence capitalization reaches some keyboards
            // even in a password field, so the first letter is silently uppercased.
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            right={
              <IconButton label={showPassword ? "Hide password" : "Show password"} onPress={() => setShowPassword((s) => !s)}>
                {showPassword ? <EyeOffIcon size={22} color={t.muted} /> : <EyeIcon size={22} color={t.muted} />}
              </IconButton>
            }
          />
          {error ? (
            <Text variant="small" style={{ color: t.danger }} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label="Sign in" onPress={() => void submit()} busy={busy} disabled={!ready} style={{ marginTop: 4 }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
