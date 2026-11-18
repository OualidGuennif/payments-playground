// The consent page speaks to a shopper: permissions in words with their pills, the PAP 1.0 §10.8
// warning, and a zero budget when the agent cannot pay.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CHANGE_PILL, asksToPay, consentRows } from "@/lib/consent";
import { type Scope, SCOPES } from "@/server/oauth";
import { ConsentForm, type ConsentProps } from "./ConsentForm";

const EMAIL = "shopper@example.com";
const ALL = Object.keys(SCOPES) as Scope[];
const CART: Scope[] = ["dev.ucp.shopping.cart:manage", "dev.ucp.shopping.checkout:manage"];

function render(scopes: Scope[], extra: Partial<ConsentProps> = {}) {
  const html = renderToStaticMarkup(
    <ConsentForm
      requestId="req_test"
      agentName="Test Agent"
      email={EMAIL}
      clientHost="agent.example"
      returnHost="agent.example"
      rows={consentRows(scopes)}
      asksToPay={asksToPay(scopes)}
      {...extra}
    />,
  );
  // What a shopper reads: no tags, no attribute values, entities decoded.
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  return { html, text };
}

describe("consent page", () => {
  test("names every permission in words with its pill and personal data mark, never a scope", () => {
    const { text } = render(ALL);
    for (const scope of ALL) {
      expect(text).toContain(SCOPES[scope].short);
      expect(text).toContain(CHANGE_PILL[SCOPES[scope].changes]);
      expect(text).not.toContain(scope);
    }
    const personal = ALL.filter((s) => SCOPES[s].personalData).length;
    expect(text.split("Personal data").length - 1).toBe(personal);
  });

  test("keeps the one-sentence warning and masks the account's email", () => {
    const { html, text } = render(CART);
    expect(text).toContain("Only allow if you just asked Test Agent to connect.");
    expect(text).toContain("Signed in as s•••@example.com");
    expect(html).not.toContain(EMAIL);
  });

  test("sends a zero budget when the agent cannot pay, and offers one when it can", () => {
    const noPay = render(CART).html;
    expect(noPay).toMatch(/<input type="hidden" name="spend_limit_eur" value="0"\/>/);
    expect(noPay).not.toContain('type="number"');

    const pay = render([...CART, "ucp:pay"]).html;
    expect(pay).not.toMatch(/type="hidden" name="spend_limit_eur"/);
    expect(pay).toMatch(/type="number"[^>]*name="spend_limit_eur"/);
    for (const amount of [50, 150, 300, 1000]) expect(pay).toContain(`€${amount}</button>`);
  });

  test("a device request says the agent picks up the answer, with nowhere to return to", () => {
    const { text } = render(CART, { returnHost: undefined });
    expect(text).toContain("the agent picks up your answer on its own");
    expect(text).not.toContain("you go back to");
  });
});
