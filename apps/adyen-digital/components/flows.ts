/** The checkout flows, in the order the home page shows them. */
export type Flow = "sessions" | "advanced" | "api-only" | "pay-by-link" | "mit";

export interface FlowInfo {
  id: Flow;
  /** Card title on the home page. */
  label: string;
  /** Name in the checkout page's flow badge. */
  title: string;
  description: string;
  /** Group on the home page. */
  group: "checkout" | "beyond";
  /** Drop-in or a single Component can be chosen. */
  hasIntegration: boolean;
  recommended?: boolean;
}

export const FLOWS: FlowInfo[] = [
  {
    id: "sessions",
    label: "Sessions Flow",
    title: "Sessions",
    description: "One /sessions call; Adyen Web runs the payment, 3DS included.",
    group: "checkout",
    hasIntegration: true,
    recommended: true,
  },
  {
    id: "advanced",
    label: "Advanced Flow",
    title: "Advanced",
    description: "Your server calls /paymentMethods, /payments and /payments/details.",
    group: "checkout",
    hasIntegration: true,
  },
  {
    id: "api-only",
    label: "API only",
    title: "API only",
    description: "Your own card form; Adyen secured fields encrypt the card data.",
    group: "checkout",
    hasIntegration: false,
  },
  {
    id: "pay-by-link",
    label: "Pay by Link",
    title: "Pay by Link",
    description: "Create an Adyen-hosted payment page and share its link.",
    group: "beyond",
    hasIntegration: false,
  },
  {
    id: "mit",
    label: "Merchant-initiated",
    title: "Merchant-initiated",
    description: "Charge a saved card without the shopper, with a stored payment method.",
    group: "beyond",
    hasIntegration: false,
  },
];

export function flowInfo(flow: Flow): FlowInfo {
  return FLOWS.find((item) => item.id === flow) ?? FLOWS[0];
}

export function isFlow(value: string): value is Flow {
  return FLOWS.some((item) => item.id === value);
}
