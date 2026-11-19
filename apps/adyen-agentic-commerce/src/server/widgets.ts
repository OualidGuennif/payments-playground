// Spec: knowledge/components/adyen-agentic-commerce.md
// The MCP Apps side of /mcp: the two UI resources and the _meta that ties a UCP tool to one of
// them, in the standard keys and in ChatGPT's aliases. The widgets themselves are built from
// src/widgets into widgets.gen.ts (ADR-017).
import { config } from "./config";
import { PLUGIN_FILES, WIDGET_CSS, WIDGET_SCRIPT } from "./widgets.gen";
import { zip } from "./zip";

export const MCP_APP_MIME = "text/html;profile=mcp-app";
export const CAROUSEL = "ui://widget/product-carousel-v2.html";
export const BAG = "ui://widget/cart-checkout-v2.html";

const LEGACY_URIS: Record<string, typeof CAROUSEL | typeof BAG> = {
  "ui://widget/product-carousel.html": CAROUSEL,
  "ui://widget/cart-checkout.html": BAG,
};

const WIDGETS = {
  [CAROUSEL]: {
    view: "catalog",
    name: "product-carousel",
    title: "Atelier Velune collection",
    description:
      "Products from Atelier Velune in a carousel, with colour and size, to add to the bag by hand or through the assistant.",
  },
  [BAG]: {
    view: "bag",
    name: "cart-checkout",
    title: "Atelier Velune bag",
    description:
      "The shopper's Atelier Velune bag or checkout: lines, totals, and payment with a card saved in their account.",
  },
} as const;

// Which tools render which widget, and what the host says while they run (64 characters at most).
const TOOL_UI: Record<string, { uri: string; invoking: string; invoked: string }> = {
  search_catalog: {
    uri: CAROUSEL,
    invoking: "Browsing the collection…",
    invoked: "Collection loaded",
  },
  get_product: { uri: CAROUSEL, invoking: "Opening the product…", invoked: "Product loaded" },
  create_cart: { uri: BAG, invoking: "Starting your bag…", invoked: "Bag ready" },
  get_cart: { uri: BAG, invoking: "Opening your bag…", invoked: "Bag loaded" },
  update_cart: { uri: BAG, invoking: "Updating your bag…", invoked: "Bag updated" },
  create_checkout: { uri: BAG, invoking: "Starting checkout…", invoked: "Checkout ready" },
  get_checkout: { uri: BAG, invoking: "Opening checkout…", invoked: "Checkout loaded" },
  update_checkout: { uri: BAG, invoking: "Updating checkout…", invoked: "Checkout updated" },
  complete_checkout: { uri: BAG, invoking: "Paying on Adyen TEST…", invoked: "Payment answered" },
};

export function toolUiMeta(name: string) {
  const ui = TOOL_UI[name];
  if (!ui) return undefined;
  return {
    ui: { resourceUri: ui.uri, visibility: ["model", "app"] },
    "openai/outputTemplate": ui.uri,
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": ui.invoking,
    "openai/toolInvocation/invoked": ui.invoked,
  };
}

// Images from the store only, and no connection at all: every call goes through the host.
function resourceMeta(description: string) {
  const origin = config().publicOrigin;
  return {
    ui: { csp: { connectDomains: [], resourceDomains: [origin] }, prefersBorder: true },
    "openai/widgetCSP": {
      connect_domains: [],
      resource_domains: [origin],
      redirect_domains: [origin],
    },
    "openai/widgetPrefersBorder": true,
    "openai/widgetDescription": description,
  };
}

const attribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
// Inside a <script> element only the closing tag and a comment opener end or change the script.
const inlineScript = (js: string) =>
  js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
const inlineStyle = (css: string) => css.replace(/<\/(style)/gi, "<\\/$1");

export function widgetHtml(uri: keyof typeof WIDGETS) {
  const w = WIDGETS[uri];
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="store-origin" content="${attribute(config().publicOrigin)}">`,
    `<title>${attribute(w.title)}</title>`,
    `<style>${inlineStyle(WIDGET_CSS)}</style>`,
    "</head>",
    `<body data-view="${w.view}">`,
    '<main id="app"></main>',
    `<script>${inlineScript(WIDGET_SCRIPT)}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

export function listResources() {
  return Object.entries(WIDGETS).map(([uri, w]) => ({
    uri,
    name: w.name,
    title: w.title,
    description: w.description,
    mimeType: MCP_APP_MIME,
    _meta: resourceMeta(w.description),
  }));
}

export function readResource(uri: unknown) {
  if (typeof uri !== "string") return undefined;
  const key = Object.hasOwn(WIDGETS, uri) ? (uri as keyof typeof WIDGETS) : LEGACY_URIS[uri];
  if (!key) return undefined;
  return {
    contents: [
      {
        uri,
        mimeType: MCP_APP_MIME,
        text: widgetHtml(key),
        _meta: resourceMeta(WIDGETS[key].description),
      },
    ],
  };
}

export function stylistPromptText(): string {
  const raw = PLUGIN_FILES["skills/personal-stylist/SKILL.md"] ?? "";
  return raw.replace(/^---[\s\S]*?---\s*/, "").trim();
}

// --- the plugin package -----------------------------------------------------------------------

export const PLUGIN_ZIP_PATH = "/downloads/atelier-velune-plugin.zip";

// mcp.json names this deployment's own /mcp and declares OpenAI OAuth CIMD metadata.
export function pluginFiles(): Record<string, string> {
  const files = { ...PLUGIN_FILES };
  files["mcp.json"] = `${JSON.stringify(
    {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        "atelier-velune": {
          type: "streamable-http",
          url: `${config().publicOrigin}/mcp`,
          extensions: {
            "com.openai": {
              auth: {
                type: "oauth",
                client: { mode: "cimd" },
              },
            },
          },
        },
      },
    },
    null,
    2,
  )}\n`;
  return files;
}

export function pluginZip(): Uint8Array<ArrayBuffer> {
  const files = pluginFiles();
  return zip(
    Object.keys(files)
      .sort()
      .map((name) => ({
        name: `atelier-velune/${name}`,
        data: new TextEncoder().encode(files[name]),
      })),
  );
}
