// The Docs render on the server with every step as text, and Try it reaches only this origin's
// public documents and MCP tools/list.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import DocPage from "../../app/docs/[topic]/page";
import Docs from "../../app/docs/page";
import { logFilters } from "../../server/back-office/back-office";
import { DOCS, OVERVIEW, PUBLIC_DOCUMENTS, type Step } from "./content";
import { DEMO, GLOSSARY, OVERVIEW_PLAIN, PLAIN } from "./plain";
import { send } from "./TryIt";

// What a reader sees: no tags, entities decoded, backticks gone the way Rich renders them.
const visible = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const plain = (text: string) => text.replaceAll("`", "");

function expectSteps(html: string, steps: Step[]) {
  const text = visible(html);
  for (const step of steps) {
    expect(text).toContain(step.label);
    expect(text).toContain(plain(step.text));
  }
  // The diagram draws each step once, numbered, and its text list holds each step once more.
  expect(html.match(/<li>/g)?.length ?? 0).toBeGreaterThanOrEqual(steps.length);
}

describe("Docs", () => {
  test("every topic page renders on the server with all its steps as text", async () => {
    for (const doc of DOCS) {
      const html = renderToStaticMarkup(
        await DocPage({ params: Promise.resolve({ topic: doc.slug }) }),
      );
      expectSteps(html, doc.steps);
      expect(html).toContain("<svg");
      for (const channel of doc.channels)
        expect(html).toContain(`/back-office?tab=log&amp;channel=${channel}`);
    }
  });

  test("the overview page renders the whole purchase as text", () => {
    expectSteps(renderToStaticMarkup(Docs()), OVERVIEW.steps);
  });

  test("every diagram has plain words before it and what to remember after it", async () => {
    for (const doc of DOCS) {
      const words = PLAIN[doc.slug];
      if (!words) throw new Error(`no plain words for ${doc.slug}`);
      expect(words.plain.length).toBeGreaterThan(0);
      expect(words.remember.length).toBeGreaterThan(1);
      const html = renderToStaticMarkup(
        await DocPage({ params: Promise.resolve({ topic: doc.slug }) }),
      );
      const before = html.indexOf("In plain words");
      const diagram = html.indexOf("<svg");
      const after = html.indexOf("What to remember");
      expect(before).toBeGreaterThan(-1);
      expect(before).toBeLessThan(diagram);
      expect(after).toBeGreaterThan(diagram);
      for (const line of [...words.plain, ...words.remember])
        expect(visible(html)).toContain(plain(line));
    }
    const overview = visible(renderToStaticMarkup(Docs()));
    for (const line of [...OVERVIEW_PLAIN.plain, ...OVERVIEW_PLAIN.remember])
      expect(overview).toContain(plain(line));
    for (const [term] of GLOSSARY) expect(overview).toContain(term);
    expect(Object.keys(PLAIN).sort()).toEqual(DOCS.map((d) => d.slug).sort());
  });

  test("the ten-minute demo shows every stop, takes ten minutes and links only here", () => {
    const overview = visible(renderToStaticMarkup(Docs()));
    expect(DEMO.reduce((sum, stop) => sum + stop.minutes, 0)).toBe(10);
    for (const stop of DEMO) {
      expect(overview).toContain(stop.title);
      expect(overview).toContain(plain(stop.act));
      expect(overview).toContain(stop.see);
      expect(stop.href).toMatch(/^\/(?!\/)/);
    }
  });

  test("the plain words use no dashes as punctuation", () => {
    const all = [
      ...OVERVIEW_PLAIN.plain,
      ...OVERVIEW_PLAIN.remember,
      ...DEMO.flatMap((stop) => [stop.title, stop.act, stop.see]),
      ...Object.values(PLAIN).flatMap((p) => [...p.plain, ...p.remember]),
    ];
    for (const line of all) expect(line).not.toMatch(/[\u2013\u2014]| -- /);
  });

  test("every step joins two different actors of its diagram", () => {
    for (const { actors, steps } of [OVERVIEW, ...DOCS]) {
      const ids = actors.map((a) => a.id);
      for (const s of steps) {
        expect(ids).toContain(s.from);
        expect(ids).toContain(s.to);
        expect(s.from).not.toBe(s.to);
      }
    }
  });

  test("every Back Office log link a page offers is a channel the Log filters by", () => {
    for (const doc of DOCS)
      for (const channel of doc.channels) expect(logFilters({ channel }).channel).toBe(channel);
  });

  test("Try it asks only for this origin's public documents or MCP tools/list", () => {
    for (const request of DOCS.flatMap((d) => d.tries)) {
      expect(request.path.startsWith("/")).toBe(true);
      expect(request.path.startsWith("//")).toBe(false);
      if (request.method === "GET")
        expect(PUBLIC_DOCUMENTS as readonly string[]).toContain(request.path);
      else {
        expect(request.method).toBe("POST");
        expect(request.path).toBe("/mcp");
        expect(request.body).toEqual({ method: "tools/list" });
      }
    }
  });
});

describe("Try it requests", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("go to a relative URL without cookies, and a POST carries only tools/list", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response("{}");
    }) as typeof fetch;
    for (const request of DOCS.flatMap((d) => d.tries)) await send(request);
    expect(seen.length).toBeGreaterThan(0);
    for (const { url, init } of seen) {
      expect(url.startsWith("/")).toBe(true);
      expect(init.credentials).toBe("omit");
      if (init.method === "POST")
        expect(JSON.parse(String(init.body))).toEqual({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        });
      else expect(init.body).toBeUndefined();
    }
  });
});
