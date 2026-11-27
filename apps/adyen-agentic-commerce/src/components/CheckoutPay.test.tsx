// A guest's checkout waits for an email in step 1: Delivery and Payment say so and offer nothing to
// act on, so no one reaches the payment form without one (owner's iPhone report, 2026-11-27).
// Spec: knowledge/components/agentic-storefront.md
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { checkoutView } from "@/server/api";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ replace() {}, push() {}, refresh() {}, back() {}, prefetch() {} }),
}));
const { CheckoutPay } = await import("./CheckoutPay");

type View = ReturnType<typeof checkoutView>;

function view(extra: Partial<View> = {}): View {
  return {
    id: "chk_test",
    phase: "open",
    status: "incomplete",
    messages: [
      {
        type: "error",
        code: "missing_buyer_email",
        content: "Add your email.",
        severity: "recoverable",
      },
    ],
    agentName: undefined,
    lines: [
      {
        id: "li_1",
        variantId: "v_1",
        title: "Wool coat",
        quantity: 1,
        unitPrice: 12_000,
        amount: 12_000,
      },
    ],
    gift: undefined,
    welcomeOffer: undefined,
    subtotal: 12_000,
    discount: 0,
    fulfillment: 0,
    total: 12_000,
    delivery: { method: "standard", placeId: "home-1" },
    buyer: undefined,
    signedIn: false,
    accountEmail: undefined,
    welcomeOfferAvailable: false,
    channel: "web",
    order: undefined,
    paymentsReady: true,
    ...extra,
  } as View;
}

// What a shopper reads: no tags, entities decoded.
const text = (v: View) =>
  renderToStaticMarkup(<CheckoutPay initial={v} />)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("checkout email gate", () => {
  test("a guest with no email sees step 1's button and steps 2 and 3 locked", () => {
    const html = renderToStaticMarkup(<CheckoutPay initial={view()} />);
    const read = text(view());
    expect(read).toContain(
      "Add your email to continue: sign in, create an account or continue as a guest.",
    );
    expect(read.match(/Add your email in step 1 first\./g)?.length).toBe(2);
    expect(html.match(/aria-disabled="true"/g)?.length).toBe(2);
    expect(read).not.toContain("Pay €");
    expect(read).not.toContain("Test cards");
  });

  test("a checkout with its email unlocks Delivery and Payment", () => {
    const read = text(
      view({
        status: "ready_for_complete",
        messages: [],
        buyer: { email: "guest@example.com" },
      } as Partial<View>),
    );
    expect(read).toContain("Receipt to guest@example.com");
    expect(read).not.toContain("Add your email in step 1 first.");
    expect(read).toContain("Delivery");
  });
});
