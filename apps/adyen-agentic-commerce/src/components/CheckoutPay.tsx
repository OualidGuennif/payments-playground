// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { checkoutView } from "@/server/api";
import { DeliveryPicker } from "@/components/DeliveryPicker";
import { DropinPanel, type SessionInfo } from "@/components/DropinPanel";
import { FreeShippingGauge } from "@/components/FreeShippingGauge";
import { PayIdentityModal, type PayResolved } from "@/components/PayIdentityModal";
import { StatusPill } from "@/components/StatusPill";
import { TestCardList } from "@/components/TestCardList";
import { api, BAG_EVENT, type BagChange } from "@/lib/client";
import { type Delivery, METHODS, placesFor, placeText } from "@/lib/delivery";
import { money } from "@/lib/money";
import { seasonFor } from "@/lib/seasons";
import { shopperWords } from "@/lib/shopper-words";

type View = ReturnType<typeof checkoutView>;

const UPDATED = "Your bag was updated, here or in the chat. Check the new total, then pay.";
const NOTICE_KEY = "velune-checkout-notice";
function reloadWith(why?: string) {
  try {
    if (why) sessionStorage.setItem(NOTICE_KEY, why);
  } catch {
    /* private mode: reload without the notice */
  }
  window.location.reload();
}
const linesKey = (lines: { variantId: string; quantity: number }[]) =>
  lines.map((l) => `${l.variantId}×${l.quantity}`).join(",");

export function CheckoutPay({
  initial,
  clientKey,
  redirect,
}: {
  initial: View;
  clientKey?: string;
  redirect?: { sessionId: string; redirectResult: string };
}) {
  const [view, setView] = useState(initial);
  const [pendingRedirect, setPendingRedirect] = useState(redirect);
  const [error, setError] = useState<string>();

  const createSession = useCallback(async (): Promise<SessionInfo> => {
    const { data, error } = await api().checkouts({ id: view.id }).session.post();
    if (error || !data || "error" in data) throw new Error("The payment form could not be loaded.");
    return data as SessionInfo;
  }, [view.id]);

  const [notice, setNotice] = useState<string>();
  // A notice carried over the reload that gave Drop-in its new session.
  useEffect(() => {
    try {
      const carried = sessionStorage.getItem(NOTICE_KEY);
      sessionStorage.removeItem(NOTICE_KEY);
      if (carried) setNotice(carried);
    } catch {
      /* private mode: no notice to carry */
    }
  }, []);
  // Set once this page's own payment is under way: nothing may remount the form until it ends.
  const [payingHere, setPayingHere] = useState(false);
  const shown = useRef(view);
  // A view whose lines or total moved reloads the page: Drop-in's session was priced from the old
  // bag, and a second AdyenCheckout instance on one page leaves its Pay button dead.
  const show = useCallback((next: View, why?: string) => {
    const before = shown.current;
    shown.current = next;
    if (before.total !== next.total || linesKey(before.lines) !== linesKey(next.lines)) {
      reloadWith(why);
      return;
    }
    setView(next);
  }, []);
  const refresh = useCallback(
    async (why?: string) => {
      const { data } = await api().checkouts({ id: view.id }).get();
      if (data && !("error" in data)) show(data, why);
    },
    [view.id, show],
  );

  // The page follows the checkout while it can still change or is being paid elsewhere: every 4 s
  // while visible, and at once when the Ask panel says the bag changed.
  const live = view.phase === "open" || view.phase === "complete_in_progress";
  useEffect(() => {
    if (!live || payingHere || pendingRedirect) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(UPDATED);
    }, 4_000);
    return () => clearInterval(timer);
  }, [live, payingHere, pendingRedirect, refresh]);

  useEffect(() => {
    const onBag = (event: Event) => {
      const change = (event as CustomEvent<BagChange>).detail;
      const current = shown.current;
      if (!change || payingHere) return;
      if (change.checkoutId === current.id) {
        void refresh(UPDATED);
        return;
      }
      // A checkout made on the site takes the shopper's one bag; an agent's follows its agent.
      if (current.channel !== "web" || current.phase !== "open" || change.paid) return;
      if (!change.lines.length || linesKey(change.lines) === linesKey(current.lines)) return;
      void api()
        .checkouts({ id: current.id })
        .lines.post({ lines: change.lines })
        .then(({ data }) => {
          if (data && !("error" in data)) show(data, UPDATED);
        });
    };
    window.addEventListener(BAG_EVENT, onBag);
    return () => window.removeEventListener(BAG_EVENT, onBag);
  }, [payingHere, refresh, show]);

  // The checkout is held for this form's payment before Drop-in sends it: a payment already
  // running (another tab, or the assistant in the chat) or a bag changed since the form opened
  // stops it here, in words.
  const beforePay = useCallback(
    async (sessionId: string) => {
      const { data, error } = await api()
        .checkouts({ id: view.id })
        ["pay-intent"].post({ sessionId });
      if (!error && data && !("error" in data)) {
        setPayingHere(true);
        setNotice(undefined);
        return undefined;
      }
      const code = (error?.value as { code?: unknown } | undefined)?.code;
      if (code === "checkout_changed") {
        const why =
          "Your bag changed while the payment form was open. Check the new total, then pay.";
        reloadWith(why);
        return why;
      }
      return shopperWords(code === "payment_in_progress" ? code : "payment_unavailable");
    },
    [view.id],
  );

  const onFinished = useCallback(
    async (sessionId: string, sessionResult: string) => {
      if (window.location.search) window.history.replaceState(null, "", `/checkout/${view.id}`);
      const { data, error } = await api()
        .checkouts({ id: view.id })
        ["session-result"].post({ sessionId, sessionResult });
      setPendingRedirect(undefined);
      setPayingHere(false);
      if (error || !data || "error" in data) {
        setError("Adyen has not confirmed the payment yet. Refresh in a moment.");
        return;
      }
      show(data);
    },
    [view.id, show],
  );

  const [savingEmail, setSavingEmail] = useState(false);
  const paymentRef = useRef<HTMLDivElement>(null);
  const [openForm, setOpenForm] = useState(false);
  // A checkout made from the bag, or one an agent handed over as a guest, may lack only the
  // receipt's email: Pay asks for it in the Pay email modal (ADR-020).
  const needsEmailOnly =
    view.phase === "open" &&
    view.status === "incomplete" &&
    view.messages.length > 0 &&
    view.messages.every((m) => m.code === "missing_buyer_email");
  const [payModal, setPayModal] = useState(false);

  // Saves the account's email on the receipt once; answers the refusal in words.
  const postEmail = useCallback(
    async (address: string): Promise<string | undefined> => {
      setSavingEmail(true);
      const { data, error } = await api().checkouts({ id: view.id }).email.post({ email: address });
      setSavingEmail(false);
      if (error || !data || "error" in data) {
        const value = error?.value as { error?: unknown } | undefined;
        return typeof value?.error === "string" ? value.error : shopperWords("invalid_email");
      }
      setError(undefined);
      show(data);
      return undefined;
    },
    [view.id, show],
  );
  // The modal resolved before any card form was on the page, so the new view (the account's
  // checkout, maybe with the welcome offer, or a guest's email) shows without a reload; then the
  // card form opens and comes into view.
  const resolved = ({ data }: PayResolved) => {
    setPayModal(false);
    const next = data as View & { welcomeOfferApplied?: boolean };
    shown.current = next;
    setView(next);
    setError(undefined);
    setNotice(
      next.welcomeOfferApplied
        ? "Welcome offer applied: 5% off and your tote are in the summary."
        : undefined,
    );
    setOpenForm(true);
  };
  // A signed-in owner with no order yet asks for the welcome offer in one tap. A card form already
  // priced from the old total reloads with the new one.
  const [applying, setApplying] = useState(false);
  const applyOffer = async () => {
    setApplying(true);
    const { data, error } = await api()
      .checkouts({ id: view.id })
      .claim.post({ applyWelcomeOffer: true });
    setApplying(false);
    if (error || !data || "error" in data) {
      const value = error?.value as { error?: unknown } | undefined;
      setError(typeof value?.error === "string" ? value.error : shopperWords("invalid_request"));
      return;
    }
    const claimed = data as View & { welcomeOfferApplied?: boolean };
    const why = claimed.welcomeOfferApplied
      ? "Welcome offer applied. Check the new total, then pay."
      : "The welcome offer is for a first order only.";
    show(claimed, why);
    setNotice(why);
  };
  const season = seasonFor();
  // A signed-in shopper is never asked for an email the store already knows: the account's goes on
  // the receipt at once, and the field shows only when that fails.
  const autoEmail = useRef(false);
  const accountEmail = view.signedIn ? view.accountEmail : undefined;
  useEffect(() => {
    if (!needsEmailOnly || !accountEmail || !view.paymentsReady || autoEmail.current) return;
    autoEmail.current = true;
    void postEmail(accountEmail).then((refused) => refused && setError(refused));
  }, [needsEmailOnly, accountEmail, view.paymentsReady, postEmail]);
  const receiptTo = view.buyer?.email ?? accountEmail;
  const askEmail = needsEmailOnly && view.paymentsReady && !accountEmail;

  const [savingDelivery, setSavingDelivery] = useState(false);
  const chooseDelivery = async (next: Delivery) => {
    const before = view.delivery;
    setView({ ...view, delivery: next });
    setSavingDelivery(true);
    const { data, error } = await api().checkouts({ id: view.id }).delivery.post(next);
    setSavingDelivery(false);
    if (error || !data || "error" in data) {
      setView((current) => ({ ...current, delivery: before }));
      const value = error?.value as { error?: unknown } | undefined;
      setError(typeof value?.error === "string" ? value.error : shopperWords("invalid_delivery"));
      return;
    }
    setError(undefined);
    show(data, "Delivery updated. Check the new total, then pay.");
  };
  const deliveryOpen =
    view.phase === "open" &&
    !payingHere &&
    !pendingRedirect &&
    view.status !== "complete_in_progress" &&
    view.status !== "canceled";

  const payable =
    view.phase === "open" &&
    view.status !== "incomplete" &&
    view.status !== "canceled" &&
    view.status !== "complete_in_progress" &&
    view.paymentsReady;
  // Back from a 3-D Secure redirect, the form finishes its own payment even though it holds the
  // checkout.
  const showForm =
    view.phase === "open" && view.paymentsReady && (payable || pendingRedirect || payingHere);
  // The card form that opened after the email was saved comes into view.
  useEffect(() => {
    if (!openForm || !showForm) return;
    setOpenForm(false);
    const smooth = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    paymentRef.current?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  }, [openForm, showForm]);

  const method = METHODS.find((m) => m.id === view.delivery.method);
  const place = placesFor(view.delivery.method).find((p) => p.id === view.delivery.placeId);
  const messages = view.messages.filter(
    (m) => m.code !== "missing_buyer_email" || (!receiptTo && !askEmail),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl">Checkout</h1>
        <StatusPill status={view.status} />
      </div>
      {view.agentName && view.phase === "open" ? (
        <p className="panel text-sm">
          <strong>{view.agentName}</strong> prepared this checkout for you. Review it and pay below,
          or close this page to decline.
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem] lg:items-start lg:gap-10">
        <aside
          aria-label="Order summary"
          className="panel space-y-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1"
        >
          <h2 className="eyebrow">Order summary</h2>
          <ul className="divide-y divide-line text-sm">
            {view.lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
                <img
                  src={`/api/art/${l.variantId}.svg`}
                  alt=""
                  width={48}
                  height={60}
                  className="aspect-[4/5] w-12 shrink-0 rounded-lg border border-line object-cover"
                />
                <span className="min-w-0 flex-1">
                  {l.title} <span className="text-muted">× {l.quantity}</span>
                </span>
                <span className="tabular-nums">{money(l.amount)}</span>
              </li>
            ))}
            {view.gift ? (
              <li className="flex items-center gap-3 py-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
                <img
                  src={view.gift.image}
                  alt=""
                  width={48}
                  height={60}
                  className="aspect-[4/5] w-12 shrink-0 rounded-lg border border-line object-cover"
                />
                <span className="min-w-0 flex-1">
                  {view.gift.title} <span className="text-muted">× 1</span>
                </span>
                <span className="text-ok">Free</span>
              </li>
            ) : null}
          </ul>
          <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{money(view.subtotal)}</dd>
            </div>
            {view.discount > 0 ? (
              <div className="flex justify-between text-ok">
                <dt>Welcome offer (-5%)</dt>
                <dd className="tabular-nums">-{money(view.discount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt>{method ? `${method.label} delivery` : "Delivery"}</dt>
              <dd className="tabular-nums">
                {view.fulfillment ? money(view.fulfillment) : "Free"}
              </dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-medium">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(view.total)}</dd>
            </div>
          </dl>
          {deliveryOpen && view.delivery.method === "standard" && view.fulfillment ? (
            <FreeShippingGauge subtotal={view.subtotal} />
          ) : null}
        </aside>
        <div className="space-y-5 lg:col-start-1 lg:row-start-1">
          <Step n={1} title="Contact">
            {receiptTo ? (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                Receipt to <span className="font-medium">{receiptTo}</span>
                {accountEmail && receiptTo === accountEmail ? (
                  <span className="pill border-line text-muted">Your account</span>
                ) : null}
              </p>
            ) : askEmail ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 text-sm">
                  Guest or account: we ask for your email when you pay.
                </p>
                <button
                  type="button"
                  className="btn-ghost min-h-10 px-4 py-1.5"
                  onClick={() => setPayModal(true)}
                >
                  Add email now
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted">The receipt goes to the email on the order.</p>
            )}
            {view.welcomeOfferAvailable && !view.order ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
                <img
                  src={season.giftImage}
                  alt=""
                  width={40}
                  height={50}
                  className="aspect-[4/5] w-10 shrink-0 rounded-lg border border-line object-cover"
                />
                <p className="min-w-0 flex-1">
                  Your first order: 5% off and the {season.giftTitle}, free.
                </p>
                <button
                  type="button"
                  className="btn min-h-10 px-4 py-1.5"
                  disabled={applying || payingHere || Boolean(pendingRedirect)}
                  onClick={() => void applyOffer()}
                >
                  {applying ? "Applying…" : "Apply welcome offer"}
                </button>
              </div>
            ) : null}
          </Step>
          <Step n={2} title="Delivery">
            {deliveryOpen ? (
              <DeliveryPicker
                value={view.delivery}
                subtotal={view.subtotal}
                disabled={savingDelivery}
                onChange={(next) => void chooseDelivery(next)}
                quietLegend
              />
            ) : (
              <p className="text-sm">
                {method?.label ?? "Delivery"}
                {place ? <span className="text-muted"> · {placeText(place)}</span> : null}
              </p>
            )}
          </Step>
          <Step n={3} title="Payment">
            <div ref={paymentRef} className="scroll-mt-24 space-y-4">
              {view.order ? (
                <div className="space-y-3">
                  <p className="font-serif text-2xl">Thank you, your order is in.</p>
                  <p className="text-sm text-muted">
                    Payment {view.order.status}. Adyen reference{" "}
                    <span className="code">{view.order.pspReference ?? "pending"}</span>
                  </p>
                  <Link href={`/orders/${view.order.id}`} className="btn">
                    View the order
                  </Link>
                </div>
              ) : view.phase === "complete_in_progress" ? (
                <p className="text-sm">
                  Adyen is still processing this payment. The order appears as soon as Adyen
                  confirms it.
                </p>
              ) : showForm ? (
                <>
                  <DropinPanel
                    beforePay={beforePay}
                    label="Pay on Adyen TEST"
                    clientKey={clientKey}
                    createSession={createSession}
                    onFinished={onFinished}
                    redirect={pendingRedirect}
                  />
                  <TestCardList />
                </>
              ) : askEmail ? (
                <>
                  <button
                    type="button"
                    className="btn w-full"
                    disabled={savingEmail}
                    onClick={() => setPayModal(true)}
                  >
                    {`Pay ${money(view.total)}`}
                  </button>
                  <p className="text-xs text-muted">
                    Your email first, then the card form opens here. Adyen TEST: no real money
                    moves.
                  </p>
                  <TestCardList />
                </>
              ) : (
                <p className="text-sm text-muted">
                  {!view.paymentsReady
                    ? "Payments are switched off on this server."
                    : view.status === "complete_in_progress"
                      ? shopperWords("payment_in_progress")
                      : view.status === "canceled"
                        ? shopperWords("checkout_canceled")
                        : shopperWords("checkout_not_payable")}
                </p>
              )}
              {messages.map((m) => (
                <p key={m.code} className="text-sm text-warn">
                  {m.content}
                </p>
              ))}
              {notice ? (
                <p role="status" className="text-sm text-muted">
                  {notice}
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-bad">
                  {error}
                </p>
              ) : null}
            </div>
          </Step>
        </div>
      </div>
      {payModal && askEmail ? (
        <PayIdentityModal
          checkoutId={view.id}
          source="checkout"
          subtotal={view.subtotal}
          total={view.total}
          onClose={() => setPayModal(false)}
          onResolved={resolved}
        />
      ) : null}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = `checkout-step-${n}`;
  return (
    <section aria-labelledby={id} className="panel space-y-4">
      <h2 id={id} className="flex items-center gap-3 text-xl">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-ink font-sans text-xs font-semibold text-paper"
        >
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
