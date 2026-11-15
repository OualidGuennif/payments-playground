// Spec: knowledge/components/adyen-v6-styling.md
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ThemeScript } from "@suite/ui/ThemeScript.tsx";
import "@suite/ui/styles.css";
import "@adyen/adyen-web/styles/adyen.css";
import "./app.css";

export const metadata: Metadata = {
  title: "Drop-in Styling · TEST Playground",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // The theme script sets data-theme on <html> before React hydrates, hence the warning opt-out.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
