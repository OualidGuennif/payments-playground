"use client";
import { AdyenCheckout, CustomCard, Dropin } from "@adyen/adyen-web";
import type { Core } from "@adyen/adyen-web";
import { apiClient, formatMinorAmount, unwrap } from "@suite/ui/client.ts";
import { Field } from "@suite/ui/components.tsx";
import {
  currencyForCountry,
  defaultAmountForCurrency,
  localeForCountry,
} from "@suite/platform/markets.ts";
import { weeklyShopperReference } from "@suite/platform/shopper.ts";
import {
  INSTALLMENT_COUNTRIES,
  isNonFatalWalletError,
  paymentMethodsConfiguration,
} from "@suite/ui/paymentMethods.ts";
import "@suite/ui/registerPaymentMethods.ts";
import { currentTheme, type Theme, THEME_CHANGE_EVENT } from "@suite/ui/theme.ts";
import { useCopy } from "@suite/ui/useCopy.ts";
import { useEffect, useRef, useState } from "react";
import { type Flow, flowInfo } from "./flows.ts";
import {
  type AvailableComponent,
  type Bootstrap,
  closesSession,
  CUSTOM_CARD_MARKUP,
  detectInitialCountry,
  flagEmoji,
  MARKETS,
  minorExponent,
  recordSafe,
  type RecurringModel,
  securedFieldStyles,
  SESSION_REFUSAL_LIMIT,
  type StoredMethod,
  VALIDITY_OPTIONS,
} from "./flow-helpers.ts";
import { FlowIcon } from "./FlowIcon.tsx";
import { FlowInspector } from "./FlowInspector.tsx";
import { FlowSettings } from "./FlowSettings.tsx";
import { type OrderProgress, orderProgress, partialAmount } from "./partial.ts";
import { field as valueAt } from "./read.ts";
import { type PaymentOutcome, ResultCard } from "./ResultCard.tsx";
import {
  type CheckoutSettings,
  forgetSession,
  partPaidSession,
  readSavedSession,
  refreshedSession,
  type SavedSession,
  sameSettings,
  saveSession,
  tabStore,
  withLatestSessionData,
} from "./session-restore.ts";
import { Sheet } from "./Sheet.tsx";
import { TestData } from "./TestData.tsx";
import type { TimelineEntry } from "./Timeline.tsx";
import type { App } from "@/server/api";

export type { Bootstrap };

// Built per call with the profile the call is for: the client reads window,
// which a server render does not have.
const api = (profileId?: string) => apiClient<App>(() => profileId);

type ComponentConstructor = new (
  checkout: Core,
  props?: Record<string, unknown>,
) => MountedComponent;

interface CallbackActions {
  resolve(value?: unknown): void;
  reject(): void;
}

interface MountedComponent {
  mount(el: HTMLElement): void;
  unmount(): void;
}

function field(value: unknown, key: string): string | undefined {
  const entry =
    value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof entry === "string" && entry ? entry : undefined;
}

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
  const { copied, copy } = useCopy();

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

  // Drop-in's "Supprimer" cancels the order through the session and calls no
  // merchant callback, so the sessionData kept at onOrderUpdated would still
  // show the gift card as paid after a reload. Leaving the page re-reads what
  // the live checkout holds: its latest sessionData and what is left.
  // biome-ignore lint/correctness/useExhaustiveDependencies: flow is fixed per page and the handler reads refs.
  useEffect(() => {
    if (flow !== "sessions") return;
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
  }, []);

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
    api(profileId)
      .api.digital["payment-methods"].post({
        amount: { value: amount, currency },
        countryCode: country,
        shopperLocale: locale,
      })
      .then(
        (result) =>
          unwrap(result) as { paymentMethodsResponse: { storedPaymentMethods?: StoredMethod[] } },
      )
      .then((response) => {
        const methods = response.paymentMethodsResponse.storedPaymentMethods ?? [];
        setStoredMethods(methods);
        setStoredPaymentMethodId((current) => current || methods[0]?.id || "");
      })
      .catch(() => setStoredMethods([]));
  }, [bootstrap, country, currency, profileId]);

  const polledCorrelations = correlationIds.join("|");
  useEffect(() => {
    if (!polledCorrelations || !inspectorOpen) return;
    let active = true;
    const refresh = async () => {
      try {
        const responses = await Promise.all(
          polledCorrelations.split("|").map((id) =>
            api()
              .api.timeline({ correlationId: id })
              .get()
              .then((result) => unwrap(result) as { entries: TimelineEntry[] })
              .catch(() => ({ entries: [] as TimelineEntry[] })),
          ),
        );
        if (!active) return;
        const merged = new Map<string, TimelineEntry>();
        for (const response of responses) {
          for (const entry of response.entries) merged.set(entry.id, entry);
        }
        setTimeline([...merged.values()]);
      } catch {
        // Inspector polling is best-effort and must not interrupt checkout.
      }
    };
    refresh();
    const interval = globalThis.setInterval(refresh, 2500);
    return () => {
      active = false;
      globalThis.clearInterval(interval);
    };
  }, [polledCorrelations, inspectorOpen]);

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

  // Card-only settings. Adyen Web reads these from the card's own
  // configuration and ignores them, with a console warning, at the
  // AdyenCheckout level.
  function methodsConfiguration(): Record<string, unknown> {
    const configuration = paymentMethodsConfiguration(country, bootstrap?.profile.merchantAccount, {
      enableStoreDetails: flow !== "sessions",
    });
    const styles = securedFieldStyles(theme);
    const cardOptions = {
      onBinLookup: (data: unknown) => addCallback("onBinLookup", data),
      onBinValue: (data: unknown) => addCallback("onBinValue", data),
      onBrand: (data: unknown) => addCallback("onBrand", data),
      ...(styles ? { styles } : {}),
    };
    for (const type of ["card", "scheme", "storedCard"]) {
      configuration[type] = { ...(configuration[type] as Record<string, unknown>), ...cardOptions };
    }
    // Gift cards, meal vouchers and Bancontact type into the same secured
    // field iframes: without these colours their digits stay dark on the
    // dark theme. Giftcard hands its props to the iframes, styles included.
    if (styles) {
      for (const type of [
        "giftcard",
        "bcmc",
        "mealVoucher_FR_groupeup",
        "mealVoucher_FR_natixis",
        "mealVoucher_FR_sodexo",
      ]) {
        configuration[type] = { ...(configuration[type] as Record<string, unknown>), styles };
      }
    }
    return configuration;
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
      // Bring-your-own-UI: this markup is ours, only the three data-cse spans
      // become Adyen-hosted Secure Fields iframes when CustomCard.mount()
      // scans this container. No prebuilt Card component involved.
      dropinHost.current.innerHTML = CUSTOM_CARD_MARKUP;
      const statusEl = dropinHost.current.querySelector<HTMLElement>('[data-role="status"]');
      const submitBtn = dropinHost.current.querySelector<HTMLButtonElement>('[data-role="submit"]');
      customCardHolderNameRef.current =
        dropinHost.current.querySelector<HTMLInputElement>("#customCardHolderName");
      const styles = securedFieldStyles(theme);
      const component = new CustomCard(checkout, {
        type: "card",
        autoFocus: true,
        ...(styles ? { styles } : {}),
        onLoad: () => {
          if (statusEl) statusEl.textContent = "Loading secure fields…";
        },
        onConfigSuccess: () => {
          if (statusEl) statusEl.textContent = "";
          if (submitBtn) submitBtn.disabled = false;
        },
        onBrand: (event: { brand?: string }) => {
          if (statusEl && event?.brand) {
            statusEl.textContent = `Detected network: ${event.brand.toUpperCase()}`;
          }
        },
        onValidationError: (errors: Array<{ fieldType?: string }>) => {
          const first = errors?.[0];
          if (statusEl && first?.fieldType) statusEl.textContent = `Check ${first.fieldType}.`;
        },
      } as never);
      if (submitBtn) submitBtn.textContent = `Pay ${amountText}`;
      submitBtn?.addEventListener("click", () => component.submit());
      component.mount(dropinHost.current);
      mounted.current = component as MountedComponent;
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
    return commonConfiguration({
      session,
      beforeSubmit: (state: unknown, _component: unknown, actions: CallbackActions) => {
        addCallback("beforeSubmit", state, correlationId);
        // beforeSubmit's resolve() is not a plain continue, Adyen Web sends
        // back whatever is passed here as the actual /payments payload. An
        // empty resolve() submits with no paymentMethod at all, which Adyen
        // then rejects as "Required field 'paymentMethod' is null".
        actions.resolve(state);
      },
    });
  }

  // The part-paid session kept before a reload, mounted again from its latest
  // sessionData. Its setup answer carries the order, but Adyen Web 6.48.1
  // prices the checkout before reading it (Pay showed the full amount), so
  // the order is applied again, as Adyen Web itself does after a partial
  // payment. Adyen's answer, not the saved copy, says what is left.
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
        const order = checkout.options.order;
        const progress = orderProgress(order);
        setPartialOrder(progress);
        remainingRef.current = progress?.remaining ?? null;
        if (order && progress) await checkout.update({ order });
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
    const data = unwrap(
      await api(profileId).api.digital.sessions.post({
        flow: `sessions-${integration}`,
        amount: { value: amount, currency },
        countryCode: country,
        shopperLocale: locale,
        installments,
        nativeThreeDS,
      }),
    ) as {
      correlationId: string;
      session: { id: string; sessionData: string; expiresAt?: string };
    };
    if (stale()) return;
    updateCorrelation(data.correlationId);
    sessionIdRef.current = data.session.id;
    const expiresAt = data.session.expiresAt ? Date.parse(data.session.expiresAt) : Number.NaN;
    sessionExpiresAtRef.current = Number.isFinite(expiresAt) ? expiresAt : null;
    await mountCheckout(sessionConfiguration(data.correlationId, data.session), stale);
  }

  async function startAdvanced(stale: () => boolean) {
    const methods = unwrap(
      await api(profileId).api.digital["payment-methods"].post({
        amount: { value: amount, currency },
        countryCode: country,
        shopperLocale: locale,
      }),
    ) as {
      correlationId: string;
      shopperConversionId: string;
      paymentMethodsResponse: unknown;
    };
    if (stale()) return;
    updateCorrelation(methods.correlationId);
    shopperConversionRef.current = methods.shopperConversionId;
    const configuration = commonConfiguration({
      amount: { value: amount, currency },
      paymentMethodsResponse: methods.paymentMethodsResponse,
      onSubmit: async (state: unknown, _component: unknown, actions: CallbackActions) => {
        addCallback("onSubmit", state);
        try {
          const stateData = (state as { data?: Record<string, unknown> }).data ?? {};
          const holderName = customCardHolderNameRef.current?.value;
          if (flow === "api-only" && holderName) {
            stateData.paymentMethod = {
              ...((stateData.paymentMethod as Record<string, unknown>) ?? {}),
              holderName,
            };
          }
          const response = unwrap(
            await (flow === "api-only"
              ? api(profileId).api.digital["api-only"]
              : api(profileId).api.digital.payments
            ).post({
              flow: flow === "api-only" ? "api-only-pci" : `advanced-${integration}`,
              countryCode: country,
              shopperLocale: locale,
              shopperConversionId: shopperConversionRef.current,
              nativeThreeDS,
              ...stateData,
              // Once a gift card opened an order, every payment goes into it and
              // charges only its share; otherwise the whole amount.
              ...(partialOrderIdRef.current ? { orderId: partialOrderIdRef.current } : {}),
              amount: {
                value: partialAmount({
                  total: amount,
                  remaining: remainingRef.current,
                  giftCardBalance:
                    field(stateData.paymentMethod, "type") === "giftcard"
                      ? giftCardBalanceRef.current
                      : null,
                }),
                currency,
              },
            }),
          ) as {
            correlationId: string;
            result: unknown;
          };
          updateCorrelation(response.correlationId);
          // onPaymentMethodsRequest runs before onOrderUpdated reports this.
          const progress = orderProgress(valueAt(response.result, "order"));
          if (progress) remainingRef.current = progress.remaining;
          lastPaymentRef.current = {
            pspReference: field(response.result, "pspReference"),
            resultCode: field(response.result, "resultCode"),
            method:
              field(stateData.paymentMethod, "brand") ?? field(stateData.paymentMethod, "type"),
          };
          actions.resolve(response.result);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Payment request failed.");
          actions.reject();
        }
      },
      onAdditionalDetails: async (
        state: unknown,
        _component: unknown,
        actions: CallbackActions,
      ) => {
        addCallback("onAdditionalDetails", state);
        try {
          const stateData = (state as { data?: Record<string, unknown> }).data ?? {};
          const response = unwrap(
            await api(profileId).api.digital.payments.details.post({
              correlationId: correlationRef.current,
              ...stateData,
            }),
          ) as { result: unknown };
          lastPaymentRef.current = {
            ...lastPaymentRef.current,
            pspReference:
              field(response.result, "pspReference") ?? lastPaymentRef.current.pspReference,
            resultCode: field(response.result, "resultCode"),
          };
          actions.resolve(response.result);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Additional details failed.");
          actions.reject();
        }
      },
      ...(flow === "advanced" ? partialPaymentCallbacks() : {}),
    });
    await mountCheckout(configuration, stale);
  }

  // Advanced flow: what Adyen Web does on its own with a session, the
  // merchant's server does here. Without onBalanceCheck a gift card is
  // submitted for the whole amount and refused ("Not enough balance").
  function partialPaymentCallbacks(): Record<string, unknown> {
    const failure = (cause: unknown, fallback: string) =>
      cause instanceof Error ? cause : new Error(fallback);
    return {
      onBalanceCheck: async (
        resolve: (response: unknown) => void,
        reject: (error: Error) => void,
        data: unknown,
      ) => {
        addCallback("onBalanceCheck", data);
        try {
          const response = unwrap(
            await api(profileId).api.digital["gift-card-balance"].post({
              correlationId: partialOrderIdRef.current ?? correlationRef.current,
              amount: { value: remainingRef.current ?? amount, currency },
              paymentMethod: valueAt(data, "paymentMethod"),
            }),
          ) as { result: unknown };
          const balance = valueAt(response.result, "balance.value");
          giftCardBalanceRef.current = typeof balance === "number" ? balance : null;
          resolve(response.result);
        } catch (cause) {
          reject(failure(cause, "The balance check failed."));
        }
      },
      onOrderRequest: async (
        resolve: (order: unknown) => void,
        reject: (error: Error) => void,
        data: unknown,
      ) => {
        addCallback("onOrderRequest", data);
        try {
          const response = unwrap(
            await api(profileId).api.digital["partial-orders"].post({
              amount: { value: amount, currency },
            }),
          ) as { correlationId: string; adyenOrder: unknown };
          partialOrderIdRef.current = response.correlationId;
          updateCorrelation(response.correlationId);
          remainingRef.current = orderProgress(response.adyenOrder)?.remaining ?? null;
          resolve(response.adyenOrder);
        } catch (cause) {
          reject(failure(cause, "The order could not be created."));
        }
      },
      // Drop-in offers to remove a paid gift card, which cancels the order.
      onOrderCancel: async (
        data: unknown,
        actions: { resolve(value: unknown): void; reject(error: string): void },
      ) => {
        addCallback("onOrderCancel", data);
        try {
          if (partialOrderIdRef.current) {
            unwrap(
              await api(profileId)
                .api.digital["partial-orders"]({ id: partialOrderIdRef.current })
                .cancel.post({ order: valueAt(data, "order") }),
            );
          }
          resetPartialOrder();
          actions.resolve({ amount: { value: amount, currency } });
        } catch (cause) {
          actions.reject(failure(cause, "The order could not be cancelled.").message);
        }
      },
      // After a partial payment: the methods that can pay what is left.
      onPaymentMethodsRequest: async (
        data: unknown,
        actions: { resolve(response: unknown): void; reject(): void },
      ) => {
        addCallback("onPaymentMethodsRequest", data);
        try {
          const response = unwrap(
            await api(profileId).api.digital["payment-methods"].post({
              correlationId: partialOrderIdRef.current ?? correlationRef.current,
              amount: { value: remainingRef.current ?? amount, currency },
              countryCode: country,
              shopperLocale: locale,
              shopperConversionId: shopperConversionRef.current,
              order: valueAt(data, "order"),
            }),
          ) as { paymentMethodsResponse: unknown };
          actions.resolve(response.paymentMethodsResponse);
        } catch {
          actions.reject();
        }
      },
    };
  }

  async function createPaymentLink() {
    const response = unwrap(
      await api(profileId).api.digital["payment-links"].post({
        amount: { value: amount, currency },
        countryCode: country,
        shopperLocale: locale,
        validityHours,
        reusable,
      }),
    ) as {
      correlationId: string;
      paymentLink: Record<string, unknown>;
    };
    updateCorrelation(response.correlationId);
    setLink(response.paymentLink);
    setLinkState(field(response.paymentLink, "status") ?? "active");
  }

  async function refreshLink() {
    if (!correlationRef.current) return;
    setLoading(true);
    try {
      const response = unwrap(
        await api(profileId)
          .api.digital["payment-links"]({ orderId: correlationRef.current })
          .get(),
      ) as {
        paymentLink: Record<string, unknown>;
        resolution: { state: string };
      };
      setLinkState(field(response.paymentLink, "status") ?? response.resolution.state);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the link.");
    } finally {
      setLoading(false);
    }
  }

  async function runMit() {
    const response = unwrap(
      await api(profileId).api.digital.mit.post({
        amount: { value: amount, currency },
        storedPaymentMethodId,
        shopperReference,
        recurringProcessingModel: recurringModel,
      }),
    ) as {
      correlationId: string;
      result: Record<string, unknown>;
    };
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
      else if (flow === "pay-by-link") await createPaymentLink();
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
      if (link) {
        const url = field(link, "url") ?? "";
        const expiresAt = field(link, "expiresAt");
        return (
          <div className="link-card">
            <div className="link-card__head">
              <h3>Payment link ready</h3>
              <span className="status-pill status-pill--info">{linkState ?? "active"}</span>
            </div>
            <a className="link-card__url" href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
            <div className="link-card__actions">
              <button
                className="button button--primary"
                type="button"
                onClick={() => copy(url, { raw: true })}
              >
                {copied === url ? "Copied" : "Copy link"}
              </button>
              <a
                className="button button--secondary"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open ↗
              </a>
              <button
                className="button button--secondary"
                type="button"
                disabled={loading}
                onClick={refreshLink}
              >
                Refresh status
              </button>
            </div>
            <dl className="facts">
              <dt>Amount</dt>
              <dd>{amountText}</dd>
              {expiresAt ? (
                <>
                  <dt>Expires</dt>
                  <dd>{new Date(expiresAt).toLocaleString()}</dd>
                </>
              ) : null}
              <dt>Reusable</dt>
              <dd>{field(link, "reusable") ?? (reusable ? "yes" : "no")}</dd>
            </dl>
            <div className="result__actions">
              <button className="text-button" type="button" onClick={() => setLink(null)}>
                Create another link
              </button>
              {correlationId ? (
                <a className="text-button" href={`/back-office?orderId=${correlationId}`}>
                  Open in Back Office
                </a>
              ) : null}
            </div>
          </div>
        );
      }
      return (
        <form
          className="pay-form"
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <Field label="Link valid for" htmlFor="validity">
            <select
              id="validity"
              value={validityHours}
              onChange={(event) => setValidityHours(Number(event.currentTarget.value))}
            >
              {VALIDITY_OPTIONS.map(([hours, label]) => (
                <option key={hours} value={hours}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <label className="switch-row">
            <span>
              <strong>Reusable</strong>
              <small>Several shoppers can pay with the same link.</small>
            </span>
            <input
              type="checkbox"
              checked={reusable}
              onChange={(event) => setReusable(event.currentTarget.checked)}
            />
          </label>
          <button
            className="button button--primary button--block"
            type="submit"
            disabled={loading || !selectedProfile?.isConfigured}
          >
            {loading ? "Creating…" : `Create a link for ${amountText}`}
          </button>
        </form>
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
      const selected = storedMethods?.find((method) => method.id === storedPaymentMethodId);
      const modelMismatch =
        selected?.supportedRecurringProcessingModels?.length &&
        !selected.supportedRecurringProcessingModels.includes(recurringModel);
      return (
        <form
          className="pay-form"
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <fieldset className="choice-list">
            <legend>Saved payment method</legend>
            {storedMethods === null ? (
              <p className="muted">Looking up this week's saved cards…</p>
            ) : storedMethods.length ? (
              storedMethods.map((method) => (
                <label className="choice" key={method.id}>
                  <input
                    type="radio"
                    name="stored"
                    checked={storedPaymentMethodId === method.id}
                    onChange={() => setStoredPaymentMethodId(method.id)}
                  />
                  <span className="choice__main">
                    <strong>
                      {method.brand ?? method.name ?? "Card"}
                      {method.lastFour ? ` •••• ${method.lastFour}` : ""}
                    </strong>
                    <small>
                      {method.expiryMonth
                        ? `Expires ${method.expiryMonth}/${method.expiryYear}`
                        : ""}
                    </small>
                  </span>
                </label>
              ))
            ) : (
              <p className="muted">
                No saved card for this week's shopper yet. Pay once in{" "}
                <a href="/advanced?integration=dropin">Advanced</a> with “Save for my next payment”
                ticked, then come back.
              </p>
            )}
          </fieldset>
          <div className="field">
            <span>Recurring model</span>
            <div className="segmented-control">
              {(["UnscheduledCardOnFile", "Subscription"] as const).map((model) => (
                <button
                  key={model}
                  type="button"
                  aria-pressed={recurringModel === model}
                  onClick={() => setRecurringModel(model)}
                >
                  {model === "UnscheduledCardOnFile" ? "Unscheduled" : "Subscription"}
                </button>
              ))}
            </div>
            {modelMismatch ? (
              <small className="field-warning">
                This card was saved for {selected?.supportedRecurringProcessingModels?.join(", ")};
                Adyen may refuse a {recurringModel} charge.
              </small>
            ) : null}
          </div>
          <details className="more">
            <summary>Use another token</summary>
            <Field
              label="storedPaymentMethodId"
              htmlFor="stored-id"
              hint="Adyen token, never a PAN"
            >
              <input
                id="stored-id"
                autoComplete="off"
                value={storedPaymentMethodId}
                onChange={(event) => setStoredPaymentMethodId(event.currentTarget.value)}
              />
            </Field>
            <Field label="Shopper reference" htmlFor="shopper-ref" hint="Must not contain PII">
              <input
                id="shopper-ref"
                value={shopperReference}
                onChange={(event) => setShopperReference(event.currentTarget.value)}
              />
            </Field>
          </details>
          <button
            className="button button--primary button--block"
            type="submit"
            disabled={loading || !storedPaymentMethodId || !selectedProfile?.isConfigured}
          >
            {loading ? "Charging…" : `Charge ${amountText}`}
          </button>
        </form>
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
