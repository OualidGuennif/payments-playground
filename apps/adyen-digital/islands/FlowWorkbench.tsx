import { AdyenCheckout, CustomCard, Dropin } from "@adyen/adyen-web";
import type { Core } from "@adyen/adyen-web";
import { apiFetch, formatMinorAmount, prettyJson } from "@suite/ui/client.ts";
import { Callout, Field, StatusPill, TestDataAndTools } from "@suite/ui/components.tsx";
import {
  currencyForCountry,
  defaultAmountForCurrency,
  detectCountryFromLanguages,
  FALLBACK_COUNTRY,
  localeForCountry,
} from "@suite/platform/markets.ts";
import {
  INSTALLMENT_COUNTRIES,
  isNonFatalWalletError,
  paymentMethodsConfiguration,
} from "@suite/ui/paymentMethods.ts";
import "@suite/ui/registerPaymentMethods.ts";
import { useEffect, useRef, useState } from "preact/hooks";

type Flow = "sessions" | "advanced" | "pay-by-link" | "mit" | "api-only";

interface PublicProfile {
  id: string;
  label: string;
  isConfigured: boolean;
  missingFields: string[];
  merchantAccount?: string;
}

interface AvailableComponent {
  type: string;
  name: string;
}

type ComponentConstructor = new (
  checkout: Core,
  props?: Record<string, unknown>,
) => MountedComponent;

export interface Bootstrap {
  profile: PublicProfile;
  profiles: PublicProfile[];
  clientKey: string | null;
  webhookUrl: string;
}

interface TimelineEntry {
  id: string;
  kind: "api_call" | "frontend_callback" | "webhook" | "action" | "state";
  name: string;
  status: string;
  occurredAt: string;
  payload: unknown;
  durationMs?: number;
  hmacValid?: boolean;
  optional?: boolean;
}

type CallbackRank = "required" | "recommended" | "optional" | "app";

interface CallbackMeta {
  rank: CallbackRank;
  hint: string;
}

/**
 * What each row of the callbacks tab actually is. A single "optional" badge
 * on everything that was not a payment outcome was wrong twice over: it
 * called `onSubmit` optional, and it presented this playground's own backend
 * responses as if Adyen Web had emitted them. `app` marks the latter.
 */
const CALLBACK_CATALOG: Record<string, CallbackMeta> = {
  onSubmit: {
    rank: "required",
    hint: "You must call /payments with this state and resolve with its response.",
  },
  onAdditionalDetails: {
    rank: "required",
    hint: "3DS or redirect result: forward it to /payments/details, resolve with the response.",
  },
  onPaymentCompleted: {
    rank: "required",
    hint: "Terminal success. The resultCode is final, show the success page here.",
  },
  onPaymentFailed: {
    rank: "required",
    hint: "Terminal failure (refused, cancelled, expired). The order can still be retried.",
  },
  onPaymentMethodsRequest: {
    rank: "required",
    hint: "Sessions flow: intercepts /paymentMethods. You must resolve with the response.",
  },
  onOrderRequest: {
    rank: "required",
    hint: "Partial payments: create the order via /orders and resolve with it.",
  },
  onOrderUpdated: {
    rank: "required",
    hint: "Partial payments: the remaining amount after each partial authorisation.",
  },
  onError: {
    rank: "recommended",
    hint: "Any Adyen Web error, including non-fatal wallet cancellations. Not a result.",
  },
  beforeSubmit: {
    rank: "optional",
    hint: "resolve() is not a plain continue: what you pass becomes the /payments payload.",
  },
  onChange: {
    rank: "optional",
    hint: "Fires on every field edit. Diagnostics only, never a payment decision.",
  },
  onBinLookup: {
    rank: "optional",
    hint: "Co-badged networks detected from the first digits. Diagnostics only.",
  },
  onBinValue: {
    rank: "optional",
    hint: "Hashed BIN of the card being typed. Diagnostics only.",
  },
  onBrand: {
    rank: "optional",
    hint: "Network detected inside the secured fields. Diagnostics only.",
  },
  sessionCreated: {
    rank: "app",
    hint: "Not an Adyen Web callback: the /sessions response from this playground.",
  },
  backendPaymentResponse: {
    rank: "app",
    hint: "Not an Adyen Web callback: this playground's /payments response, pre-resolve().",
  },
  paymentLinkCreated: {
    rank: "app",
    hint: "Not an Adyen Web callback: the /paymentLinks response from this playground.",
  },
  mitResponse: {
    rank: "app",
    hint: "Not an Adyen Web callback: the merchant-initiated /payments response.",
  },
};

const UNLISTED_CALLBACK: CallbackMeta = {
  rank: "optional",
  hint: "Not in the reference list of this playground, check the Adyen Web changelog.",
};

function callbackMeta(name: string): CallbackMeta {
  return CALLBACK_CATALOG[name] ?? UNLISTED_CALLBACK;
}

// Every Checkout endpoint the backend can record, in one line each, so the
// API tab reads as a sequence of intentions rather than a pile of JSON.
const API_HINTS: Array<[string, string]> = [
  ["GET /sessions", "The session's authoritative outcome, fetched with Adyen Web's sessionResult."],
  ["/sessions", "One call, Adyen Web owns 3DS and the rest of the orchestration."],
  ["/paymentMethods", "Methods available for this amount, country and locale."],
  ["/payments/details", "Second leg of a 3DS or redirect flow."],
  ["/paymentLinks", "Creates the Adyen-hosted payment page."],
  ["/orders", "Partial payments: opens the order the gift card pays into."],
  ["/payments", "Authorisation attempt for the submitted payment method."],
];

function apiHint(name: string): string {
  return API_HINTS.find(([endpoint]) => name.includes(endpoint))?.[1] ?? "Adyen Checkout API call.";
}

type PanelTab = "callbacks" | "api" | "webhooks";
type PanelSize = "normal" | "wide" | "full";

const RANK_LABEL: Record<CallbackRank, string> = {
  required: "required",
  recommended: "recommended",
  optional: "optional",
  app: "not Adyen Web",
};

const NEXT_PANEL_SIZE: Record<PanelSize, PanelSize> = {
  normal: "wide",
  wide: "full",
  full: "normal",
};

const PANEL_SIZE_HINT: Record<PanelSize, string> = {
  normal: "Widen the inspector",
  wide: "Expand the inspector to the full screen",
  full: "Dock the inspector back",
};

const EMPTY_TAB_COPY: Record<PanelTab, string> = {
  callbacks: "Callbacks land here in the order Adyen Web fires them, oldest first.",
  api: "Calls this playground makes to the Checkout API land here once a flow starts.",
  webhooks: "Notifications sent by Adyen to this backend land here after the payment.",
};

function toggledSet(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (!next.delete(key)) next.add(key);
  return next;
}

interface CallbackActions {
  resolve(value?: unknown): void;
  reject(): void;
}

interface MountedComponent {
  mount(el: HTMLElement): void;
  unmount(): void;
}

const MARKETS = [
  ["AE", "United Arab Emirates"],
  ["AT", "Austria"],
  ["AU", "Australia"],
  ["BE", "Belgium"],
  ["BR", "Brazil"],
  ["CA", "Canada"],
  ["CH", "Switzerland"],
  ["CN", "China"],
  ["CZ", "Czech Republic"],
  ["DE", "Germany"],
  ["DK", "Denmark"],
  ["ES", "Spain"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["GB", "United Kingdom"],
  ["HK", "Hong Kong"],
  ["ID", "Indonesia"],
  ["IN", "India"],
  ["IT", "Italy"],
  ["JP", "Japan"],
  ["KE", "Kenya"],
  ["KR", "South Korea"],
  ["MX", "Mexico"],
  ["MY", "Malaysia"],
  ["NL", "Netherlands"],
  ["NO", "Norway"],
  ["NZ", "New Zealand"],
  ["PH", "Philippines"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["SE", "Sweden"],
  ["SG", "Singapore"],
  ["TH", "Thailand"],
  ["US", "United States"],
  ["VN", "Vietnam"],
  ["ZA", "South Africa"],
] as const;

// Every market's own locale/currency, so both dropdowns cover the same set
// the per-country defaults are actually drawn from.
const LOCALE_OPTIONS = [...new Set(MARKETS.map(([code]) => localeForCountry(code)))].sort();
const CURRENCY_OPTIONS = [...new Set(MARKETS.map(([code]) => currencyForCountry(code)))].sort();

/**
 * Market to open on: pay-by-link keeps its NL default, everything else is
 * guessed from the browser's languages and falls back to a European market.
 * Returns the fallback during SSR, where there is no navigator.
 */
function detectInitialCountry(flow: Flow): string {
  if (flow === "pay-by-link" || typeof navigator === "undefined") return FALLBACK_COUNTRY;
  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language].filter(Boolean);
  const guess = detectCountryFromLanguages(languages, FALLBACK_COUNTRY);
  return MARKETS.some(([code]) => code === guess) ? guess : FALLBACK_COUNTRY;
}

// Reuses Adyen's own shipped CSS classes (imported globally as adyen.css) for
// field box sizing/focus states, same as the legacy playground's hand-rolled
// Secure Fields form, only the wrapper/status/hint below are custom.
const CUSTOM_CARD_MARKUP = `
  <div class="custom-card-form">
    <div class="adyen-checkout__field">
      <label class="adyen-checkout__label" for="customCardHolderName">Cardholder name</label>
      <div class="adyen-checkout__input-wrapper">
        <input
          id="customCardHolderName"
          class="adyen-checkout__input"
          autocomplete="cc-name"
          placeholder="John Doe"
        />
      </div>
    </div>
    <div class="adyen-checkout__field">
      <label class="adyen-checkout__label">Card number</label>
      <div class="adyen-checkout__input-wrapper">
        <span class="adyen-checkout__input" data-cse="encryptedCardNumber"></span>
      </div>
    </div>
    <div class="adyen-checkout__field adyen-checkout__field--two-in-one">
      <div class="adyen-checkout__field">
        <label class="adyen-checkout__label">Expiry date</label>
        <div class="adyen-checkout__input-wrapper">
          <span class="adyen-checkout__input" data-cse="encryptedExpiryDate"></span>
        </div>
      </div>
      <div class="adyen-checkout__field">
        <label class="adyen-checkout__label">CVC</label>
        <div class="adyen-checkout__input-wrapper">
          <span class="adyen-checkout__input" data-cse="encryptedSecurityCode"></span>
        </div>
      </div>
    </div>
    <p class="custom-card-status" data-role="status" aria-live="polite"></p>
    <button
      type="button"
      class="adyen-checkout__button adyen-checkout__button--pay custom-card-submit"
      data-role="submit"
      disabled
    >
      Pay now
    </button>
    <p class="custom-card-hint">
      Card data never touches our server, these fields are Adyen-hosted iframes (Secure
      Fields). Only encrypted blobs reach the backend.
    </p>
  </div>
`;

function flagEmoji(countryCode: string): string {
  return String.fromCodePoint(
    ...countryCode.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0)),
  );
}

// This is a TEST playground: sdkData, sessionData and other frontend
// callback payloads are shown in full, nothing here is a real credential,
// and truncating them just hides useful debug information.
function recordSafe(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth limited]";
  if (Array.isArray(value)) return value.slice(0, 30).map((entry) => recordSafe(entry, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = recordSafe(entry, depth + 1);
  }
  return output;
}

function timestamp(): string {
  return new Date().toISOString();
}

function extractAdditionalData(value: unknown): { rest: unknown; additionalData: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { rest: value, additionalData: null };
  }
  const { additionalData, ...rest } = value as Record<string, unknown>;
  return { rest, additionalData: additionalData ?? null };
}

const LONG_VALUE_LIMIT = 120;

interface Fold {
  key: string;
  expanded: boolean;
}

/**
 * Rewrites every string longer than LONG_VALUE_LIMIT to its first characters
 * followed by a marker, which the renderer turns into a per-value expander.
 * A single sdkData blob is otherwise long enough to bury the four fields
 * around it, and hiding it outright would lose it.
 */
function foldLongValues(
  value: unknown,
  expandedValues: Set<string>,
  baseKey: string,
  folds: Fold[],
  path = "",
): unknown {
  if (typeof value === "string" && value.length > LONG_VALUE_LIMIT) {
    const key = `${baseKey}#${path}`;
    const expanded = expandedValues.has(key);
    folds.push({ key, expanded });
    const shown = expanded ? value : `${value.slice(0, LONG_VALUE_LIMIT)}…`;
    return `${shown}@@FOLD:${folds.length - 1}@@`;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      foldLongValues(entry, expandedValues, baseKey, folds, `${path}[${index}]`)
    );
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = foldLongValues(entry, expandedValues, baseKey, folds, `${path}.${key}`);
    }
    return output;
  }
  return value;
}

function JsonBlock(
  { value, entryKey, expandedValues, onToggleValue }: {
    value: unknown;
    entryKey: string;
    expandedValues: Set<string>;
    onToggleValue: (key: string) => void;
  },
) {
  const folds: Fold[] = [];
  const text = prettyJson(foldLongValues(value, expandedValues, entryKey, folds)) || "null";
  const parts = text.split(/@@FOLD:(\d+)@@/);
  return (
    <pre>
      {parts.map((part, index) => {
        if (index % 2 === 0) return part;
        const fold = folds[Number(part)];
        if (!fold) return null;
        return (
          <button
            type="button"
            class="json-fold"
            key={fold.key}
            title={fold.expanded ? "Collapse this value" : "Show the full value"}
            onClick={() => onToggleValue(fold.key)}
          >
            {fold.expanded ? "collapse" : "…"}
          </button>
        );
      })}
    </pre>
  );
}

export default function FlowWorkbench(
  { flow, initialBootstrap, initialIntegration }: {
    flow: Flow;
    initialBootstrap?: Bootstrap;
    initialIntegration?: "dropin" | "component";
  },
) {
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
    defaultAmountForCurrency(currencyForCountry(detectInitialCountry(flow)))
  );
  const [locale, setLocale] = useState(() => localeForCountry(detectInitialCountry(flow)));
  // Whether installments are offered is a property of the market, not a
  // manual preference, always derived from country rather than a toggle.
  const installments = INSTALLMENT_COUNTRIES.includes(country.toUpperCase());
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  // The advanced flow mints a new correlation id at /payments, so keeping only
  // the current one made the /paymentMethods call vanish from the API tab the
  // moment a payment was submitted. Every id of the run is polled and merged.
  const [correlationIds, setCorrelationIds] = useState<string[]>([]);
  const [callbacks, setCallbacks] = useState<TimelineEntry[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelSize, setPanelSize] = useState<PanelSize>("normal");
  const [panelTab, setPanelTab] = useState<PanelTab>("callbacks");
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [expandedValues, setExpandedValues] = useState<Set<string>>(new Set());
  const [additionalDataOpen, setAdditionalDataOpen] = useState<Set<string>>(new Set());
  const [webhookWaiting, setWebhookWaiting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, unknown> | null>(null);
  const [storedPaymentMethodId, setStoredPaymentMethodId] = useState("");
  const [shopperReference, setShopperReference] = useState("shopper-test-001");
  const [recurringModel, setRecurringModel] = useState<
    "UnscheduledCardOnFile" | "Subscription"
  >("UnscheduledCardOnFile");
  const [validityHours, setValidityHours] = useState(24);
  const [reusable, setReusable] = useState(false);
  // Adyen Web renders into this node with its own Preact copy, so it is kept
  // apart from anything this island renders: the placeholder is a sibling.
  const dropinHost = useRef<HTMLDivElement>(null);
  const [checkoutMounted, setCheckoutMounted] = useState(false);
  const mounted = useRef<MountedComponent | null>(null);
  // Bumped by every start(). A settings change can restart the checkout while
  // the previous run still awaits the network; only the latest run may mount.
  const runRef = useRef(0);
  const correlationRef = useRef<string | null>(null);
  const checkoutRef = useRef<Core | null>(null);
  const customCardHolderNameRef = useRef<HTMLInputElement | null>(null);
  // Minted by /paymentMethods and repeated on the /payments call it leads to,
  // so Adyen sees both requests as one checkout conversion.
  const shopperConversionRef = useRef<string | null>(null);

  function updateCorrelation(value: string) {
    correlationRef.current = value;
    setCorrelationId(value);
    setCorrelationIds((current) => current.includes(value) ? current : [...current, value]);
  }

  function toggleEntry(id: string) {
    setExpandedEntries((current) => toggledSet(current, id));
  }

  function toggleValue(key: string) {
    setExpandedValues((current) => toggledSet(current, key));
  }

  function toggleAdditionalData(id: string) {
    setAdditionalDataOpen((current) => toggledSet(current, id));
  }

  useEffect(() => {
    apiFetch<Bootstrap>("/api/bootstrap")
      .then((data) => {
        setBootstrap(data);
        setProfileId(data.profile.id);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Bootstrap failed."));
    return () => mounted.current?.unmount();
  }, []);

  const autoInitRef = useRef(false);
  useEffect(() => {
    if (!hasAutoInit || autoInitRef.current || !bootstrap?.clientKey) return;
    autoInitRef.current = true;
    start();
  }, [bootstrap]);

  // No "Update settings" button, any change to the scenario reloads the
  // checkout on its own, debounced so typing an amount or flipping through
  // markets doesn't refire on every keystroke.
  const skipFirstAutoRestart = useRef(true);
  useEffect(() => {
    if (!hasAutoInit || !autoInitRef.current) return;
    if (skipFirstAutoRestart.current) {
      skipFirstAutoRestart.current = false;
      return;
    }
    const timeout = setTimeout(() => start(), 500);
    return () => clearTimeout(timeout);
  }, [amount, currency, country, locale, integration, profileId]);

  const polledCorrelations = correlationIds.join("|");
  useEffect(() => {
    if (!polledCorrelations || !panelOpen) return;
    let active = true;
    const refresh = async () => {
      try {
        const responses = await Promise.all(
          polledCorrelations.split("|").map((id) =>
            apiFetch<{ entries: TimelineEntry[] }>(`/api/timeline/${id}`)
              .catch(() => ({ entries: [] as TimelineEntry[] }))
          ),
        );
        if (!active) return;
        const merged = new Map<string, TimelineEntry>();
        for (const response of responses) {
          for (const entry of response.entries) merged.set(entry.id, entry);
        }
        const entries = [...merged.values()].sort((left, right) =>
          left.occurredAt.localeCompare(right.occurredAt)
        );
        setTimeline(entries);
        setWebhookWaiting(!entries.some((entry) => entry.kind === "webhook"));
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
  }, [polledCorrelations, panelOpen]);

  async function switchProfile(nextId: string) {
    setError(null);
    await apiFetch("/api/profiles/preferred", {
      method: "POST",
      body: JSON.stringify({ profileId: nextId }),
    });
    const data = await apiFetch<Bootstrap>("/api/bootstrap");
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
  }

  function selectCurrency(nextCurrency: string) {
    setAmount(defaultAmountForCurrency(nextCurrency));
    setCurrency(nextCurrency);
  }

  function addCallback(name: string, payload: unknown, explicitCorrelation?: string) {
    const safePayload = recordSafe(payload);
    const entry: TimelineEntry = {
      id: crypto.randomUUID(),
      kind: "frontend_callback",
      name,
      status: "received",
      occurredAt: timestamp(),
      payload: safePayload,
      optional: callbackMeta(name).rank !== "required",
    };
    setCallbacks((current) => [...current, entry]);
    // The ref, not the state: Adyen Web keeps the handlers of the render that
    // created the checkout, whose state still holds the previous run's id.
    const id = explicitCorrelation ?? correlationRef.current;
    if (id) {
      apiFetch("/api/callbacks", {
        method: "POST",
        body: JSON.stringify({
          correlationId: id,
          name,
          occurredAt: entry.occurredAt,
          payload: safePayload,
        }),
      }, profileId).catch(() => undefined);
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
        setOutcome({ status: "completed", result: recordSafe(result) });
        syncSessionResult(result);
      },
      onPaymentFailed: (result: unknown) => {
        addCallback("onPaymentFailed", result);
        setOutcome({ status: "failed", result: recordSafe(result) });
        syncSessionResult(result);
      },
      onError: (cause: unknown) => {
        addCallback("onError", cause);
        if (isNonFatalWalletError(cause)) return;
        setError(cause instanceof Error ? cause.message : "Adyen Web reported an error.");
      },
      ...extra,
    };
  }

  // Sessions only: Adyen Web ran the payment, so the server asks Adyen how it
  // ended, which is what lets the Back Office show it without a webhook.
  function syncSessionResult(result: unknown) {
    const sessionResult = (result as { sessionResult?: unknown } | null)?.sessionResult;
    const orderId = correlationRef.current;
    if (flow !== "sessions" || typeof sessionResult !== "string" || !orderId) return;
    apiFetch(`/api/digital/sessions/${orderId}/result`, {
      method: "POST",
      body: JSON.stringify({ sessionResult }),
    }, profileId).catch(() => undefined);
  }

  // Card-only events. Adyen Web reads them from the card's own configuration
  // and ignores them, with a console warning, at the AdyenCheckout level.
  function methodsConfiguration(): Record<string, unknown> {
    const configuration = paymentMethodsConfiguration(country, bootstrap?.profile.merchantAccount, {
      enableStoreDetails: flow !== "sessions",
    });
    const cardEvents = {
      onBinLookup: (data: unknown) => addCallback("onBinLookup", data),
      onBinValue: (data: unknown) => addCallback("onBinValue", data),
      onBrand: (data: unknown) => addCallback("onBrand", data),
    };
    for (const type of ["card", "scheme"]) {
      configuration[type] = { ...configuration[type] as Record<string, unknown>, ...cardEvents };
    }
    return configuration;
  }

  function mountComponentType(type: string) {
    const checkout = checkoutRef.current;
    if (!checkout || !dropinHost.current) return;
    try {
      const ComponentClass = checkout.getComponent(type) as
        | ComponentConstructor
        | undefined;
      if (!ComponentClass) {
        setError(`No "${type}" component is available in this payment methods response.`);
        return;
      }
      mounted.current?.unmount();
      dropinHost.current.replaceChildren();
      const config = methodsConfiguration()[type] as Record<string, unknown> | undefined;
      // Card/PayPal/etc. have dedicated classes whose static `type` is already
      // correct, but every redirect-only method (Alma, Wero, WeChat...) shares
      // the same generic Redirect element, without an explicit `type` here it
      // mounts with no identifiable payment method, so `state.data.paymentMethod`
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

  async function mountCheckout(configuration: Record<string, unknown>, stale: () => boolean) {
    const checkout = await AdyenCheckout(configuration as never) as Core;
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
      const submitBtn = dropinHost.current.querySelector<HTMLButtonElement>(
        '[data-role="submit"]',
      );
      customCardHolderNameRef.current = dropinHost.current.querySelector<HTMLInputElement>(
        "#customCardHolderName",
      );
      const component = new CustomCard(checkout, {
        type: "card",
        autoFocus: true,
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
      submitBtn?.addEventListener("click", () => component.submit());
      component.mount(dropinHost.current);
      mounted.current = component as MountedComponent;
      setCheckoutMounted(true);
      return;
    }

    const methods = (checkout.paymentMethodsResponse?.paymentMethods ?? []) as AvailableComponent[];
    setAvailableComponents(methods.map((method) => ({ type: method.type, name: method.name })));

    if (integration === "dropin") {
      const component = new Dropin(checkout, {
        paymentMethodsConfiguration: methodsConfiguration(),
        openFirstPaymentMethod: false,
        instantPaymentTypes: ["applepay", "googlepay"],
      });
      component.mount(dropinHost.current);
      mounted.current = component as MountedComponent;
      setCheckoutMounted(true);
      return;
    }

    const nextType = methods.some((method) => method.type === componentType)
      ? componentType
      : (methods[0]?.type ?? "scheme");
    mountComponentType(nextType);
  }

  async function startSession(stale: () => boolean) {
    const data = await apiFetch<{
      correlationId: string;
      session: { id: string; sessionData: string };
    }>("/api/digital/sessions", {
      method: "POST",
      body: JSON.stringify({
        flow: `sessions-${integration}`,
        amount: { value: amount, currency },
        countryCode: country,
        shopperLocale: locale,
        installments,
      }),
    }, profileId);
    if (stale()) return;
    updateCorrelation(data.correlationId);
    addCallback("sessionCreated", { id: data.session.id }, data.correlationId);
    const configuration = commonConfiguration({
      session: data.session,
      beforeSubmit: (state: unknown, _component: unknown, actions: CallbackActions) => {
        addCallback("beforeSubmit", state, data.correlationId);
        // beforeSubmit's resolve() is not a plain continue, Adyen Web sends
        // back whatever is passed here as the actual /payments payload. An
        // empty resolve() submits with no paymentMethod at all, which Adyen
        // then rejects as "Required field 'paymentMethod' is null".
        actions.resolve(state);
      },
    });
    await mountCheckout(configuration, stale);
  }

  async function startAdvanced(stale: () => boolean) {
    const methods = await apiFetch<{
      correlationId: string;
      shopperConversionId: string;
      paymentMethodsResponse: unknown;
    }>("/api/digital/payment-methods", {
      method: "POST",
      body: JSON.stringify({
        amount: { value: amount, currency },
        countryCode: country,
        shopperLocale: locale,
      }),
    }, profileId);
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
              ...(stateData.paymentMethod as Record<string, unknown> ?? {}),
              holderName,
            };
          }
          const response = await apiFetch<{
            correlationId: string;
            result: unknown;
          }>(flow === "api-only" ? "/api/digital/api-only" : "/api/digital/payments", {
            method: "POST",
            body: JSON.stringify({
              flow: flow === "api-only" ? "api-only-pci" : `advanced-${integration}`,
              amount: { value: amount, currency },
              countryCode: country,
              shopperLocale: locale,
              shopperConversionId: shopperConversionRef.current,
              ...stateData,
            }),
          }, profileId);
          updateCorrelation(response.correlationId);
          addCallback("backendPaymentResponse", response.result, response.correlationId);
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
          const response = await apiFetch<{ result: unknown }>(
            "/api/digital/payments/details",
            {
              method: "POST",
              body: JSON.stringify({ correlationId: correlationRef.current, ...stateData }),
            },
            profileId,
          );
          actions.resolve(response.result);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Additional details failed.");
          actions.reject();
        }
      },
    });
    await mountCheckout(configuration, stale);
  }

  async function createPaymentLink() {
    const response = await apiFetch<{
      correlationId: string;
      paymentLink: Record<string, unknown>;
    }>("/api/digital/payment-links", {
      method: "POST",
      body: JSON.stringify({
        amount: { value: amount, currency },
        countryCode: country,
        shopperLocale: locale,
        validityHours,
        reusable,
      }),
    }, profileId);
    updateCorrelation(response.correlationId);
    setOutcome(response.paymentLink);
    addCallback("paymentLinkCreated", response.paymentLink, response.correlationId);
  }

  async function runMit() {
    const response = await apiFetch<{
      correlationId: string;
      result: Record<string, unknown>;
    }>("/api/digital/mit", {
      method: "POST",
      body: JSON.stringify({
        amount: { value: amount, currency },
        storedPaymentMethodId,
        shopperReference,
        recurringProcessingModel: recurringModel,
      }),
    }, profileId);
    updateCorrelation(response.correlationId);
    setOutcome(response.result);
    addCallback("mitResponse", response.result, response.correlationId);
  }

  // The inspector never opens itself: it is a debugging surface, and popping
  // it over the checkout on every (re)start is the opposite of a demo.
  async function start() {
    setError(null);
    setOutcome(null);
    setCallbacks([]);
    setTimeline([]);
    setCorrelationIds([]);
    setExpandedEntries(new Set());
    setExpandedValues(new Set());
    setAdditionalDataOpen(new Set());
    // A conversion id belongs to one checkout; the next one mints its own.
    shopperConversionRef.current = null;
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

  function renderEvent(entry: TimelineEntry) {
    const entryOpen = expandedEntries.has(entry.id);
    const extraOpen = additionalDataOpen.has(entry.id);
    const meta = entry.kind === "frontend_callback" ? callbackMeta(entry.name) : null;
    const api = entry.kind === "api_call"
      ? entry.payload as { request?: unknown; response?: unknown; error?: string }
      : null;
    const failed = Boolean(api?.error) || Number(entry.status) >= 400;
    const source = api ? (api.error ? { error: api.error } : api.response) : entry.payload;
    const { rest: body, additionalData } = extractAdditionalData(source);

    return (
      <article class="event-row" key={entry.id}>
        <button
          type="button"
          class="event-row__header"
          aria-expanded={entryOpen}
          onClick={() => toggleEntry(entry.id)}
        >
          <span class="event-row__meta">
            <strong>{entry.name}</strong>
            {meta
              ? (
                <span class={`event-row__badge event-row__badge--${meta.rank}`}>
                  {RANK_LABEL[meta.rank]}
                </span>
              )
              : null}
            {api
              ? (
                <span class={`event-row__badge event-row__badge--${failed ? "error" : "ok"}`}>
                  {api.error ? "failed" : entry.status}
                </span>
              )
              : null}
            {entry.kind === "webhook"
              ? (
                <span
                  class={`event-row__badge event-row__badge--${entry.hmacValid ? "ok" : "error"}`}
                >
                  {entry.hmacValid ? "HMAC valid" : "HMAC invalid"}
                </span>
              )
              : null}
            <time datetime={entry.occurredAt}>
              {new Date(entry.occurredAt).toLocaleTimeString()}
              {entry.durationMs ? ` · ${entry.durationMs} ms` : ""}
            </time>
          </span>
          <span class="event-row__caret" aria-hidden="true">{entryOpen ? "−" : "+"}</span>
        </button>
        {entryOpen
          ? (
            <div class="event-row__detail">
              <p class="event-row__hint">
                {meta
                  ? meta.hint
                  : api
                  ? apiHint(entry.name)
                  : "Server-to-server notification, HMAC checked when the backend received it."}
              </p>
              {api
                ? (
                  <div class="event-row__section">
                    <span class="event-row__label">Request</span>
                    <JsonBlock
                      value={api.request}
                      entryKey={`${entry.id}:request`}
                      expandedValues={expandedValues}
                      onToggleValue={toggleValue}
                    />
                  </div>
                )
                : null}
              <div class="event-row__section">
                <span class="event-row__label">
                  {api ? "Response" : entry.kind === "webhook" ? "Notification" : "Payload"}
                </span>
                <JsonBlock
                  value={body}
                  entryKey={`${entry.id}:body`}
                  expandedValues={expandedValues}
                  onToggleValue={toggleValue}
                />
              </div>
              {additionalData
                ? (
                  <div class="event-row__section">
                    <button
                      type="button"
                      class="data-toggle"
                      aria-pressed={extraOpen}
                      onClick={() => toggleAdditionalData(entry.id)}
                    >
                      <span class="data-toggle__track" aria-hidden="true"></span>
                      <span class="data-toggle__label">Show additionalData</span>
                      <span class="data-toggle__state">{extraOpen ? "ON" : "OFF"}</span>
                    </button>
                    {extraOpen
                      ? (
                        <JsonBlock
                          value={additionalData}
                          entryKey={`${entry.id}:additionalData`}
                          expandedValues={expandedValues}
                          onToggleValue={toggleValue}
                        />
                      )
                      : null}
                  </div>
                )
                : null}
            </div>
          )
          : null}
      </article>
    );
  }

  const apiEntries = timeline.filter((entry) => entry.kind === "api_call");
  const webhookEntries = timeline.filter((entry) => entry.kind === "webhook");
  // Nothing is filtered out and nothing is hidden behind an "expand all":
  // a callback you never see is a callback you never learn.
  const visibleEvents = panelTab === "callbacks"
    ? callbacks
    : panelTab === "api"
    ? apiEntries
    : webhookEntries;
  const selectedProfile = bootstrap?.profiles.find((profile) => profile.id === profileId);

  return (
    <>
      {bootstrap && !selectedProfile?.isConfigured
        ? (
          <Callout title="Profile incomplete" tone="warning">
            Add the missing server-side fields in Settings:{" "}
            {selectedProfile?.missingFields.join(", ") ?? ""}.
          </Callout>
        )
        : null}
      {error
        ? (
          <div class="callout callout--danger" role="alert">
            <strong>Flow stopped</strong>
            <div>{error}</div>
          </div>
        )
        : null}
      <div class="checkout-layout">
        <section class="checkout-shell" aria-busy={loading}>
          <div class="checkout-context">
            <StatusPill
              tone={!bootstrap ? "neutral" : selectedProfile?.isConfigured ? "positive" : "warning"}
            >
              {selectedProfile?.label ?? "Loading profile"}
            </StatusPill>
            <div class="checkout-market">
              <TestDataAndTools />
              <select
                aria-label="Checkout market"
                value={country}
                onChange={(event) => selectMarket(event.currentTarget.value)}
              >
                {MARKETS.map(([code, name]) => (
                  <option key={code} value={code}>{flagEmoji(code)} {name}</option>
                ))}
              </select>
              <select
                aria-label="Shopper language"
                value={locale}
                onChange={(event) => setLocale(event.currentTarget.value)}
              >
                {LOCALE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
          </div>

          <details class="scenario-settings">
            <summary>
              <span class="scenario-settings__title">
                <strong>Scenario &amp; Drop-in settings</strong>
                <span>
                  {flow === "pay-by-link"
                    ? "Hosted link"
                    : flow === "mit"
                    ? recurringModel
                    : integration === "dropin"
                    ? "Drop-in"
                    : "Components"} ·{" "}
                  {formatMinorAmount(Number.isFinite(amount) ? amount : 0, currency)} ·{" "}
                  {flagEmoji(country)} {country} · {locale}
                </span>
              </span>
            </summary>
            <div class="scenario-settings__body">
              <div class="form-grid form-grid--three">
                <Field label="Server-side TEST profile" htmlFor="profile">
                  <select
                    id="profile"
                    value={profileId}
                    onChange={(event) => switchProfile(event.currentTarget.value)}
                  >
                    {bootstrap?.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                        {profile.isConfigured ? "" : ", incomplete"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Amount (minor units)"
                  htmlFor="amount"
                  hint={`= ${formatMinorAmount(Number.isFinite(amount) ? amount : 0, currency)}`}
                >
                  <input
                    id="amount"
                    type="number"
                    min="1"
                    max="100000000"
                    value={amount}
                    onInput={(event) => setAmount(event.currentTarget.valueAsNumber)}
                  />
                </Field>
                <Field label="Currency" htmlFor="currency">
                  <select
                    id="currency"
                    value={currency}
                    onChange={(event) => selectCurrency(event.currentTarget.value)}
                  >
                    {CURRENCY_OPTIONS.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                {flow === "sessions" || flow === "advanced" || flow === "api-only"
                  ? (
                    <div class="field">
                      <span>Frontend integration</span>
                      <div class="segmented-control" aria-label="Frontend integration">
                        <button
                          type="button"
                          aria-pressed={integration === "dropin"}
                          onClick={() => setIntegration("dropin")}
                        >
                          Drop-in
                        </button>
                        <button
                          type="button"
                          aria-pressed={integration === "component"}
                          onClick={() => setIntegration("component")}
                        >
                          Components
                        </button>
                      </div>
                    </div>
                  )
                  : null}
                {integration === "component" && flow !== "api-only" &&
                    availableComponents.length > 0
                  ? (
                    <Field
                      label="Component to test"
                      htmlFor="componentType"
                      hint="Populated from this profile's actual payment methods"
                    >
                      <select
                        id="componentType"
                        value={componentType}
                        onChange={(event) => mountComponentType(event.currentTarget.value)}
                      >
                        {availableComponents.map((method) => (
                          <option key={method.type} value={method.type}>
                            {method.name} ({method.type})
                          </option>
                        ))}
                      </select>
                    </Field>
                  )
                  : null}
                {flow === "sessions" && installments
                  ? (
                    <div class="field">
                      <span>Installments</span>
                      <small>
                        installmentOptions is automatically sent in /sessions for this market
                        (Brazil, Mexico, Japan).
                      </small>
                    </div>
                  )
                  : null}
                {flow === "pay-by-link"
                  ? (
                    <>
                      <Field label="Validity (hours)" htmlFor="validity">
                        <input
                          id="validity"
                          type="number"
                          min="1"
                          max="1680"
                          value={validityHours}
                          onInput={(event) => setValidityHours(event.currentTarget.valueAsNumber)}
                        />
                      </Field>
                      <div class="field">
                        <span>Reusability</span>
                        <label class="switch-row">
                          <span>Reusable link</span>
                          <input
                            type="checkbox"
                            checked={reusable}
                            onChange={(event) => setReusable(event.currentTarget.checked)}
                          />
                        </label>
                      </div>
                    </>
                  )
                  : null}
                {flow === "mit"
                  ? (
                    <>
                      <Field
                        label="storedPaymentMethodId"
                        htmlFor="storedPaymentMethodId"
                        hint="Adyen token, never a PAN"
                      >
                        <input
                          id="storedPaymentMethodId"
                          type="password"
                          autocomplete="off"
                          value={storedPaymentMethodId}
                          onInput={(event) => setStoredPaymentMethodId(event.currentTarget.value)}
                        />
                      </Field>
                      <Field
                        label="Shopper reference"
                        htmlFor="shopperReference"
                        hint="Must not contain PII"
                      >
                        <input
                          id="shopperReference"
                          value={shopperReference}
                          onInput={(event) => setShopperReference(event.currentTarget.value)}
                        />
                      </Field>
                      <Field label="Recurring model" htmlFor="recurringModel">
                        <select
                          id="recurringModel"
                          value={recurringModel}
                          onChange={(event) =>
                            setRecurringModel(
                              event.currentTarget.value as
                                | "UnscheduledCardOnFile"
                                | "Subscription",
                            )}
                        >
                          <option value="UnscheduledCardOnFile">UnscheduledCardOnFile</option>
                          <option value="Subscription">Subscription</option>
                        </select>
                      </Field>
                    </>
                  )
                  : null}
              </div>
              {hasAutoInit
                ? (
                  <div class="form-actions">
                    {loading ? <span class="mono">Reloading checkout…</span> : null}
                    {correlationId
                      ? <span class="mono">Correlation {correlationId.slice(0, 13)}…</span>
                      : null}
                  </div>
                )
                : null}
            </div>
          </details>

          {!hasAutoInit
            ? (
              <div class="form-actions">
                <button
                  class="button button--primary"
                  type="button"
                  disabled={loading || !selectedProfile?.isConfigured}
                  onClick={() => start()}
                >
                  {loading
                    ? "Starting…"
                    : flow === "pay-by-link"
                    ? "Create TEST payment link"
                    : "Run TEST MIT"}
                </button>
                {correlationId
                  ? <span class="mono">Correlation {correlationId.slice(0, 13)}…</span>
                  : null}
              </div>
            )
            : null}

          {flow === "api-only"
            ? (
              <Callout title="PCI boundary" tone="warning">
                Card entry is rendered by Adyen Secured Fields. This application rejects raw PAN,
                CVC and security-code properties at the API boundary and stores only sanitized
                observability data.
              </Callout>
            )
            : null}

          <div class="payment-stage">
            <div class="payment-stage__main">
              <div class="payment-stage__header">
                <div>
                  <span class="eyebrow">
                    {flow === "pay-by-link" ? "Hosted checkout" : "Payment experience"}
                  </span>
                  <h2>
                    {flow === "pay-by-link"
                      ? "Payment link"
                      : flow === "mit"
                      ? "MIT response"
                      : "Select your payment method"}
                  </h2>
                </div>
                <StatusPill>
                  {flow === "pay-by-link"
                    ? "Hosted link"
                    : flow === "mit"
                    ? "API request"
                    : integration === "dropin"
                    ? "Drop-in"
                    : "Component"}
                </StatusPill>
              </div>
              {flow === "pay-by-link" && outcome
                ? (
                  <div class="panel">
                    <h2>Link created</h2>
                    {typeof outcome.url === "string"
                      ? (
                        <p>
                          <a href={outcome.url} target="_blank" rel="noreferrer">
                            Open the Adyen-hosted TEST payment page
                          </a>
                        </p>
                      )
                      : null}
                    <pre class="code-block">{prettyJson(recordSafe(outcome))}</pre>
                  </div>
                )
                : flow === "mit" && outcome
                ? <pre class="code-block">{prettyJson(recordSafe(outcome))}</pre>
                : (
                  <div class="dropin-host" aria-live="polite">
                    <div ref={dropinHost} />
                    {!checkoutMounted
                      ? (
                        <div class="dropin-placeholder">
                          <p>
                            The scenario is ready. Open settings only if you want to change the
                            profile, market, language, amount or integration.
                          </p>
                        </div>
                      )
                      : null}
                  </div>
                )}
            </div>
            <aside class="order-summary" aria-label="Order summary">
              <h3>Order summary</h3>
              <div class="order-summary__line">
                <span>
                  <span class="order-summary__icon" aria-hidden="true">🛍️</span>
                  Playground order
                </span>
                <strong>{formatMinorAmount(Number.isFinite(amount) ? amount : 0, currency)}</strong>
              </div>
              <div class="order-summary__total">
                <span>Total</span>
                <strong>{formatMinorAmount(Number.isFinite(amount) ? amount : 0, currency)}</strong>
              </div>
            </aside>
          </div>
        </section>

        <aside
          class={`inspector inspector--${panelSize}`}
          hidden={!panelOpen}
          aria-label="Payment observability panel"
        >
          <header class="inspector__header">
            <div class="inspector__tabs" role="tablist" aria-label="Inspector views">
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === "callbacks"}
                onClick={() => setPanelTab("callbacks")}
              >
                Callbacks <span class="inspector__count">{callbacks.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === "api"}
                onClick={() => setPanelTab("api")}
              >
                API calls <span class="inspector__count">{apiEntries.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === "webhooks"}
                onClick={() => setPanelTab("webhooks")}
              >
                Webhooks <span class="inspector__count">{webhookEntries.length}</span>
              </button>
            </div>
            <div class="inspector__actions">
              <button
                class="inspector__icon"
                type="button"
                title={PANEL_SIZE_HINT[panelSize]}
                aria-label={PANEL_SIZE_HINT[panelSize]}
                onClick={() => setPanelSize(NEXT_PANEL_SIZE[panelSize])}
              >
                {panelSize === "full" ? "⤡" : "⤢"}
              </button>
              <button
                class="inspector__icon inspector__icon--close"
                type="button"
                title="Hide the inspector"
                aria-label="Hide the inspector"
                onClick={() => setPanelOpen(false)}
              >
                ✕
              </button>
            </div>
          </header>
          <div class="inspector__body" role="tabpanel">
            {visibleEvents.length
              ? <div class="event-list">{visibleEvents.map(renderEvent)}</div>
              : <p class="inspector__empty">{EMPTY_TAB_COPY[panelTab]}</p>}
          </div>
          <footer class="inspector__footer">
            <span class="mono">
              {webhookWaiting
                ? (
                  <>
                    <span class="waiting-dot" aria-hidden="true" /> Waiting for a webhook
                  </>
                )
                : `${webhookEntries.length} webhook(s) received`}
            </span>
            {panelTab === "webhooks"
              ? <span class="inspector__note">Asynchronous methods can take a while.</span>
              : (
                <button
                  class="button button--small button--primary"
                  type="button"
                  onClick={() => setPanelTab("webhooks")}
                >
                  Open webhooks
                </button>
              )}
          </footer>
        </aside>
      </div>

      {!panelOpen
        ? (
          <button
            class="inspector-trigger"
            type="button"
            onClick={() => setPanelOpen(true)}
            aria-label="Open the payment inspector"
          >
            <span class="inspector-trigger__label">Inspector</span>
            {callbacks.length
              ? (
                <span class="inspector-trigger__count" title="Callbacks captured so far">
                  {callbacks.length}
                </span>
              )
              : null}
          </button>
        )
        : null}
    </>
  );
}
