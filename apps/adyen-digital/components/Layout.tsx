import { AppShell } from "@suite/ui/components.tsx";
import type { ComponentChildren } from "preact";

// Pages that belong to the "Checkout" section of the header.
const CHECKOUT_PATHS = ["/sessions", "/advanced", "/api-only", "/mit", "/pay-by-link", "/result"];

export function DigitalLayout(props: {
  path: string;
  children: ComponentChildren;
  ownTestingDataset?: boolean;
}) {
  return (
    <AppShell
      title="Digital Checkout"
      subtitle="Online payment lifecycle"
      currentPath={props.path}
      ownTestingDataset={props.ownTestingDataset}
      homeLabel="Checkout"
      homeActive={CHECKOUT_PATHS.includes(props.path)}
    >
      {props.children}
    </AppShell>
  );
}
