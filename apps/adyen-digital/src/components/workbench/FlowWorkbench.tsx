"use client";
import { AdyenCheckout, Dropin } from "@adyen/adyen-web";
import type { Core } from "@adyen/adyen-web";
import { formatMinorAmount, unwrap } from "@suite/ui/client.ts";
import {
  currencyForCountry,
  defaultAmountForCurrency,
  localeForCountry,
} from "@suite/platform/markets.ts";
import { weeklyShopperReference } from "@suite/platform/shopper.ts";
import { INSTALLMENT_COUNTRIES, isNonFatalWalletError } from "@suite/ui/paymentMethods.ts";
import "@suite/ui/registerPaymentMethods.ts";
import { currentTheme, type Theme, THEME_CHANGE_EVENT } from "@suite/ui/theme.ts";
import { useEffect, useRef, useState } from "react";
import {
  type AdvancedRun,
  loadPaymentMethods,
  partialPaymentHandlers,
  paymentHandlers,
} from "../../checkout/advanced.ts";
import { mountCustomCard } from "../../checkout/api-only.ts";
import {
  api,
  type ComponentConstructor,
  field,
  type MountedComponent,
} from "../../checkout/client.ts";
import { type Flow, flowInfo } from "../../checkout/flows.ts";
import {
  type AvailableComponent,
  type Bootstrap,
  closesSession,
  detectInitialCountry,
  flagEmoji,
  MARKETS,
  minorExponent,
  recordSafe,
  type RecurringModel,
  SESSION_REFUSAL_LIMIT,
  type StoredMethod,
} from "../../checkout/flow-helpers.ts";
import { methodsConfiguration as createMethodsConfiguration } from "../../checkout/methods.ts";
import { chargeStoredMethod, listStoredMethods } from "../../checkout/mit.ts";
import { type OrderProgress, orderProgress } from "../../checkout/partial.ts";
import { createPaymentLink, readLinkState } from "../../checkout/pay-by-link.ts";
import {
  type CheckoutSettings,
  forgetSession,
  partPaidSession,
  readSavedSession,
  type SavedSession,
  sameSettings,
  saveSession,
  tabStore,
  withLatestSessionData,
} from "../../checkout/session-restore.ts";
import {
  createSession,
  reapplyRestoredOrder,
  sessionExpiry,
  sessionHandlers,
  useSessionKeptOnLeave,
} from "../../checkout/sessions.ts";
import { field as valueAt } from "../../lib/read.ts";
import { FlowInspector } from "../inspector/FlowInspector.tsx";
import type { TimelineEntry } from "../inspector/Timeline.tsx";
import { useTimelinePolling } from "../inspector/useTimeline.ts";
import { FlowIcon } from "./FlowIcon.tsx";
import { FlowSettings } from "./FlowSettings.tsx";
import { MitPanel } from "./MitPanel.tsx";
import { PayByLinkPanel } from "./PayByLinkPanel.tsx";
import { type PaymentOutcome, ResultCard } from "./ResultCard.tsx";
import { Sheet } from "./Sheet.tsx";
import { TestData } from "./TestData.tsx";

export type { Bootstrap };

export default function FlowWorkbench({
  flow,
  initialBootstrap,
  initialIntegration,
}: {
  flow: Flow;
  initialBootstrap?: Bootstrap;
  initialIntegration?: "dropin" | "component";
}) {
  const info = flowInfo(flow);
  const hasAutoInit = flow === "sessions" || flow === "advanced" || flow === "api-only";
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(initialBootstrap ?? null);
  const [profileId, setProfileId] = useState(initialBootstrap?.profile.id ?? "default");
  const [integration, setIntegration] = useState<"dropin" | "component">(
    initialIntegration ?? "dropin",
  );
  const [componentType, setComponentType] = useState("scheme");
  const [availableComponents, setAvailableComponents] = useState<AvailableComponent[]>([]);
  const [country, setCountry] = useState(() => detectInitialCountry(flow));
  const [currency, setCurrency] = useState(() => currencyForCountry(detectInitialCountry(flow)));
  const [amount, setAmount] = useState(() =>
    defaultAmountForCurrency(currencyForCountry(detectInitialCountry(flow))),
  );
  const [locale, setLocale] = useState(() => localeForCountry(detectInitialCountry(flow)));
  const [theme, setTheme] = useState<Theme>(() => currentTheme());
  // Whether installments are offered is a property of the market, not a
  // manual preference: always derived from the country.
  const installments = INSTALLMENT_COUNTRIES.includes(country.toUpperCase());
  // Off sends nativeThreeDS "disabled": the 3DS2 challenge becomes a redirect
  // to the issuer's page. Sessions and Advanced only.
  const hasThreeDSChoice = flow === "sessions" || flow === "advanced";
  const [nativeThreeDS, setNativeThreeDS] = useState(true);
  // A payment split across methods (a gift card, then a card). Adyen Web
  // keeps the order itself and only reports it through onOrderUpdated.
  const [partialOrder, setPartialOrder] = useState<OrderProgress | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  // The Advanced flow mints a new correlation id at /payments, so keeping only
  // the current one made the /paymentMethods call vanish from the inspector
  // the moment a payment was submitted. Every id of the run is polled.
  const [correlationIds, setCorrelationIds] = useState<string[]>([]);
  const [callbacks, setCallbacks] = useState<TimelineEntry[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  // Open from the start (owner, 2026-10-10): watching Adyen's events is what
  // this playground is for.
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [testDataOpen, setTestDataOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  const [link, setLink] = useState<Record<string, unknown> | null>(null);
  const [linkState, setLinkState] = useState<string | null>(null);
  const [storedMethods, setStoredMethods] = useState<StoredMethod[] | null>(null);
  const [storedPaymentMethodId, setStoredPaymentMethodId] = useState("");
  const [shopperReference, setShopperReference] = useState(() => weeklyShopperReference());
  const [recurringModel, setRecurringModel] = useState<RecurringModel>("UnscheduledCardOnFile");
  const [validityHours, setValidityHours] = useState(24);
  const [reusable, setReusable] = useState(false);
  const [amountDraft, setAmountDraft] = useState<string | null>(null);
  // Adyen Web renders into this node with its own Preact copy, so it is kept
  // apart from anything React renders here: the placeholder is a sibling.
  const dropinHost = useRef<HTMLDivElement>(null);
  const [checkoutMounted, setCheckoutMounted] = useState(false);
  const mounted = useRef<MountedComponent | null>(null);
  // Bumped by every start(). A settings change can restart the checkout while
  // the previous run still awaits the network; only the latest run may mount.
  const runRef = useRef(0);
  const correlationRef = useRef<string | null>(null);
  const checkoutRef = useRef<Core | null>(null);
  const customCardHolderNameRef = useRef<HTMLInputElement | null>(null);
  // The last payment response the server returned, for the result screen.
  const lastPaymentRef = useRef<PaymentOutcome>({});
  // Minted by /paymentMethods and repeated on the /payments call it leads to,
  // so Adyen sees both requests as one checkout conversion.
  const shopperConversionRef = useRef<string | null>(null);
  // Advanced flow, partial payments: this server's order that every payment
  // of the split goes into, what is left on it, and the balance of the gift
  // card being used, which caps what that payment may charge.
  const partialOrderIdRef = useRef<string | null>(null);
  // The current Sessions session, and when it stops accepting payments.
  const sessionIdRef = useRef<string | null>(null);
  const sessionExpiresAtRef = useRef<number | null>(null);
  const sessionRefusalsRef = useRef(0);
  const sessionClosedRef = useRef(false);
  const remainingRef = useRef<number | null>(null);
  const giftCardBalanceRef = useRef<number | null>(null);
  const inspectorBody = useRef<HTMLDivElement>(null);
  const followEvents = useRef(true);

  const amountText = formatMinorAmount(Number.isFinite(amount) ? amount : 0, currency);
  const exponent = minorExponent(currency);
  const countryName = MARKETS.find(([code]) => code === country)?.[1] ?? country;
  const selectedProfile = bootstrap?.profiles.find((profile) => profile.id === profileId);

  function updateCorrelation(value: string) {
    correlationRef.current = value;
    setCorrelationId(value);
    setCorrelationIds((current) => (current.includes(value) ? current : [...current, value]));
  }

  function currentSettings(): CheckoutSettings {
    return { profileId, integration, country, currency, amount, locale, nativeThreeDS };
  }

  function applySettings(settings: CheckoutSettings) {
    setIntegration(settings.integration);
    setCountry(settings.country);
    setCurrency(settings.currency);
    setAmount(settings.amount);
    setLocale(settings.locale);
    setNativeThreeDS(settings.nativeThreeDS);
    setAmountDraft(null);
  }

  useEffect(() => {
    api()
      .api.bootstrap.get()
      .then((result) => unwrap(result) as Bootstrap)
      .then((data) => {
        setBootstrap(data);
        setProfileId(data.profile.id);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Bootstrap failed."));
    const syncTheme = () => setTheme(currentTheme());
    globalThis.addEventListener(THEME_CHANGE_EVENT, syncTheme);
    return () => {
      globalThis.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
      mounted.current?.unmount();
    };
  }, []);

  const autoInitRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: starts once when bootstrap arrives; hasAutoInit is fixed per page and start is rebuilt every render.
  useEffect(() => {
    if (!hasAutoInit || autoInitRef.current || !bootstrap?.clientKey) return;
    autoInitRef.current = true;
    // A reload in the middle of a split payment: take back the settings the
    // session was made with, and let the restart that change causes resume
    // it. Another profile's session cannot be resumed with this client key.
    const saved = flow === "sessions" ? readSavedSession(tabStore(), Date.now()) : null;
    if (
      saved &&
      saved.settings.profileId === bootstrap.profile.id &&
      !sameSettings(saved.settings, currentSettings())
    ) {
      applySettings(saved.settings);
      skipFirstAutoRestart.current = false;
      setLoading(true);
      return;
    }
    start();
  }, [bootstrap]);

  useSessionKeptOnLeave(flow === "sessions", checkoutRef, sessionIdRef);

  // No "Update" button: any change to the scenario reloads the checkout on
  // its own, debounced so typing an amount doesn't refire on every keystroke.
  // The theme is part of it: secured fields only take their colours at mount.
  const skipFirstAutoRestart = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list is the scenario whose change reloads the checkout; start is rebuilt every render.
  useEffect(() => {
    if (!hasAutoInit || !autoInitRef.current) return;
    if (skipFirstAutoRestart.current) {
      skipFirstAutoRestart.current = false;
      return;
    }
    const timeout = setTimeout(() => start(), 500);
    return () => clearTimeout(timeout);
  }, [amount, currency, country, locale, integration, profileId, theme, nativeThreeDS]);

  // MIT charges a card saved earlier: list the ones Adyen holds for this
  // week's shopper, instead of asking for a token by hand.
  // biome-ignore lint/correctness/useExhaustiveDependencies: flow is fixed per page, and the amount or locale does not change which cards Adyen stores.
  useEffect(() => {
    if (flow !== "mit" || !bootstrap?.clientKey) return;
    setStoredMethods(null);
    listStoredMethods({ profileId, amount, currency, country, locale })
      .then((methods) => {
        setStoredMethods(methods);
        setStoredPaymentMethodId((current) => current || methods[0]?.id || "");
      })
      .catch(() => setStoredMethods([]));
  }, [bootstrap, country, currency, profileId]);

  useTimelinePolling(correlationIds, inspectorOpen, setTimeline);

  async function switchProfile(nextId: string) {
    setError(null);
    unwrap(await api().api.profiles.preferred.post({ profileId: nextId }));
    const data = unwrap(await api().api.bootstrap.get()) as Bootstrap;
    setBootstrap(data);
    setProfileId(data.profile.id);
    mounted.current?.unmount();
    mounted.current = null;
    checkoutRef.current = null;
    setAvailableComponents([]);
  }

  function selectMarket(nextCountry: string) {
    setCountry(nextCountry);
    setLocale(localeForCountry(nextCountry));
    const nextCurrency = currencyForCountry(nextCountry);
    if (nextCurrency !== currency) setAmount(defaultAmountForCurrency(nextCurrency));
    setCurrency(nextCurrency);
    setAmountDraft(null);
  }

  function selectCurrency(nextCurrency: string) {
    setAmount(defaultAmountForCurrency(nextCurrency));
    setCurrency(nextCurrency);
    setAmountDraft(null);
  }

  // Shoppers think in euros, the API in minor units: the field takes the
  // former and the hint shows the latter.
  function updateAmount(text: string) {
    setAmountDraft(text);
    const parsed = Number(text.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setAmount(Math.round(parsed * 10 ** exponent));
  }

  function addCallback(name: string, payload: unknown, explicitCorrelation?: string) {
    const safePayload = recordSafe(payload);
    const entry: TimelineEntry = {
      id: crypto.randomUUID(),
      kind: "frontend_callback",
      name,
      status: "received",
      occurredAt: new Date().toISOString(),
      payload: safePayload,
    };
    setCallbacks((current) => [...current, entry]);
    // The ref, not the state: Adyen Web keeps the handlers of the render that
    // created the checkout, whose state still holds the previous run's id.
    const id = explicitCorrelation ?? correlationRef.current;
    if (id) {
      api(profileId)
        .api.callbacks.post({
          correlationId: id,
          name,
          occurredAt: entry.occurredAt,
          payload: safePayload,
        })
        .then((result) => unwrap(result))
        .catch(() => undefined);
    }
  }

  function finish(result: unknown) {
    setOutcome({
      ...lastPaymentRef.current,
      resultCode:
        field(result, "resultCode") ??
        (closesSession(result) ? "Error" : lastPaymentRef.current.resultCode),
    });
  }

  function resetPartialOrder() {
    setPartialOrder(null);
    partialOrderIdRef.current = null;
    remainingRef.current = null;
    giftCardBalanceRef.current = null;
  }

  // A refusal into a part-paid order moves the session on: the next restore
  // needs the sessionData of that answer, not the one before it.
  function keepLatestSessionData(answer: unknown) {
    if (flow !== "sessions") return;
    const store = tabStore();
    const saved = readSavedSession(store, Date.now());
    if (saved && saved.sessionId === sessionIdRef.current) {
      saveSession(store, withLatestSessionData(saved, answer));
    }
  }

  function commonConfiguration(extra: Record<string, unknown>) {
    if (!bootstrap?.clientKey) throw new Error("A valid TEST client key is required.");
    return {
      environment: "test",
      clientKey: bootstrap.clientKey,
      countryCode: country,
      locale,
      analytics: { enabled: false },
      showPayButton: true,
      onChange: (state: unknown) => addCallback("onChange", state),
      onPaymentCompleted: (result: unknown) => {
        addCallback("onPaymentCompleted", result);
        if (flow === "sessions") forgetSession(tabStore());
        finish(result);
      },
      onPaymentFailed: (result: unknown) => {
        addCallback("onPaymentFailed", result);
        if (field(result, "resultCode") === "Refused") sessionRefusalsRef.current += 1;
        if (closesSession(result)) {
          sessionClosedRef.current = true;
          forgetSession(tabStore());
        } else {
          keepLatestSessionData(result);
        }
        finish(result);
      },
      // Part of the order is paid. Adyen Web has already applied the order to
      // the checkout, so a component mounted now charges only what is left.
      // A merchant shows that and, with Components, mounts the next method:
      // left alone, the gift card form just empties.
      onOrderUpdated: (data: unknown) => {
        addCallback("onOrderUpdated", data);
        const progress = orderProgress(valueAt(data, "order"));
        setPartialOrder(progress);
        remainingRef.current = progress?.remaining ?? null;
        giftCardBalanceRef.current = null;
        // Sessions only: kept so a reload resumes this order, not a new one.
        const partPaid = partPaidSession(data, {
          sessionId: sessionIdRef.current,
          expiresAt: sessionExpiresAtRef.current,
          correlationId: correlationRef.current,
          progress,
          settings: currentSettings(),
        });
        if (flow === "sessions" && partPaid) saveSession(tabStore(), partPaid);
        const methods = (checkoutRef.current?.paymentMethodsResponse?.paymentMethods ??
          []) as AvailableComponent[];
        if (integration === "component" && methods.some((method) => method.type === "scheme")) {
          mountComponentType("scheme");
        }
      },
      onError: (cause: unknown) => {
        addCallback("onError", cause);
        if (isNonFatalWalletError(cause)) return;
        // onPaymentFailed reports it too, with a way out; no second banner.
        if (closesSession(cause)) {
          sessionClosedRef.current = true;
          forgetSession(tabStore());
          return;
        }
        setError(cause instanceof Error ? cause.message : "Adyen Web reported an error.");
      },
      ...extra,
    };
  }

  function methodsConfiguration(): Record<string, unknown> {
    return createMethodsConfiguration({
      country,
      merchantAccount: bootstrap?.profile.merchantAccount,
      storeDetails: flow !== "sessions",
      theme,
      addCallback: (name, payload) => addCallback(name, payload),
    });
  }

  function mountComponentType(type: string) {
    const checkout = checkoutRef.current;
    if (!checkout || !dropinHost.current) return;
    try {
      const ComponentClass = checkout.getComponent(type) as ComponentConstructor | undefined;
      if (!ComponentClass) {
        setError(`No "${type}" component is available in this payment methods response.`);
        return;
      }
      mounted.current?.unmount();
      dropinHost.current.replaceChildren();
      const config = methodsConfiguration()[type] as Record<string, unknown> | undefined;
      // Card/PayPal/etc. have dedicated classes whose static `type` is already
      // correct, but every redirect-only method (Alma, Wero, WeChat...) shares
      // the same generic Redirect element: without an explicit `type` here it
      // mounts with no identifiable payment method, `state.data.paymentMethod`
      // comes back empty and the backend later rejects it as null.
      const instance = new ComponentClass(checkout, { ...config, type });
      instance.mount(dropinHost.current);
      mounted.current = instance;
      setCheckoutMounted(true);
      setComponentType(type);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not mount "${type}".`);
    }
  }

  function mountDropin(checkout: Core) {
    if (!dropinHost.current) return;
    const component = new Dropin(checkout, {
      paymentMethodsConfiguration: methodsConfiguration(),
      openFirstPaymentMethod: false,
      instantPaymentTypes: ["applepay", "googlepay"],
    });
    component.mount(dropinHost.current);
    mounted.current = component as MountedComponent;
    setCheckoutMounted(true);
  }

  // A refusal ends an attempt, not the checkout. The AdyenCheckout instance
  // still holds the session, with the sessionData of its last answer, and any
  // order a gift card opened: remounting on it lets the shopper try again
  // without losing what was paid. Starting over (a new session) would leave
  // that order to expire. An expired session can only be replaced.
  function retryNeedsNewSession(): boolean {
    if (flow !== "sessions") return false;
    const expired =
      sessionExpiresAtRef.current !== null && Date.now() >= sessionExpiresAtRef.current;
    return (
      expired || sessionClosedRef.current || sessionRefusalsRef.current >= SESSION_REFUSAL_LIMIT
    );
  }

  function retry() {
    const checkout = checkoutRef.current;
    if (!checkout || !dropinHost.current || flow === "api-only" || retryNeedsNewSession()) {
      if (retryNeedsNewSession()) forgetSession(tabStore());
      start();
      return;
    }
    setOutcome(null);
    setError(null);
    lastPaymentRef.current = {};
    mounted.current?.unmount();
    dropinHost.current.replaceChildren();
    if (integration === "dropin") mountDropin(checkout);
    else mountComponentType(componentType);
  }

  async function mountCheckout(
    configuration: Record<string, unknown>,
    stale: () => boolean,
    prepare?: (checkout: Core) => Promise<void>,
  ) {
    const checkout = (await AdyenCheckout(configuration as never)) as Core;
    await prepare?.(checkout);
    // A newer run owns the host now; mounting this one too would stack two
    // checkouts in it. The previous checkout stays up until then.
    if (stale() || !dropinHost.current) return;
    mounted.current?.unmount();
    dropinHost.current.replaceChildren();
    checkoutRef.current = checkout;

    if (flow === "api-only") {
      const custom = mountCustomCard(checkout, dropinHost.current, { theme, amountText });
      customCardHolderNameRef.current = custom.holderName;
      mounted.current = custom.component;
      setCheckoutMounted(true);
      return;
    }

    const methods = (checkout.paymentMethodsResponse?.paymentMethods ?? []) as AvailableComponent[];
    setAvailableComponents(methods.map((method) => ({ type: method.type, name: method.name })));

    if (integration === "dropin") {
      mountDropin(checkout);
      return;
    }

    const nextType = methods.some((method) => method.type === componentType)
      ? componentType
      : (methods[0]?.type ?? "scheme");
    mountComponentType(nextType);
  }

  function sessionConfiguration(
    correlationId: string,
    session: { id: string; sessionData: string },
  ): Record<string, unknown> {
    return commonConfiguration({ session, ...sessionHandlers(correlationId, addCallback) });
  }

  // The part-paid session kept before a reload, mounted again from its latest
  // sessionData, with the order its setup answer carries applied again.
  async function resumeSession(saved: SavedSession, stale: () => boolean) {
    updateCorrelation(saved.correlationId);
    sessionIdRef.current = saved.sessionId;
    sessionExpiresAtRef.current = saved.expiresAt;
    setPartialOrder(saved.progress);
    remainingRef.current = saved.progress?.remaining ?? null;
    await mountCheckout(
      sessionConfiguration(saved.correlationId, {
        id: saved.sessionId,
        sessionData: saved.sessionData,
      }),
      stale,
      async (checkout) => {
        const progress = await reapplyRestoredOrder(checkout);
        setPartialOrder(progress);
        remainingRef.current = progress?.remaining ?? null;
      },
    );
  }

  async function startSession(stale: () => boolean) {
    const store = tabStore();
    const saved = readSavedSession(store, Date.now());
    if (saved && sameSettings(saved.settings, currentSettings())) {
      try {
        await resumeSession(saved, stale);
        return;
      } catch {
        // Adyen no longer takes that session (closed, expired, unknown): its
        // order is left to expire and the shopper starts a new checkout.
        forgetSession(store);
        if (stale()) return;
        setError(null);
        resetPartialOrder();
      }
    } else if (saved) {
      // Other settings mean another checkout; the part-paid one is left.
      forgetSession(store);
    }
    const data = await createSession({
      profileId,
      integration,
      amount,
      currency,
      country,
      locale,
      installments,
      nativeThreeDS,
    });
    if (stale()) return;
    updateCorrelation(data.correlationId);
    sessionIdRef.current = data.session.id;
    sessionExpiresAtRef.current = sessionExpiry(data.session);
    await mountCheckout(sessionConfiguration(data.correlationId, data.session), stale);
  }

  function advancedRun(): AdvancedRun {
    return {
      flow: flow === "api-only" ? "api-only" : "advanced",
      integration,
      profileId,
      amount,
      currency,
      country,
      locale,
      nativeThreeDS,
      refs: {
        correlation: correlationRef,
        shopperConversion: shopperConversionRef,
        partialOrderId: partialOrderIdRef,
        remaining: remainingRef,
        giftCardBalance: giftCardBalanceRef,
        customCardHolderName: customCardHolderNameRef,
        lastPayment: lastPaymentRef,
      },
      addCallback: (name, payload) => addCallback(name, payload),
      updateCorrelation,
      resetPartialOrder,
      setError,
    };
  }

  async function startAdvanced(stale: () => boolean) {
    const run = advancedRun();
    const methods = await loadPaymentMethods(run);
    if (stale()) return;
    updateCorrelation(methods.correlationId);
    shopperConversionRef.current = methods.shopperConversionId;
    const configuration = commonConfiguration({
      amount: { value: amount, currency },
      paymentMethodsResponse: methods.paymentMethodsResponse,
      ...paymentHandlers(run),
      ...(flow === "advanced" ? partialPaymentHandlers(run) : {}),
    });
    await mountCheckout(configuration, stale);
  }

  async function startPaymentLink() {
    const response = await createPaymentLink({
      profileId,
      amount,
      currency,
      country,
      locale,
      validityHours,
      reusable,
    });
    updateCorrelation(response.correlationId);
    setLink(response.paymentLink);
    setLinkState(field(response.paymentLink, "status") ?? "active");
  }

  async function refreshLink() {
    if (!correlationRef.current) return;
    setLoading(true);
    try {
      setLinkState(await readLinkState(profileId, correlationRef.current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the link.");
    } finally {
      setLoading(false);
    }
  }

  async function runMit() {
    const response = await chargeStoredMethod({
      profileId,
      amount,
      currency,
      storedPaymentMethodId,
      shopperReference,
      recurringModel,
    });
    updateCorrelation(response.correlationId);
    const stored = storedMethods?.find((method) => method.id === storedPaymentMethodId);
    setOutcome({
      resultCode: field(response.result, "resultCode"),
      pspReference: field(response.result, "pspReference"),
      method: stored?.brand ?? stored?.name,
    });
  }

  // "New payment": a part-paid order is left behind on purpose, not resumed.
  function startOver() {
    if (flow === "sessions") forgetSession(tabStore());
    start();
  }

  async function start() {
    setError(null);
    setOutcome(null);
    setCallbacks([]);
    setTimeline([]);
    setCorrelationIds([]);
    lastPaymentRef.current = {};
    // A conversion id belongs to one checkout; the next one mints its own.
    shopperConversionRef.current = null;
    sessionIdRef.current = null;
    sessionExpiresAtRef.current = null;
    sessionRefusalsRef.current = 0;
    sessionClosedRef.current = false;
    resetPartialOrder();
    const run = ++runRef.current;
    const stale = () => run !== runRef.current;
    setLoading(true);
    try {
      if (flow === "sessions") await startSession(stale);
      else if (flow === "advanced" || flow === "api-only") await startAdvanced(stale);
      else if (flow === "pay-by-link") await startPaymentLink();
      else await runMit();
    } catch (cause) {
      if (!stale()) setError(cause instanceof Error ? cause.message : "The flow could not start.");
    } finally {
      if (!stale()) setLoading(false);
    }
  }

  // One list for the inspector: Adyen Web callbacks as they happen, plus what
  // the server recorded (API calls, webhooks). The server's copy of each
  // callback is left out, it is the same event.
  const events = [
    ...callbacks,
    ...timeline.filter((entry) => entry.kind !== "frontend_callback"),
  ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const names = new Set(events.map((entry) => entry.name));

  // Follow new events like a console does, unless the reader scrolled up to
  // look at an earlier one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new event or reopening the inspector is what scrolls it to the end.
  useEffect(() => {
    const body = inspectorBody.current;
    if (body && followEvents.current) body.scrollTop = body.scrollHeight;
  }, [events.length, inspectorOpen]);
  const steps: Array<[string, boolean]> = [
    [
      "Checkout ready",
      events.some(
        (entry) =>
          entry.kind === "api_call" &&
          (entry.name.endsWith("/sessions") || entry.name.includes("paymentMethods")),
      ),
    ],
    ["Submitted", names.has("onSubmit") || names.has("beforeSubmit")],
    ["Result", Boolean(outcome)],
    ["Webhook", events.some((entry) => entry.kind === "webhook")],
  ];

  function renderPayment() {
    if (flow === "pay-by-link") {
      return (
        <PayByLinkPanel
          link={link}
          linkState={linkState}
          amountText={amountText}
          correlationId={correlationId}
          validityHours={validityHours}
          onValidityHours={setValidityHours}
          reusable={reusable}
          onReusable={setReusable}
          loading={loading}
          canCreate={Boolean(selectedProfile?.isConfigured)}
          onCreate={start}
          onRefresh={refreshLink}
          onAnother={() => setLink(null)}
        />
      );
    }

    if (flow === "mit") {
      if (outcome) {
        return (
          <ResultCard
            outcome={outcome}
            amountText={amountText}
            orderId={correlationId}
            onRestart={() => setOutcome(null)}
          />
        );
      }
      return (
        <MitPanel
          storedMethods={storedMethods}
          storedPaymentMethodId={storedPaymentMethodId}
          onStoredPaymentMethodId={setStoredPaymentMethodId}
          recurringModel={recurringModel}
          onRecurringModel={setRecurringModel}
          shopperReference={shopperReference}
          onShopperReference={setShopperReference}
          amountText={amountText}
          loading={loading}
          canCharge={Boolean(selectedProfile?.isConfigured)}
          onCharge={start}
        />
      );
    }

    return (
      <>
        {outcome ? (
          <ResultCard
            outcome={outcome}
            amountText={
              partialOrder && outcome.resultCode !== "Authorised"
                ? `${formatMinorAmount(partialOrder.remaining, partialOrder.currency)} left to pay`
                : amountText
            }
            orderId={correlationId}
            onRestart={startOver}
            onRetry={flow === "api-only" ? undefined : retry}
            retryStartsOver={retryNeedsNewSession()}
          />
        ) : null}
        {partialOrder && integration === "component" && !outcome ? (
          // Drop-in lists the paid gift card itself; a lone component shows
          // nothing, so the page says what is paid and what is left.
          <p className="partial-banner" role="status">
            <strong>Partial payment</strong>
            <span>
              {formatMinorAmount(partialOrder.paid, partialOrder.currency)} paid ·{" "}
              {formatMinorAmount(partialOrder.remaining, partialOrder.currency)} left to pay
            </span>
          </p>
        ) : null}
        <div className={`dropin-host${outcome ? " is-hidden" : ""}`} aria-live="polite">
          <div ref={dropinHost} />
          {!checkoutMounted ? (
            <div className="pay-skeleton" role="status" aria-label="Loading the checkout">
              <span />
              <span />
              <span />
            </div>
          ) : null}
        </div>
        {flow === "api-only" && !outcome ? (
          <p className="pay-note">
            Card details are typed into Adyen-hosted fields and reach this server encrypted; raw
            card numbers are refused.
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className={`checkout-page${inspectorOpen ? " is-inspecting" : ""}`}>
      <div className="scenario-bar">
        <div className="scenario-bar__start">
          <h1 className="flow-badge" title={info.description}>
            <FlowIcon name={flow} className="flow-badge__icon" size={18} />
            {info.title}
          </h1>
          <button
            className="scenario-chip"
            type="button"
            onClick={() => setConfigOpen(true)}
            aria-label="Change market, amount and integration"
          >
            <span className="scenario-chip__flag" aria-hidden="true">
              {flagEmoji(country)}
            </span>
            <span className="scenario-chip__text">
              <strong>{countryName}</strong>
              <span>
                {locale} · {amountText}
                {info.hasIntegration
                  ? ` · ${integration === "dropin" ? "Drop-in" : "Components"}`
                  : ""}
                {hasThreeDSChoice && !nativeThreeDS ? " · 3DS redirect" : ""}
              </span>
            </span>
            <span className="scenario-chip__edit">Edit</span>
          </button>
        </div>
        <div className="scenario-bar__actions">
          <button className="pill-button" type="button" onClick={() => setTestDataOpen(true)}>
            Test cards
          </button>
          <button
            className="pill-button"
            type="button"
            aria-pressed={inspectorOpen}
            onClick={() => setInspectorOpen(!inspectorOpen)}
          >
            Inspector
            {events.length ? <span className="pill-button__count">{events.length}</span> : null}
          </button>
        </div>
      </div>

      {bootstrap && !selectedProfile?.isConfigured ? (
        <div className="notice notice--warning" role="note">
          <div>
            <strong>This profile is incomplete</strong>
            <p>
              Missing: {selectedProfile?.missingFields.join(", ")}. Add them in{" "}
              <a href="/settings">Settings</a>.
            </p>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="notice notice--danger" role="alert">
          <div>
            <strong>Something went wrong</strong>
            <p>{error}</p>
          </div>
          {hasAutoInit ? (
            <button
              className="button button--secondary button--small"
              type="button"
              onClick={start}
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={`checkout-workspace${inspectorOpen ? " has-inspector" : ""}`}>
        <div className="checkout-card">
          <section className="checkout-pay" aria-busy={loading}>
            <div className="checkout-pay__head">
              <h2>{flow === "pay-by-link" ? "Payment link" : "Payment"}</h2>
              {integration === "component" &&
              info.hasIntegration &&
              availableComponents.length > 0 ? (
                <select
                  className="compact-select"
                  aria-label="Payment method component"
                  value={componentType}
                  onChange={(event) => mountComponentType(event.currentTarget.value)}
                >
                  {availableComponents.map((method) => (
                    <option key={method.type} value={method.type}>
                      {method.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            {renderPayment()}
          </section>
        </div>

        {inspectorOpen ? (
          <FlowInspector
            entries={events}
            steps={steps}
            correlationId={correlationId}
            body={inspectorBody}
            follow={followEvents}
            onClose={() => setInspectorOpen(false)}
          />
        ) : null}
      </div>

      <FlowSettings
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        country={country}
        locale={locale}
        currency={currency}
        amount={amount}
        amountDraft={amountDraft}
        exponent={exponent}
        integration={integration}
        hasIntegration={info.hasIntegration}
        hasThreeDSChoice={hasThreeDSChoice}
        nativeThreeDS={nativeThreeDS}
        profileId={profileId}
        profiles={bootstrap?.profiles ?? []}
        onMarket={selectMarket}
        onLocale={setLocale}
        onCurrency={selectCurrency}
        onAmount={updateAmount}
        onAmountBlur={() => setAmountDraft(null)}
        onIntegration={setIntegration}
        onNativeThreeDS={setNativeThreeDS}
        onProfile={switchProfile}
      />

      <Sheet
        open={testDataOpen}
        title="Test cards"
        subtitle="Adyen TEST credentials. Tap to copy."
        onClose={() => setTestDataOpen(false)}
      >
        <TestData />
      </Sheet>
    </div>
  );
}
