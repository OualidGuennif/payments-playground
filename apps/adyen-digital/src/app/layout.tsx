// Spec: knowledge/components/adyen-digital.md
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ThemeScript } from "@suite/ui/ThemeScript.tsx";
import "@suite/ui/styles.css";
import "@adyen/adyen-web/styles/adyen.css";
// The app's own styles, layered on the shared tokens: every colour is a token,
// so light and dark both come from the shared palette. One file per area; the
// order below is the cascade, so a later file wins a tie.
import "../styles/controls.css";
import "../styles/checkout.css";
import "../styles/result.css";
import "../styles/forms.css";
import "../styles/sheet.css";
import "../styles/inspector.css";
import "../styles/timeline.css";
import "../styles/home.css";
import "../styles/back-office.css";
import "../styles/wiki.css";
import "../styles/lifecycle.css";
import "../styles/settings.css";
import "../styles/adyen-dark.css";
import "../styles/responsive.css";

export const metadata: Metadata = {
  title: "Digital Checkout · TEST Playground",
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
