// Spec: knowledge/components/adyen-agentic-commerce.md
// The consent page's permission rows: the shopper's words and PAP 1.0 §4.7's two hints, never the
// scope name an agent asked with.
import { allows, type Scope, SCOPES } from "@/server/oauth/oauth";

export type Change = "none" | "reversible" | "irreversible";

export const CHANGE_PILL: Record<Change, string> = {
  none: "Read only",
  reversible: "Can be undone",
  irreversible: "Can't be undone",
};

export type ConsentRow = { scope: Scope; text: string; change: Change; personal: boolean };

export const consentRows = (scopes: Scope[]): ConsentRow[] =>
  scopes.map((scope) => ({
    scope,
    text: SCOPES[scope].short,
    change: SCOPES[scope].changes,
    personal: SCOPES[scope].personalData,
  }));

export const asksToPay = (scopes: Scope[]) => scopes.some((s) => allows([s], "ucp:pay"));
