// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { checkoutView } from "@/server/api";
import { DeliveryPicker } from "@/components/DeliveryPicker";
import { DropinPanel, type SessionInfo } from "@/components/DropinPanel";
import { FreeShippingGauge } from "@/components/FreeShippingGauge";
import { shake } from "@/components/motion/GsapSheet";
import { StatusPill } from "@/components/StatusPill";
import { TestCardList } from "@/components/TestCardList";
import { api, BAG_EVENT, type BagChange } from "@/lib/client";
import { type Delivery, METHODS, placesFor, placeText } from "@/lib/delivery";
import { signInHere, useKnownAccount } from "@/lib/known";
import { money } from "@/lib/money";
import { shopperWords } from "@/lib/shopper-words";

type View = ReturnType<typeof checkoutView>;

// A shape check only; the server decides what it accepts and its refusal is shown on the field.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
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

  const [email, setEmail] = useState("");
  const known = useKnownAccount();
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailProblem, setEmailProblem] = useState<string>();
  const emailRef = useRef<HTMLInputElement>(null);
  const paymentRef = useRef<HTMLDivElement>(null);
  const [openForm, setOpenForm] = useState(false);
  // A checkout made from the bag, or one an agent handed over as a guest, may lack only the
  // receipt's email: it is asked for here, beside Pay.
  const needsEmailOnly =
    view.phase === "open" &&
    view.status === "incomplete" &&
    view.messages.length > 0 &&
    view.messages.every((m) => m.code === "missing_buyer_email");

  // Saves the receipt's email once; answers the refusal in words, or nothing when it was taken.
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
  // Pay with no email, or one that cannot be right, takes the shopper to the field: marked, in
  // view, focused and shaken (still under reduced motion). A valid one is saved and the card form
  // opens in its place.
  const flagEmail = (problem: string) => {
    setEmailProblem(problem);
    const field = emailRef.current;
    if (!field) return;
    const smooth = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    field.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    field.focus({ preventScroll: true });
    shake(field);
  };
  const payWithEmail = async (event?: FormEvent) => {
    event?.preventDefault();
    const address = email.trim();
    if (!address) return flagEmail("Enter the email for your receipt, then pay.");
    if (address.length > 254 || !EMAIL_SHAPE.test(address)) {
      return flagEmail("This email does not look right. Check it, then pay.");
    }
    const refused = await postEmail(address);
    if (refused) return flagEmail(refused);
    setEmailProblem(undefined);
    setOpenForm(true);
  };
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
          </ul>
          <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{money(view.subtotal)}</dd>
            </div>
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
              <form onSubmit={(event) => void payWithEmail(event)} noValidate className="space-y-2">
                {known && !view.signedIn ? (
                  <p className="text-sm">
                    Welcome back.{" "}
                    <a href={signInHere()} className="font-medium underline">
                      Sign in
                    </a>{" "}
                    to use your account&apos;s email, or type one below.
                  </p>
                ) : null}
                <label htmlFor="checkout-email" className="block text-sm text-muted">
                  Email for the receipt
                </label>
                <input
                  ref={emailRef}
                  id="checkout-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  maxLength={254}
                  aria-invalid={emailProblem ? true : undefined}
                  aria-describedby={emailProblem ? "checkout-email-problem" : undefined}
                  className="field min-h-11"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (emailProblem) setEmailProblem(undefined);
                  }}
                />
                {emailProblem ? (
                  <p id="checkout-email-problem" className="text-sm text-bad">
                    {emailProblem}
                  </p>
                ) : null}
              </form>
            ) : (
              <p className="text-sm text-muted">The receipt goes to the email on the order.</p>
            )}
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
                    onClick={() => void payWithEmail()}
                  >
                    {savingEmail ? "Saving your email…" : `Pay ${money(view.total)}`}
                  </button>
                  <p className="text-xs text-muted">
                    The card form opens here once your email is in. Adyen TEST: no real money moves.
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
