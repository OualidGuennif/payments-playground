// Spec: knowledge/components/adyen-agentic-commerce.md
import Link from "next/link";
import { DOCS, OVERVIEW } from "@/components/docs/content";
import { SequenceDiagram } from "@/components/docs/SequenceDiagram";
import { config } from "@/server/core/config";

// PUBLIC_ORIGIN is read per request so one image serves any origin.
export const dynamic = "force-dynamic";

export const metadata = { title: "Docs" };

export default function Docs() {
  const o = config().publicOrigin;
  const endpoints: [string, string][] = [
    ["MCP server", `${o}/mcp`],
    ["PAP discovery", `${o}/.well-known/poppy.json`],
    ["PAP tasks", `${o}/poppy/tasks`],
    ["UCP profile", `${o}/.well-known/ucp`],
    ["UCP REST", `${o}/ucp/v1`],
    ["OpenAPI", `${o}/ucp/v1/openapi.json`],
    ["Authorization server", `${o}/.well-known/oauth-authorization-server`],
    ["Protected resource", `${o}/.well-known/oauth-protected-resource/mcp`],
    ["Device sign-in", `${o}/device`],
  ];
  return (
    <div className="space-y-10">
      <header className="max-w-[68ch] space-y-2">
        <p className="eyebrow">Docs</p>
        <h1 className="text-3xl">How agents shop here</h1>
        <p className="text-muted">
          An AI agent reaches this store through a remote tool server (MCP), the shopping API (UCP)
          or tools in your browser (WebMCP). Poppy (PAP 1.0) is how it signs in, and Adyen TEST
          takes every payment. Step through one whole purchase below, then open each part.
        </p>
      </header>

      <SequenceDiagram
        title="One purchase by an AI agent, from your request to the order"
        actors={OVERVIEW.actors}
        steps={OVERVIEW.steps}
      />

      <section className="space-y-3">
        <h2 className="text-xl">Each part, message by message</h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {DOCS.map((d) => (
            <li key={d.slug}>
              <Link
                href={`/docs/${d.slug}`}
                className="panel block h-full space-y-1 hover:border-ink"
              >
                <span className="block font-medium">{d.title}</span>
                <span className="block text-sm text-muted">{d.short}</span>
                <span className="block pt-1 text-xs text-muted">
                  {d.steps.length} steps{d.tries.length ? " · Try it" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel space-y-3">
        <h2 className="text-xl">Endpoints</h2>
        <dl className="space-y-2 text-sm">
          {endpoints.map(([k, v]) => (
            <div key={k} className="grid gap-1 sm:grid-cols-[12rem_1fr]">
              <dt className="text-muted">{k}</dt>
              <dd className="break-all">
                <a className="underline" href={v}>
                  {v}
                </a>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
