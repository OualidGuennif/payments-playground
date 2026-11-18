# Agentic Commerce: Atelier Velune

A demo fashion store (fictional brand, original SVG art) that a shopper can use directly and that any
MCP-capable AI agent can shop on their behalf: discovery and sign-in with PAP 1.0, catalogue, cart
and checkout with UCP 2026-08-25 over REST and MCP, and a real **Adyen TEST** payment: on a card the
shopper's account saved, on a network token the agent brings, or by the shopper at `continue_url`.
No language model runs here.

One Next.js 16 app on the Bun runtime: pages under `src/app`, one Elysia instance in
`src/server/api.ts` that the route files re-export, an Eden client in the browser and `bun:sqlite`.
Spec: [knowledge/components/adyen-agentic-commerce.md](../../knowledge/components/adyen-agentic-commerce.md).

## Run it

Needs Bun 1.4.4. Copy `.env.example` to `.env` and fill in the TEST credentials, then
from the repository root:

```bash
bun run dev:agentic          # http://127.0.0.1:8003
```

The task goes through `tools/dev/bun-app.ts`, which loads the env file the way the other apps do;
plain `bun run dev` lets Next re-expand `$` inside the API key.

| In this folder                 | What it does                                          |
| ------------------------------ | ----------------------------------------------------- |
| `bun test`                     | Tests against an Adyen double; no network             |
| `bun run typecheck`            | `tsc --noEmit`                                        |
| `bun run build`                | Standalone production build                           |
| `bun run scripts/pap-agent.ts` | A scripted PAP agent that buys one item over MCP      |

## Try an agent

1. Open `/account` and save a card with Drop-in (a zero-value authorisation).
2. Run `bun run scripts/pap-agent.ts`, approve the sign-in it prints, and watch the order and every
   protocol exchange appear in `/back-office`. `--auto-consent` approves for you on a local run.
3. Or point any MCP client at `${PUBLIC_ORIGIN}/mcp`; `/agents` lists what the host needs, the
   scopes, and the device sign-in for agents that cannot receive a browser callback.
4. Or, in Chrome with WebMCP (`chrome://flags/#enable-webmcp-testing`, or the origin trial), open
   `/shop`: the page registers five cart tools; the Model Context Tool Inspector extension lists
   them. No tool pays.

## WebMCP origin trial

On a deploy, set `WEBMCP_ORIGIN_TRIAL_TOKEN` to the token Chrome's origin trials console issues
for the store's origin. The proxy sends it as an `Origin-Trial` header on pages, read on each
request; leave it unset to send nothing. The token is public, not a secret.
