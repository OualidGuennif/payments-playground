// The workbench renders in the browser only: its first market, currency, amount, locale and theme
// come from the browser's languages and stored choice, which the server cannot know, so a server
// render could only mismatch. The bootstrap still arrives with the page, so nothing waits on a
// fetch once the script has loaded.
"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type FlowWorkbenchComponent from "./FlowWorkbench.tsx";

const FlowWorkbench = dynamic(() => import("./FlowWorkbench.tsx"), {
  ssr: false,
  loading: () => (
    <p className="muted" role="status">
      Loading the checkout…
    </p>
  ),
});

export function ClientWorkbench(props: ComponentProps<typeof FlowWorkbenchComponent>) {
  return <FlowWorkbench {...props} />;
}
