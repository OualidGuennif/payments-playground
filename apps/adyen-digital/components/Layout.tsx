import { AppShell } from "@suite/ui/components.tsx";
import type { ComponentChildren } from "preact";

export function DigitalLayout(props: {
  path: string;
  children: ComponentChildren;
}) {
  return (
    <AppShell title="Digital Checkout" currentPath={props.path} minimal>
      {props.children}
    </AppShell>
  );
}
