// Spec: knowledge/components/adyen-agentic-commerce.md
import Link from "next/link";
import { CopyButton } from "@/components/back-office/CopyButton";
import { config } from "@/server/config";

// PUBLIC_ORIGIN is read per request so one image serves any origin.
export const dynamic = "force-dynamic";

export const metadata = { title: "Connect an agent" };

// The shopper's page: three steps and the address to paste. How it works sits under /docs.
export default function Agents() {
  const o = config().publicOrigin;
  const mcp = `${o}/mcp`;
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="max-w-[60ch] space-y-2">
        <h1 className="text-3xl">Connect your AI agent</h1>
        <p className="text-muted">
          Let an assistant shop here for you, within a budget you choose. You can change the budget
          or disconnect it from your account at any time.
        </p>
      </header>

      <section className="panel space-y-3" aria-labelledby="mcp-url">
        <h2 id="mcp-url" className="text-sm font-medium text-muted">
          This store's MCP address
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-xl border border-line bg-paper px-3 py-2.5 font-mono text-sm">
            {mcp}
          </code>
          <CopyButton text={mcp} label="Copy" />
        </div>
      </section>

      <ol className="grid gap-3 md:grid-cols-3">
        {[
          ["Add it", "Paste the address as a remote MCP connector in your assistant."],
          [
            "Allow it",
            "The assistant opens this store's sign-in. You see what it asks for and set its budget.",
          ],
          [
            "Ask it to shop",
            "It searches, builds a checkout and pays with your saved card. Above the budget, it sends you a link to pay yourself.",
          ],
        ].map(([title, text], i) => (
          <li key={title} className="panel space-y-2">
            <span className="grid size-8 place-items-center rounded-full bg-ink text-sm font-semibold text-paper">
              {i + 1}
            </span>
            <h2 className="font-medium">{title}</h2>
            <p className="text-sm text-muted">{text}</p>
          </li>
        ))}
      </ol>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="panel space-y-2">
          <h2 className="text-lg">ChatGPT</h2>
          <p className="text-sm text-muted">
            Add a custom connector with the address above. ChatGPT opens this store's sign-in the
            first time it uses it. Tested on 2026-11-18: it signed in and bought an item.
          </p>
        </div>
        <div className="panel space-y-2">
          <h2 className="text-lg">Other assistants</h2>
          <p className="text-sm text-muted">
            Any host that connects to remote MCP servers over Streamable HTTP and signs in with
            OAuth works the same way.{" "}
            <Link href="/docs/mcp" className="underline">
              What it needs
            </Link>
          </p>
        </div>
        <div className="panel space-y-2">
          <h2 className="text-lg">An agent showed you a code</h2>
          <p className="text-sm text-muted">
            Agents without a browser, in a terminal or on a server, show an 8-letter code. Enter it
            at{" "}
            <Link href="/device" className="underline">
              {o}/device
            </Link>
            .
          </p>
        </div>
        <div className="panel space-y-2">
          <h2 className="text-lg">An agent in your browser</h2>
          <p className="text-sm text-muted">
            With WebMCP, an agent built into your browser can search and fill your cart here. You
            still pay yourself.{" "}
            <Link href="/docs/webmcp" className="underline">
              How it works
            </Link>
          </p>
        </div>
      </section>

      <p className="text-sm text-muted">
        Building an agent? The{" "}
        <Link href="/docs" className="underline">
          Docs
        </Link>{" "}
        walk through PAP 1.0, MCP, UCP and the Adyen calls, message by message, with every endpoint.
      </p>
    </div>
  );
}
