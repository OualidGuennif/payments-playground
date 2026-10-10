import { AppShell } from "@suite/ui/components.tsx";
import type { ComponentChildren } from "preact";

export function AgenticLayout(props: { path: string; children: ComponentChildren }) {
  return (
    <AppShell
      title="Agentic Commerce"
      currentPath={props.path}
    >
      {props.children}
    </AppShell>
  );
}
