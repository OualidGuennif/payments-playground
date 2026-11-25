// Spec: knowledge/components/adyen-agentic-commerce.md
// The plugin package's download on the ChatGPT Docs page; relative links, because the Docs topic
// pages are built once and served on any origin.
import Link from "next/link";
import { PLUGIN_ZIP_PATH } from "@/server/mcp/widgets";

export function PluginDownload() {
  return (
    <section className="panel flex flex-wrap items-center justify-between gap-3">
      <div className="max-w-[60ch] space-y-1">
        <h2 className="text-lg">Download the plugin</h2>
        <p className="text-sm text-muted">
          A ZIP of a few kilobytes: <code>plugin.json</code>, <code>mcp.json</code>, a skill and two
          icons, with no app reference and no hooks. Its MCP address is the one on the Agents page.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="btn" href={PLUGIN_ZIP_PATH} download>
          Download the ZIP
        </a>
        <Link className="btn-ghost" href="/agents">
          MCP address
        </Link>
      </div>
    </section>
  );
}
