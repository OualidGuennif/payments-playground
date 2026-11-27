// Spec: knowledge/components/adyen-digital.md
// Sessions: this server creates the session, Adyen Web makes every other call itself.
import type { Core } from "@adyen/adyen-web";
import { unwrap } from "@suite/ui/client.ts";
import { type RefObject, useEffect } from "react";
import { api, type CallbackActions } from "./client.ts";
import { type OrderProgress, orderProgress } from "./partial.ts";
import { pollRenewal, type RenewalWait } from "./session-renewal.ts";
import {
  forgetSession,
  readSavedSession,
  refreshedSession,
  saveSession,
  tabStore,
} from "./session-restore.ts";

export interface NewSession {
  correlationId: string;
  session: { id: string; sessionData: string; expiresAt?: string };
}

export async function createSession(input: {
  profileId: string;
  integration: "dropin" | "component";
  amount: number;
  currency: string;
  country: string;
  locale: string;
  installments: boolean;
  nativeThreeDS: boolean;
}): Promise<NewSession> {
  return unwrap(
    await api(input.profileId).api.digital.sessions.post({
      flow: `sessions-${input.integration}`,
      amount: { value: input.amount, currency: input.currency },
      countryCode: input.country,
      shopperLocale: input.locale,
      installments: input.installments,
      nativeThreeDS: input.nativeThreeDS,
    }),
  ) as NewSession;
}

/**
 * A new session on the same order, once the server has Adyen's word that the current one is spent
 * (ADR-022). The amount is the order's: the browser sends only the shopper's settings.
 */
export async function renewSession(
  input: {
    profileId: string;
    orderId: string;
    integration: "dropin" | "component";
    country: string;
    locale: string;
    installments: boolean;
    nativeThreeDS: boolean;
  },
  onWait: (wait: RenewalWait) => void,
  stale: () => boolean,
): Promise<NewSession | null> {
  return pollRenewal<NewSession>({
    ask: async () =>
      unwrap(
        await api(input.profileId)
          .api.digital.orders({ id: input.orderId })
          .sessions.post({
            flow: `sessions-${input.integration}`,
            countryCode: input.country,
            shopperLocale: input.locale,
            installments: input.installments,
            nativeThreeDS: input.nativeThreeDS,
          }),
      ) as NewSession | RenewalWait,
    onWait,
    stale,
  });
}

/** When the session stops taking payments, or null when Adyen did not say. */
export function sessionExpiry(session: NewSession["session"]): number | null {
  const expiresAt = session.expiresAt ? Date.parse(session.expiresAt) : Number.NaN;
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

export function sessionHandlers(
  correlationId: string,
  addCallback: (name: string, payload: unknown, correlationId?: string) => void,
): Record<string, unknown> {
  return {
    beforeSubmit: (state: unknown, _component: unknown, actions: CallbackActions) => {
      addCallback("beforeSubmit", state, correlationId);
      // beforeSubmit's resolve() is not a plain continue, Adyen Web sends
      // back whatever is passed here as the actual /payments payload. An
      // empty resolve() submits with no paymentMethod at all, which Adyen
      // then rejects as "Required field 'paymentMethod' is null".
      actions.resolve(state);
    },
  };
}

// A resumed session's setup answer carries the order, but Adyen Web 6.48.1
// prices the checkout before reading it (Pay showed the full amount), so the
// order is applied again, as Adyen Web itself does after a partial payment.
// Adyen's answer, not the saved copy, says what is left.
export async function reapplyRestoredOrder(checkout: Core): Promise<OrderProgress | null> {
  const order = checkout.options.order;
  const progress = orderProgress(order);
  if (order && progress) await checkout.update({ order });
  return progress;
}

// Drop-in's "Supprimer" cancels the order through the session and calls no
// merchant callback, so the sessionData kept at onOrderUpdated would still
// show the gift card as paid after a reload. Leaving the page re-reads what
// the live checkout holds: its latest sessionData and what is left.
export function useSessionKeptOnLeave(
  enabled: boolean,
  checkoutRef: RefObject<Core | null>,
  sessionIdRef: RefObject<string | null>,
) {
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      const checkout = checkoutRef.current;
      const sessionId = sessionIdRef.current;
      const store = tabStore();
      const saved = readSavedSession(store, Date.now());
      if (!checkout || !sessionId || !saved) return;
      const next = refreshedSession(saved, {
        sessionId,
        sessionData: checkout.session?.data,
        progress: orderProgress(checkout.options.order),
      });
      if (next) saveSession(store, next);
      else forgetSession(store);
    };
    globalThis.addEventListener("pagehide", refresh);
    return () => globalThis.removeEventListener("pagehide", refresh);
  }, [enabled, checkoutRef, sessionIdRef]);
}
