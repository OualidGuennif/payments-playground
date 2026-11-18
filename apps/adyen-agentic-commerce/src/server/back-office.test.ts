// The Back Office pages and filters on the server, and no email leaves it unmasked: it is public
// when the playground's basic auth is unset.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import BackOffice from "../app/back-office/page";
import { pageItems } from "../components/back-office/Pager";
import { handle } from "./api";
import { logFilters, pageParam, perParam, tracePage } from "./back-office";
import { put } from "./db";
import { freshStore } from "./testing/agent";
import { trace } from "./trace";

const EMAIL = "jane.doe@example.com";

function log(n: number, entry: Partial<Parameters<typeof trace>[0]> = {}) {
  for (let i = 0; i < n; i++)
    trace({
      channel: "mcp",
      actor: "Test agent",
      method: "POST",
      path: "/mcp",
      status: 200,
      ref: null,
      detail: {},
      ...entry,
    });
}

async function page(query: Record<string, string>) {
  return renderToStaticMarkup(await BackOffice({ searchParams: Promise.resolve(query) }));
}

beforeEach(() => freshStore());

describe("Back Office paging", () => {
  test("page and per come only from page and per, anything else reads as 1 and 25", () => {
    for (const raw of [undefined, "", "0", "-1", "1.5", "abc", "1e3", " 2", ["x"]])
      expect(pageParam(raw)).toBe(1);
    expect(pageParam("3")).toBe(3);
    expect(pageParam(["4", "5"])).toBe(4);
    for (const raw of [undefined, "10", "25.0", "1000", "-50", "abc"])
      expect(perParam(raw)).toBe(25);
    expect(perParam("50")).toBe(50);
    expect(perParam("100")).toBe(100);
  });

  test("a page holds per entries, newest first, and a page past the last shows the last", () => {
    log(60);
    const one = tracePage({}, 1, 25);
    expect(one.items).toHaveLength(25);
    expect(one).toMatchObject({ total: 60, pages: 3, page: 1, per: 25 });
    expect(one.items.at(0)?.id ?? 0).toBeGreaterThan(one.items.at(24)?.id ?? 0);
    const last = tracePage({}, 99, 25);
    expect(last).toMatchObject({ page: 3, pages: 3 });
    expect(last.items).toHaveLength(10);
    expect(tracePage({}, 1, 100).items).toHaveLength(60);
  });

  test("filters narrow the count and the page together", () => {
    log(30);
    log(7, { channel: "oauth", actor: "Other agent", path: "/oauth/token", status: 401 });
    log(3, { channel: "adyen", actor: "store", path: "/payments", status: 502, ref: "PAY_1" });
    expect(tracePage({ channel: "oauth" }, 1, 25)).toMatchObject({ total: 7, pages: 1 });
    expect(tracePage({ status: "4xx" }, 1, 25).items.every((t) => t.status === 401)).toBe(true);
    expect(tracePage({ status: "5xx" }, 1, 25).total).toBe(3);
    expect(tracePage({ actor: "Other agent" }, 1, 25).total).toBe(7);
    expect(tracePage({ path: "TOKEN" }, 1, 25).total).toBe(7);
    expect(tracePage({ ref: "PAY_1" }, 1, 25).total).toBe(3);
    expect(tracePage({ channel: "mcp", status: "2xx" }, 2, 25)).toMatchObject({
      total: 30,
      pages: 2,
      page: 2,
    });
    // A typed % is a character to find, not a pattern that matches everything.
    expect(tracePage({ path: "%" }, 1, 25).total).toBe(0);
  });

  test("a channel with a hyphen, as ucp-rest, filters like any other", () => {
    log(2, { channel: "ucp-rest", path: "/ucp/v1/checkout-sessions" });
    log(3);
    expect(logFilters({ channel: "ucp-rest" }).channel).toBe("ucp-rest");
    const page = tracePage(logFilters({ channel: "ucp-rest" }), 1, 25);
    expect(page.total).toBe(2);
    expect(page.items.every((t) => t.channel === "ucp-rest")).toBe(true);
  });

  test("unknown filter values are dropped", () => {
    expect(
      logFilters({ channel: "MCP; drop", status: "6xx", path: "  ", ref: "x".repeat(500) }),
    ).toEqual({
      channel: undefined,
      actor: undefined,
      status: undefined,
      path: undefined,
      ref: "x".repeat(100),
    });
  });

  test("the pager shows the first, the last and a window around the current page", () => {
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageItems(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageItems(20, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
  });

  test("the JSON view pages its trace with the same filters and keeps its fields", async () => {
    log(40, { channel: "oauth" });
    log(5);
    const res = await handle(
      new Request("http://localhost/api/back-office?channel=oauth&page=2&per=25"),
    );
    const body = await res.json();
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(["channel", "orders", "payments", "checkouts", "trace"]),
    );
    expect(body).toMatchObject({ page: 2, per: 25, trace_total: 40, trace_pages: 2 });
    expect(body.trace).toHaveLength(15);
    expect(body.trace.every((t: { channel: string }) => t.channel === "oauth")).toBe(true);
  });
});

describe("Back Office masking", () => {
  beforeEach(() => {
    put("customers", "cus_1", { id: "cus_1", email: EMAIL, name: "Jane", createdAt: "2026-11-18" });
    put("orders", "ord_1", {
      id: "ord_1",
      checkoutId: "chk_1",
      lines: [],
      subtotal: 1000,
      fulfillment: 0,
      total: 1000,
      currency: "EUR",
      buyer: { email: EMAIL, first_name: "Jane" },
      status: "authorised",
      paidBy: "agent",
      agentName: "Test agent",
      customerId: "cus_1",
      createdAt: "2026-11-18T10:00:00.000Z",
    });
    put("grants", "gr_1", {
      id: "gr_1",
      clientId: "https://agent.example/client",
      clientName: "Test agent",
      customerId: "cus_1",
      scopes: ["ucp:pay"],
      spendLimit: 15000,
      spent: 1000,
      revoked: false,
      createdAt: "2026-11-18T09:00:00.000Z",
    });
    log(1, { ref: "ord_1", actor: EMAIL, detail: { note: `receipt sent to ${EMAIL}` } });
    log(1, { ref: "chk_1", channel: "agent", path: "/ucp/checkout-sessions/chk_1/complete" });
  });

  test("no tab and no JSON answer shows an email unmasked", async () => {
    for (const tab of ["overview", "orders", "payments", "agents", "log", "webhooks"]) {
      const html = await page({ tab });
      expect(html).not.toContain(EMAIL);
    }
    const timeline = await page({ tab: "orders", order: "ord_1" });
    expect(timeline).not.toContain(EMAIL);
    expect(timeline).toContain("j•••@example.com");
    const json = await (await handle(new Request("http://localhost/api/back-office"))).text();
    expect(json).not.toContain(EMAIL);
    expect(json).toContain("j•••@example.com");
  });

  test("an order opens its timeline: the entries naming it or its checkout, oldest first", async () => {
    const html = await page({ tab: "orders", order: "ord_1" });
    const mcp = html.indexOf("POST /mcp");
    const complete = html.indexOf("/ucp/checkout-sessions/chk_1/complete");
    expect(mcp).toBeGreaterThan(-1);
    expect(complete).toBeGreaterThan(mcp);
  });

  test("an agent named with an email shows it masked, and the Log's masked actor still filters", async () => {
    put("grants", "gr_2", {
      id: "gr_2",
      clientId: "https://agent.example/client",
      clientName: `Agent of ${EMAIL}`,
      customerId: "cus_1",
      scopes: [],
      spendLimit: 0,
      spent: 0,
      revoked: false,
      createdAt: "2026-11-18T09:30:00.000Z",
    });
    const agents = await page({ tab: "agents" });
    expect(agents).not.toContain(EMAIL);
    expect(agents).toContain("Agent of j•••@example.com");
    const masked = "j•••@example.com";
    expect(tracePage(logFilters({ actor: masked }), 1, 25).total).toBe(1);
    const log = await page({ tab: "log", actor: masked });
    expect(log).not.toContain(EMAIL);
    expect(log).toContain("POST /mcp");
    expect(log).not.toContain("Nothing matches");
  });

  test("the agents tab names permissions in words, never as scopes", async () => {
    const html = await page({ tab: "agents" });
    expect(html).toContain("Pay with your saved card, up to your budget");
    expect(html).not.toContain("ucp:pay");
    expect(html).toContain("€140.00 left");
  });
});
