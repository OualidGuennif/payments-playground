// Spec: knowledge/components/ask-agent.md
// The store pages the Ask agent may open in the shopper's browser (spec invariant 21). Browser
// safe: the server's `open_page` tool and the panel check a page with this one list.

const ID = "[A-Za-z0-9_-]{1,80}";
const PAGES: { path: RegExp; query: Record<string, RegExp> }[] = [
  { path: /^\/$/, query: {} },
  { path: /^\/shop$/, query: { category: /^[a-z0-9-]{1,40}$/, q: /^[^<>]{1,80}$/ } },
  { path: new RegExp(`^/products/${ID}$`), query: { variant: new RegExp(`^${ID}$`) } },
  { path: /^\/cart$/, query: {} },
  { path: new RegExp(`^/checkout/${ID}$`), query: {} },
  { path: new RegExp(`^/orders/${ID}$`), query: {} },
  { path: /^\/(account|agents|docs|legal|sign-in|sign-up)$/, query: {} },
  { path: /^\/docs\/[a-z0-9-]{1,40}$/, query: {} },
];
const SECTION = /^(#[a-z0-9-]{1,40})?$/;
// The URL parser drops tabs and newlines and reads a backslash as a slash; a value carrying one
// is refused before parsing, so what is checked is what was written.
export const oddForUrl = (value: string) =>
  value.includes("\\") ||
  [...value].some((c) => {
    const code = c.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

// The page as a path the router opens in place, or undefined when it is not on the list.
export function openablePage(value: unknown, origin: string): string | undefined {
  if (typeof value !== "string" || value.length > 300 || oddForUrl(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return undefined;
  }
  if (url.origin !== origin || !SECTION.test(url.hash)) return undefined;
  const page = PAGES.find((p) => p.path.test(url.pathname));
  if (!page) return undefined;
  for (const [name, text] of url.searchParams) {
    const rule = page.query[name];
    if (!rule?.test(text)) return undefined;
  }
  return `${url.pathname}${url.search ? `?${url.searchParams}` : ""}${url.hash}`;
}
