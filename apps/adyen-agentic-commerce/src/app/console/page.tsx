// Spec: knowledge/components/ask-agent.md
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConsoleApp } from "@/components/console/ConsoleApp";
import { askConfig } from "@/server/ask/config";

export const metadata: Metadata = {
  title: "Console",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

// Without a console password of 16 characters or more the page does not exist (spec invariant 13).
export default function ConsolePage() {
  if (!askConfig().consolePassword) notFound();
  return <ConsoleApp />;
}
