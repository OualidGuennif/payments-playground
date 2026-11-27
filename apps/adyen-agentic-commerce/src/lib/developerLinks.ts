// Spec: knowledge/components/agentic-storefront.md
// The header's Developers links, shared by the menu (a client module) and the layout (a server one).
export const DEVELOPER_LINKS = [
  ["/agents", "Connect an agent", "ChatGPT, Claude or any MCP client"],
  ["/docs", "Technical docs", "UCP, PAP, MCP and the payment flows"],
  ["/back-office", "Back Office", "Every request, grant and payment, live"],
  ["/api/feeds/openai.json", "OpenAI product feed", "The catalogue as JSON (and .jsonl)"],
  ["/console", "Agent console", "The Personal Shopper's models and sessions"],
] as const;
