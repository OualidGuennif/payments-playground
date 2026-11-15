import { AppShell } from "@suite/ui/components.tsx";
import type { ReactNode } from "react";

export function DigitalLayout(props: {
  path: string;
  children: ReactNode;
}) {
  return (
    <AppShell title="Digital Checkout" currentPath={props.path} minimal>
      {props.children}
    </AppShell>
  );
}
