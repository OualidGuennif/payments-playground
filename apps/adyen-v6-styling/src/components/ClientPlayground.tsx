// Spec: knowledge/components/adyen-v6-styling.md
// The playground renders in the browser only: its first state comes from localStorage and the
// browser's languages, which the server cannot know, so a server render could only mismatch.
"use client";
import dynamic from "next/dynamic";

const StylingPlayground = dynamic(() => import("./StylingPlayground.tsx"), {
  ssr: false,
  loading: () => (
    <p className="styling-loading" role="status">
      Loading the playground…
    </p>
  ),
});

export function ClientPlayground() {
  return <StylingPlayground />;
}
