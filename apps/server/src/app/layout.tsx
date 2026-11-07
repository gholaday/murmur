import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE, THEME_SCRIPT, isThemeChoice } from "@/web/theme";
import { Toaster } from "@/web/toaster";
import { Tooltips } from "@/web/tooltip";
import "./globals.css";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Murmur",
  description: "Your audiobooks and podcasts",
  // Added to an iPhone's home screen, it opens full screen like an app. The default status bar
  // keeps pages below it, since only the player pads for the notch.
  appleWebApp: { capable: true, title: "Murmur", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#111214" },
    { media: "(prefers-color-scheme: light)", color: "#fafaf8" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered on the server from a cookie so a chosen theme never flashes the other one first.
  const saved = (await cookies()).get(THEME_COOKIE)?.value;
  const choice = isThemeChoice(saved) ? saved : "system";
  return (
    // The theme script fills in data-theme for "System" before React hydrates, so the attribute differs.
    <html
      lang="en"
      className={sans.variable}
      data-theme={choice === "system" ? undefined : choice}
      data-theme-choice={choice}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <Toaster />
        <Tooltips />
      </body>
    </html>
  );
}
