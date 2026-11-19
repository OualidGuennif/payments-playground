// MCP Apps on /mcp: the two UI resources, the tools that name them, and the widget's own requests
// run against the store, from a search to a saved-card payment (invariants 28 and 29).
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { sourceHash } from "../../scripts/widget-sources";
import {
  addCall,
  type BagView,
  bagView,
  catalogView,
  checkoutCall,
  payCall,
  quantityCall,
  searchCall,
  variantFor,
} from "../widgets/logic";
import { handle } from "./api";
import { grants } from "./oauth";
import { recentTrace } from "./trace";
import { freshStore, MCP, ORIGIN, randomIp, TestAgent } from "./testing/agent";
import { fake } from "./testing/fake-adyen";
import { BAG, CAROUSEL, MCP_APP_MIME } from "./widgets";
import { SOURCE_HASH } from "./widgets.gen";

let agent: TestAgent;
beforeAll(async () => {
  agent = await TestAgent.start("Widget host");
});
afterAll(() => agent.stop());
beforeEach(() => {
  freshStore();
  agent.ip = randomIp();
});

const rpc = async (method: string, params: Record<string, unknown> = {}) =>
  (await agent.mcp(method, params)).body;
const run = async (call: { name: string; arguments: Record<string, unknown> }) =>
  (await agent.tool(call.name, call.arguments)).content;

describe("the UI resources", () => {
  test("the built widgets match their sources: run `bun run widgets` after a change", () => {
    expect(SOURCE_HASH).toBe(sourceHash());
  });

  test("initialize announces resources and prompts, and serves both v2 widgets and v1 aliases", async () => {
    await agent.signIn();
    const init = await rpc("initialize", { protocolVersion: "2025-11-25" });
    expect(init.result.capabilities.resources).toEqual({ listChanged: false });
    expect(init.result.capabilities.prompts).toEqual({ listChanged: false });
    expect(init.result.instructions).toContain("search_catalog");
    const { resources } = (await rpc("resources/list")).result;
    expect(resources.map((r: { uri: string }) => r.uri)).toEqual([CAROUSEL, BAG]);
    expect(CAROUSEL).toContain("-v2.html");
    expect(BAG).toContain("-v2.html");
    for (const r of resources) {
      expect(r.mimeType).toBe(MCP_APP_MIME);
      expect(r._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [ORIGIN] });
      expect(r._meta["openai/widgetCSP"]).toEqual({
        connect_domains: [],
        resource_domains: [ORIGIN],
        redirect_domains: [ORIGIN],
      });
    }
    expect((await rpc("resources/templates/list")).result).toEqual({ resourceTemplates: [] });
    const legacy = await rpc("resources/read", { uri: "ui://widget/cart-checkout.html" });
    expect(legacy.result.contents[0]).toMatchObject({
      uri: "ui://widget/cart-checkout.html",
      mimeType: MCP_APP_MIME,
    });
    expect(legacy.result.contents[0].text).toContain('<body data-view="bag">');

    const listedPrompts = await rpc("prompts/list");
    expect(listedPrompts.result.prompts.map((p: { name: string }) => p.name)).toEqual([
      "personal-stylist",
    ]);
    const prompt = await rpc("prompts/get", { name: "personal-stylist" });
    expect(prompt.result.messages[0].content.text).toContain("Personal stylist for Atelier Velune");
    expect(prompt.result.messages[0].content.text).not.toStartWith("---");
    const badPrompt = await rpc("prompts/get", { name: "other" });
    expect(badPrompt.error.code).toBe(-32602);
  });

  test("each widget is one self-contained document that loads nothing from anywhere", async () => {
    await agent.signIn();
    for (const [uri, view] of [
      [CAROUSEL, "catalog"],
      [BAG, "bag"],
    ]) {
      const [doc] = (await rpc("resources/read", { uri })).result.contents;
      expect(doc).toMatchObject({ uri, mimeType: MCP_APP_MIME });
      const html: string = doc.text;
      expect(html).toContain(`<body data-view="${view}">`);
      expect(html).toContain(`<meta name="store-origin" content="${ORIGIN}">`);
      expect(html).not.toMatch(/<script[^>]+src=/i);
      expect(html).not.toMatch(/<link\b/i);
      expect(html).not.toMatch(/@import|url\(\s*["']?https?:/i);
      expect(html.match(/<\/script>/gi)).toHaveLength(1);
      // A host frame sandboxed without allow-forms drops a form's submit event: no form at all.
      expect(html).not.toMatch(/<form\b|["']form["']/i);
    }
  });

  test("an unknown URI is -32002, and the trace keeps a widget's size, not its text", async () => {
    await agent.signIn();
    const missing = await rpc("resources/read", { uri: "ui://widget/other.html" });
    expect(missing.error.code).toBe(-32002);
    await rpc("resources/read", { uri: BAG });
    const read = recentTrace().find((t) => t.path === BAG);
    const detail = JSON.stringify(read?.detail);
    expect(detail).toContain('"bytes"');
    expect(detail).not.toContain("<!doctype");
  });

  test("the resources answer only where tools/list does", async () => {
    const response = await handle(
      new Request(MCP, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": randomIp() },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/list" }),
      }),
    );
    expect(response.status).toBe(401);
    // A signed-out PAP agent with a verified Session lists them, as it lists the tools.
    agent.accessToken = "";
    agent.delegation = await agent.makeDelegation();
    const session = await agent.mcp("resources/list");
    expect(session.status).toBe(200);
    expect(session.body.result.resources).toHaveLength(2);
  });
});

describe("the tools that name them", () => {
  test("catalogue tools name the carousel, cart and checkout tools the bag, others none", async () => {
    await agent.signIn();
    const { tools } = (await rpc("tools/list")).result;
    const ui = Object.fromEntries(
      tools.map((t: { name: string; _meta?: Record<string, any> }) => [
        t.name,
        t._meta?.ui?.resourceUri,
      ]),
    );
    expect(ui).toEqual({
      search_catalog: CAROUSEL,
      lookup_catalog: undefined,
      get_product: CAROUSEL,
      create_cart: BAG,
      get_cart: BAG,
      update_cart: BAG,
      cancel_cart: undefined,
      create_checkout: BAG,
      get_checkout: BAG,
      update_checkout: BAG,
      complete_checkout: BAG,
      cancel_checkout: undefined,
      get_order: undefined,
    });
    for (const t of tools.filter((t: { _meta?: unknown }) => t._meta)) {
      expect(t._meta["openai/outputTemplate"]).toBe(t._meta.ui.resourceUri);
      expect(t._meta.ui.visibility).toEqual(["model", "app"]);
      expect(t._meta["openai/widgetAccessible"]).toBe(true);
      expect(t._meta["openai/toolInvocation/invoking"].length).toBeLessThanOrEqual(64);
    }
  });

  test("paying is destructive and open-world, cancelling destructive, reading neither", async () => {
    await agent.signIn();
    const { tools } = (await rpc("tools/list")).result;
    const hints = (name: string) =>
      tools.find((t: { name: string }) => t.name === name).annotations;
    expect(hints("complete_checkout")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    expect(hints("cancel_checkout").destructiveHint).toBe(true);
    expect(hints("cancel_cart").destructiveHint).toBe(true);
    expect(hints("search_catalog")).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(hints("create_cart").destructiveHint).toBe(false);
  });
});

describe("the widget's own requests against the store", () => {
  test("by hand: search, add twice, change a quantity, check out, pay once with the saved card", async () => {
    await agent.signIn();
    const catalog = catalogView(await run(searchCall("socks")));
    const socks = catalog!.products[0]!;
    const one = variantFor(socks, {})!;
    const first = bagView(await run(addCall(undefined, one.id))) as BagView;
    expect(first).toMatchObject({ kind: "cart", lines: [{ variantId: one.id, quantity: 1 }] });
    const second = bagView(await run(addCall(first, one.id))) as BagView;
    expect(second.id).toBe(first.id);
    expect(second.lines[0]!.quantity).toBe(2);
    const fewer = bagView(await run(quantityCall(second, one.id, 1)!)) as BagView;
    expect(fewer.lines[0]!.quantity).toBe(1);

    const open = bagView(await run(checkoutCall(fewer.id))) as BagView;
    expect(open).toMatchObject({ kind: "checkout", status: "ready_for_complete" });
    expect(open.continueUrl).toStartWith(ORIGIN);
    const card = open.instruments[0]!;
    expect(card.label).toContain("1111");

    const key = crypto.randomUUID();
    const paid = bagView(await run(payCall(open, card.id, key)!)) as BagView;
    expect(paid.status).toBe("completed");
    expect(paid.order?.url).toStartWith(`${ORIGIN}/orders/`);
    // A retry of the same attempt, as after a lost answer, pays nothing more.
    await run(payCall(open, card.id, key)!);
    expect(fake.payments).toHaveLength(1);
    expect(grants()[0]!.spent).toBe(paid.total);
  });

  test("by hand: an add from the carousel to an open checkout extends it, and it stays payable", async () => {
    await agent.signIn();
    const socks = catalogView(await run(searchCall("socks")))!.products[0]!;
    const cart = bagView(await run(addCall(undefined, variantFor(socks, {})!.id))) as BagView;
    const open = bagView(await run(checkoutCall(cart.id))) as BagView;
    const beanie = catalogView(await run(searchCall("beanie")))!.products[0]!;
    const more = bagView(await run(addCall(open, variantFor(beanie, {})!.id))) as BagView;
    expect(more).toMatchObject({ kind: "checkout", id: open.id, status: "ready_for_complete" });
    expect(more.lines).toHaveLength(2);
    expect(more.total).toBeGreaterThan(open.total);
  });

  test("over the budget the widget offers the store's pages, and has nothing to pay with", async () => {
    await agent.signIn({ spendLimitEur: 50 });
    const catalog = catalogView(await run(searchCall("trench")));
    const trench = catalog!.products[0]!;
    const cart = bagView(await run(addCall(undefined, variantFor(trench, {})!.id))) as BagView;
    const open = bagView(await run(checkoutCall(cart.id))) as BagView;
    expect(open.status).toBe("requires_escalation");
    expect(open.codes).toContain("spend_limit_exceeded");
    expect(open.manageUrl).toStartWith(`${ORIGIN}/account#agent-`);
    expect(open.continueUrl).toStartWith(`${ORIGIN}/checkout/`);
    expect(payCall(open, open.instruments[0]?.id ?? "x", crypto.randomUUID())).toBeUndefined();
    expect(fake.payments).toHaveLength(0);
  });
});
