import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ClientWorkbench } from "@/components/ClientWorkbench.tsx";
import { isFlow } from "@/components/flows.ts";
import type { Bootstrap } from "@/components/flow-helpers.ts";
import { DigitalLayout } from "@/components/Layout.tsx";
import { bootstrapFor } from "@/server/api";

type Query = Record<string, string | string[] | undefined>;

export default async function FlowPage(
  { params, searchParams }: { params: Promise<{ flow: string }>; searchParams: Promise<Query> },
) {
  const { flow } = await params;
  if (!isFlow(flow)) notFound();
  // Answering /api/bootstrap in-process with the page removes the
  // client-side fetch that used to hold the checkout back on every flow
  // page. The CSRF cookie its first POST needs comes from src/proxy.ts.
  const bootstrap = await bootstrapFor(await headers()) as Bootstrap;
  const integration = (await searchParams).integration === "component" ? "component" : "dropin";
  return (
    <DigitalLayout path={`/${flow}`}>
      <ClientWorkbench flow={flow} initialBootstrap={bootstrap} initialIntegration={integration} />
    </DigitalLayout>
  );
}
