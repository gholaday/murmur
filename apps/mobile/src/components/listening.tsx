import { View } from "react-native";
import { Caption, Text } from "./ui";

/** A line under a heading: a short summary on the left, an action on the right. */
export function ListMeta({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, marginTop: 4 }}>
      <Text variant="small">{text}</Text>
      {action}
    </View>
  );
}

export function Eyebrow({ children }: { children: string }) {
  return (
    <Caption style={{ marginBottom: 10 }}>{children}</Caption>
  );
}
