// Spec: knowledge/components/adyen-agentic-commerce.md
// The scopes an agent can ask for, what each one lets it do, and the check a route makes.

const SCOPE_NAMES = [
  "dev.ucp.shopping.cart:manage",
  "dev.ucp.shopping.checkout:manage",
  "ucp:pay",
  "dev.ucp.shopping.order:read",
  "profile",
  "ucp:checkout",
  "ucp:orders",
] as const;
export type Scope = (typeof SCOPE_NAMES)[number];

type ScopeInfo = {
  // What the consent page and the account page show the shopper.
  short: string;
  // The longer line agents read in poppy.json and the OpenAPI flows.
  label: string;
  // For agents only (PAP 1.0 §4.7): whether the task works without the scope.
  withoutIt: string;
  // PAP 1.0 §4.7 hints.
  changes: "none" | "reversible" | "irreversible";
  personalData: boolean;
  // A name from before the UCP names: accepted and honoured, never advertised.
  standsFor?: readonly Scope[];
};

// Personal data marks what an agent can see or change about the shopper: a checkout fills in and
// can change their delivery details; a cart holds only what the agent itself sends.
export const SCOPES: Record<Scope, ScopeInfo> = {
  "dev.ucp.shopping.cart:manage": {
    short: "Fill and edit your cart",
    label: "Create, update and cancel carts for you",
    withoutIt: "Signed out, an agent can still build a guest cart.",
    changes: "reversible",
    personalData: false,
  },
  "dev.ucp.shopping.checkout:manage": {
    short: "Check out with your delivery address",
    label: "Create, update and cancel checkouts for you, with your delivery details",
    withoutIt: "Signed out, an agent can still check out as a guest.",
    changes: "reversible",
    personalData: true,
  },
  "ucp:pay": {
    short: "Pay with your saved card, up to your budget",
    label: "Pay with your saved card, within the spend limit you set",
    withoutIt:
      "Only the saved card needs it: an agent's own network token, or the shopper at continue_url, pays without it.",
    changes: "irreversible",
    personalData: true,
  },
  "dev.ucp.shopping.order:read": {
    short: "See the orders it placed",
    label: "Read the orders it placed for you",
    withoutIt: "Every order read needs it.",
    changes: "none",
    personalData: true,
  },
  profile: {
    short: "See your name and email",
    label: "Read your name and email address",
    withoutIt: "Shopping works without it; orders then show no buyer.",
    changes: "none",
    personalData: true,
  },
  "ucp:checkout": {
    short: "Fill your cart and check out with your delivery address",
    label: "Create, update and cancel carts and checkouts for you, with your delivery details",
    withoutIt: "Signed out, an agent can still use guest carts and checkouts.",
    changes: "reversible",
    personalData: true,
    standsFor: ["dev.ucp.shopping.cart:manage", "dev.ucp.shopping.checkout:manage"],
  },
  "ucp:orders": {
    short: "See the orders it placed",
    label: "Read the orders it placed for you",
    withoutIt: "Every order read needs it.",
    changes: "none",
    personalData: true,
    standsFor: ["dev.ucp.shopping.order:read"],
  },
};
// The description agents read in poppy.json and the OpenAPI flows.
export const agentScopeDescription = (scope: Scope) =>
  `${SCOPES[scope].label}. ${SCOPES[scope].withoutIt}`;
export const isScope = (value: string): value is Scope =>
  (SCOPE_NAMES as readonly string[]).includes(value);
export const ADVERTISED_SCOPES: Scope[] = SCOPE_NAMES.filter((s) => !SCOPES[s].standsFor);
// What an agent gets when it asks for no scope: enough to build a checkout and pay.
export const DEFAULT_SCOPES: Scope[] = [
  "dev.ucp.shopping.cart:manage",
  "dev.ucp.shopping.checkout:manage",
  "ucp:pay",
];

// Whether the scopes a token carries cover `needed`, directly or through a legacy name.
export function allows(granted: readonly Scope[], needed: Scope): boolean {
  return granted.some((s) => s === needed || SCOPES[s].standsFor?.includes(needed));
}
