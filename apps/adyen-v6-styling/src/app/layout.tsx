// Spec: knowledge/components/adyen-v6-styling.md
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ThemeScript } from "@suite/ui/ThemeScript.tsx";
import "@suite/ui/styles.css";
import "@adyen/adyen-web/styles/adyen.css";
// One file per area; the order below is the cascade, so a later file wins a tie.
import "../styles/page.css";
import "../styles/test-cards.css";
import "../styles/preview.css";
import "../styles/confirm.css";
import "../styles/panel.css";
import "../styles/responsive.css";
import "../styles/footer.css";

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
