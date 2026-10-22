import { Platform } from "react-native";

export const isIOS = Platform.OS === "ios";

/** How this app names itself: the device name it signs in as, and its row in Settings. */
export const APP_NAME = isIOS ? "iPhone app" : "Android app";
