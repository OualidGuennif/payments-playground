import { AdyenCheckout, Dropin } from "@adyen/adyen-web";
import type { Core } from "@adyen/adyen-web";
import { apiFetch } from "@suite/ui/client.ts";
import { ThemeToggle } from "@suite/ui/components.tsx";
import { OptionRow } from "../components/OptionFields.tsx";
import { localeForCountry } from "@suite/platform/markets.ts";
import { INSTALLMENT_COUNTRIES, isNonFatalWalletError } from "@suite/ui/paymentMethods.ts";
import "@suite/ui/registerPaymentMethods.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { TestCards } from "../components/TestCards.tsx";
import { ComponentsPanel, FieldStylesPanel, ThemePanel } from "../components/styling-panels.tsx";
import {
  cardDefaultsFor,
  COUNTRIES,
  DEFAULT_OPEN_GROUPS,
  detectInitialCountry,
  flagEmoji,
  LOCALES,
} from "../components/styling-data.ts";
import type {
  AvailableMethod,
  Bootstrap,
  Mounted,
  SessionResponse,
} from "../components/styling-data.ts";
import { clearStored, STORAGE_KEY, stored } from "../components/styling-persistence.ts";
import type { Persisted } from "../components/styling-persistence.ts";
import {
  cssPreviewVariables,
  cssText,
  cssTokenSetCount,
  cssTokenSpec,
  DEFAULT_CSS_RULES,
  DEFAULT_NATIVE,
  DEFAULT_SECURE,
  DEFAULT_WALLETS,
  dropinProps,
  THEME_PRESETS,
  themeSignature,
} from "../components/adyenOptions.ts";
import type {
  CardOptions,
  CssRules,
  CssTokens,
  InstantPaymentType,
  NativeOptions,
  PlaceholderKey,
  SecureProperty,
  SecureState,
  SecureStyles,
  WalletOptions,
} from "../components/adyenOptions.ts";

function ResetIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12a9 9 0 1 0 3.5-7.1M3 4v5h5"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export default function StylingPlayground() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [session, setSession] = useState<SessionResponse | null>(null);
  // Each restores over its defaults rather than replacing them, so a blob
  // written before an option existed still yields a complete object.
  const [secureStyles, setSecureStyles] = useState<SecureStyles>(
    () => ({ ...DEFAULT_SECURE, ...(stored()?.secureStyles ?? {}) }),
  );
  const [secureState, setSecureState] = useState<SecureState>("base");
  const [cssTokens, setCssTokens] = useState<CssTokens>(() => stored()?.cssTokens ?? {});
  const [cssRules, setCssRules] = useState<CssRules>(
    () => ({ ...DEFAULT_CSS_RULES, ...(stored()?.cssRules ?? {}) }),
  );
  const [nativeOptions, setNativeOptions] = useState<NativeOptions>(
    () => ({ ...DEFAULT_NATIVE, ...(stored()?.nativeOptions ?? {}) }),
  );
  const [walletOptions, setWalletOptions] = useState<WalletOptions>(
    () => ({ ...DEFAULT_WALLETS, ...(stored()?.walletOptions ?? {}) }),
  );
  const [cardOptions, setCardOptions] = useState<CardOptions>(
    () => ({
      ...cardDefaultsFor(stored()?.country ?? detectInitialCountry()),
      ...(stored()?.cardOptions ?? {}),
    }),
  );
  // Guessed from the browser's own language preferences on first render, so a
  // Dutch or Japanese visitor lands on their own market instead of a fixed
  // one. Server-side there is no navigator, so the shared European fallback
  // is rendered and the guess is applied on hydration.
  const [country, setCountry] = useState(() => stored()?.country ?? detectInitialCountry());
  const [locale, setLocale] = useState(() =>
    stored()?.locale ?? localeForCountry(stored()?.country ?? detectInitialCountry())
  );
  const [localeManual, setLocaleManual] = useState(() => stored()?.localeManual ?? false);
  const [availableMethods, setAvailableMethods] = useState<AvailableMethod[]>([]);
  const [section, setSection] = useState<"styling" | "configuration" | "css">(
    () => stored()?.section ?? "configuration",
  );
  const [openGroups, setOpenGroups] = useState(DEFAULT_OPEN_GROUPS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successFlash, setSuccessFlash] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Core-level, not a Dropin prop, so changing it rebuilds the Core rather
  // than re-instantiating the element against the existing one.
  const [showDonation, setShowDonation] = useState(() => stored()?.showDonation ?? true);
  // A session that has been paid on. Adyen's own final screen (and the
  // donation step after it, where the account has Adyen Giving on) tears its
  // container down when it ends, leaving an empty box with no way forward.
  const [completed, setCompleted] = useState(false);
  // What Adyen Giving reported, when the account has it on. Null until the
  // donation step actually resolves, the two outcomes look identical from
  // the checkout otherwise, and a failed donation is easy to miss entirely.
  const [donation, setDonation] = useState<"donated" | "skipped" | "failed" | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted | null>(null);
  // Persisted so most option changes can be applied by re-instantiating just
  // the Dropin element, no need to rebuild the whole Core / hit /sessions.
  const checkoutRef = useRef<Core | null>(null);
  // The country/locale refresh (async, hits /sessions) and the lightweight
  // native/style remount (near-instant) can overlap, dragging a slider right
  // after switching country, for instance. Each mount reserves the next
  // token and any mount whose token has since been superseded discards
  // itself instead of clobbering a newer one, which is what caused the
  // Drop-in to visibly flicker/remount on its own.
  const mountToken = useRef(0);
  // Adyen sessions are single-use: once a payment completes on one, mounting
  // it again fails with "The provided session identifier or data is invalid".
  const sessionSpent = useRef(false);
  const generatedCss = useMemo(
    () => cssText(cssTokens, cssRules, walletOptions),
    [cssTokens, cssRules, walletOptions],
  );
  const previewVariables = useMemo(() => cssPreviewVariables(cssTokens), [cssTokens]);
  const tokenOverrides = cssTokenSetCount(cssTokens);

  useEffect(() => {
    initialize().catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Drop-in initialization failed.");
      setLoading(false);
    });
    return () => mounted.current?.unmount();
  }, []);

  // countryCode and shopperLocale are baked into the session at creation
  // time server-side, so changing either has to fetch a fresh /sessions
  // (not just rebuild the Core against the old one). Debounced so flipping
  // through the dropdowns doesn't refetch on every change.
  const skipFirstAutoRefresh = useRef(true);
  useEffect(() => {
    if (skipFirstAutoRefresh.current) {
      skipFirstAutoRefresh.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      refreshSession().catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Session refresh failed.")
      );
    }, 400);
    return () => clearTimeout(timeout);
  }, [country, locale, showDonation]);

  // Written on every change rather than on unload: a tab closed from the OS,
  // or a crash, never gets an unload handler, and losing an afternoon of
  // theming to that is exactly what this is for.
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(
        STORAGE_KEY,
        JSON.stringify(
          {
            country,
            locale,
            localeManual,
            section,
            secureStyles,
            cssTokens,
            cssRules,
            nativeOptions,
            cardOptions,
            walletOptions,
            showDonation,
          } satisfies Persisted,
        ),
      );
    } catch {
      // Storage can be unavailable or full; the playground still works.
    }
  }, [
    country,
    locale,
    localeManual,
    section,
    secureStyles,
    cssTokens,
    cssRules,
    nativeOptions,
    cardOptions,
    walletOptions,
    showDonation,
  ]);

  // Secure-field styles, native Drop-in options and card component options are
  // all Dropin-construction props, none of them need a new Core / /sessions
  // call, only re-instantiating the Dropin element against the existing Core.
  // Debounced so dragging a slider doesn't remount on every tick.
  const skipFirstNativeRefresh = useRef(true);
  useEffect(() => {
    if (skipFirstNativeRefresh.current) {
      skipFirstNativeRefresh.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      remountDropinOnly().catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Remount failed.")
      );
    }, 400);
    return () => clearTimeout(timeout);
  }, [secureStyles, nativeOptions, cardOptions, walletOptions]);

  // Side lookup only, populates the pre-select dropdown with this
  // merchant's real payment methods for the chosen country. Independent of
  // the /sessions call the preview actually uses. It waits for bootstrap,
  // which issues the CSRF cookie: on a first visit it used to run first and
  // be refused, leaving the dropdown empty.
  useEffect(() => {
    if (!bootstrap) return;
    apiFetch<{ paymentMethods: AvailableMethod[] }>("/api/styling/payment-methods", {
      method: "POST",
      body: JSON.stringify({ countryCode: country }),
    })
      .then((response) => setAvailableMethods(response.paymentMethods))
      .catch(() => setAvailableMethods([]));
  }, [country, bootstrap]);

  async function initialize() {
    const boot = await apiFetch<Bootstrap>("/api/bootstrap");
    setBootstrap(boot);
    if (!boot.clientKey || !boot.profile.isConfigured) {
      throw new Error(
        `Complete the default server profile: ${boot.profile.missingFields.join(", ")}.`,
      );
    }
    const created = await apiFetch<SessionResponse>("/api/styling/session", {
      method: "POST",
      body: JSON.stringify({
        countryCode: country,
        shopperLocale: locale,
        installments: INSTALLMENT_COUNTRIES.includes(country.toUpperCase()),
      }),
    });
    setSession(created);
    await mountDropin(boot, created, country, locale);
    setLoading(false);
  }

  // Fetches a brand-new session carrying the current country/locale, then
  // rebuilds the Core against it, used whenever either changes.
  async function refreshSession(countryCode = country, shopperLocale = locale) {
    if (!bootstrap?.clientKey) return;
    setLoading(true);
    try {
      const created = await apiFetch<SessionResponse>("/api/styling/session", {
        method: "POST",
        body: JSON.stringify({
          countryCode,
          shopperLocale,
          installments: INSTALLMENT_COUNTRIES.includes(countryCode.toUpperCase()),
        }),
      });
      setSession(created);
      await mountDropin(bootstrap, created, countryCode, shopperLocale);
    } finally {
      setLoading(false);
    }
  }

  async function mountDropin(
    boot = bootstrap,
    currentSession = session,
    countryCode = country,
    shopperLocale = locale,
  ) {
    if (!boot?.clientKey || !currentSession || !host.current) return;
    const token = ++mountToken.current;
    const checkout = await AdyenCheckout({
      environment: "test",
      clientKey: boot.clientKey,
      session: currentSession.session,
      countryCode,
      locale: shopperLocale,
      analytics: { enabled: false },
      onPaymentCompleted: () => {
        sessionSpent.current = true;
        setCompleted(true);
      },
      onPaymentFailed: () => undefined,
      // autoMount is what decides whether the Donation component appears after
      // a payment at all; the two callbacks are required alongside it. Both
      // outcomes leave the session spent, which the notice already says.
      donation: {
        autoMount: showDonation,
        onDonationSuccess: ({ didDonate }: { didDonate: boolean }) =>
          setDonation(didDonate ? "donated" : "skipped"),
        // Not fatal, the payment already went through, so this reports rather
        // than raising the error banner over a completed checkout.
        onDonationFailure: () => setDonation("failed"),
      },
      // Swapping the method list for a 3DS challenge changes the host's
      // height, and on a phone, where the dataset sits above the Drop-in ,
      // that leaves the challenge scrolled off screen. Bring it back into
      // view once Adyen has actually rendered the action.
      onActionHandled: () => revealDropin(),
      onError: (cause: Error) => {
        if (isNonFatalWalletError(cause)) return;
        setError(cause.message);
      },
    } as never);
    // A newer mount was requested while this session/Core was being built ,
    // discard this one instead of stomping over the one that superseded it.
    if (mountToken.current !== token) return;
    checkoutRef.current = checkout as Core;
    // Cleared here rather than at the top of this function: the flag describes
    // checkoutRef, so until the new Core is actually installed the one still
    // in there is the spent one. Clearing it early let a remount arriving
    // mid-build mount the dead Core and bump the token, which then made this
    // fresh Core discard itself, a reset that visibly did nothing.
    sessionSpent.current = false;
    setCompleted(false);
    setDonation(null);
    mountDropinElement(checkout as Core, token);
  }

  function mountDropinElement(
    checkout: Core,
    token = ++mountToken.current,
    native = nativeOptions,
    styles = secureStyles,
    card = cardOptions,
    countryCode = country,
    wallets = walletOptions,
  ) {
    if (!host.current || mountToken.current !== token) return;
    mounted.current?.unmount();
    host.current.replaceChildren();
    const dropin = new Dropin(checkout, dropinProps(native, styles, card, countryCode, wallets));
    dropin.mount(host.current);
    mounted.current = dropin;
  }

  async function remountDropinOnly() {
    // A session Adyen has already taken a payment on can't be mounted again,
    // so once one is spent every remount has to start from a fresh session
    // instead of reusing the existing Core.
    if (sessionSpent.current || !checkoutRef.current) {
      await refreshSession();
      return;
    }
    mountDropinElement(checkoutRef.current);
  }

  function updateSecure(property: SecureProperty, value: string) {
    setSecureStyles((current) => ({
      ...current,
      [secureState]: { ...current[secureState], [property]: value },
    }));
  }

  function updateToken(token: string, value: string) {
    setCssTokens((current) => ({ ...current, [token]: value }));
  }

  function updateRule<K extends keyof CssRules>(key: K, value: CssRules[K]) {
    setCssRules((current) => ({ ...current, [key]: value }));
  }

  function updateNative<K extends keyof NativeOptions>(key: K, value: NativeOptions[K]) {
    setNativeOptions((current) => ({ ...current, [key]: value }));
  }

  function updateCard<K extends keyof CardOptions>(key: K, value: CardOptions[K]) {
    setCardOptions((current) => ({ ...current, [key]: value }));
  }

  // Derived rather than stored: a theme is a set of values, so the honest way
  // to know which one you are on is to compare. Edit anything afterwards and
  // this falls to "custom" on its own, with no flag to keep in sync.
  const activeTheme = useMemo(() => {
    const current = themeSignature(secureStyles, cssTokens, walletOptions, showDonation);
    return THEME_PRESETS.find((preset) =>
      themeSignature(preset.secure, preset.tokens, preset.wallets, preset.showDonation) === current
    )?.id ?? "custom";
  }, [secureStyles, cssTokens, walletOptions, showDonation]);

  /** Themes own the look only, Drop-in behaviour and card fields are left. */
  function applyTheme(id: string) {
    const preset = THEME_PRESETS.find((entry) => entry.id === id);
    if (!preset) return;
    setSecureStyles(preset.secure);
    setCssTokens(preset.tokens);
    // A preset never ships class-name rules, so any left over from before
    // would quietly survive into a theme that does not want them.
    setCssRules(DEFAULT_CSS_RULES);
    setWalletOptions(preset.wallets);
    setShowDonation(preset.showDonation);
  }

  function updateWallet<K extends keyof WalletOptions>(key: K, value: WalletOptions[K]) {
    setWalletOptions((current) => ({ ...current, [key]: value }));
  }

  function updatePlaceholder(key: PlaceholderKey, value: string) {
    setCardOptions((current) => ({
      ...current,
      placeholders: { ...current.placeholders, [key]: value },
    }));
  }

  function toggleInstantPaymentType(type: InstantPaymentType, enabled: boolean) {
    setNativeOptions((current) => ({
      ...current,
      instantPaymentTypes: enabled
        ? [...current.instantPaymentTypes, type]
        : current.instantPaymentTypes.filter((entry) => entry !== type),
    }));
  }

  function updateCountry(nextCountry: string) {
    setCountry(nextCountry);
    if (!localeManual) setLocale(localeForCountry(nextCountry));
    // Installments only exist on BR/MX/JP, so showing the per-installment
    // amount is on by default there and off everywhere else. Switching market
    // re-derives it rather than stranding a toggle from the previous country;
    // it stays manually overridable for the market you're on.
    updateCard("showInstallmentAmounts", INSTALLMENT_COUNTRIES.includes(nextCountry));
  }

  function updateLocale(nextLocale: string) {
    setLocaleManual(true);
    setLocale(nextLocale);
  }

  /**
   * Scrolls the Drop-in back under the viewport top. Only does anything on the
   * stacked (phone) layout, where the host can leave the screen; on the
   * side-by-side layout it is already in view and moving the page would be
   * the more surprising behaviour.
   */
  function revealDropin() {
    if (typeof globalThis.matchMedia !== "function") return;
    if (!globalThis.matchMedia("(max-width: 900px)").matches) return;
    // Let Adyen finish swapping the DOM before measuring where it landed.
    requestAnimationFrame(() => {
      host.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function flashSuccess() {
    setSuccessFlash(true);
    setTimeout(() => setSuccessFlash(false), 2500);
  }

  function reset() {
    setConfirmingReset(false);
    clearStored();
    setSecureStyles(DEFAULT_SECURE);
    setCssTokens({});
    setCssRules(DEFAULT_CSS_RULES);
    setNativeOptions(DEFAULT_NATIVE);
    setCardOptions(cardDefaultsFor(country));
    setWalletOptions(DEFAULT_WALLETS);
    setShowDonation(true);
    setError(null);
    flashSuccess();
    // A fresh session, not a remount of the current one: an Adyen session is
    // single-use, so once a payment has gone through, reusing it fails with
    // "The provided session identifier or data is invalid". Reset is meant to
    // hand back a checkout you can pay with again.
    refreshSession().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Reset failed.")
    );
  }

  // Escape closes the confirmation, which is what every dialog on the platform
  // does and the only keyboard way out of one rendered outside <dialog>.
  useEffect(() => {
    if (!confirmingReset) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirmingReset(false);
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [confirmingReset]);

  /** Puts a payable checkout back after a completed payment. */
  function startNewPayment() {
    setError(null);
    refreshSession().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Could not start a new payment.")
    );
  }

  function selectSection(next: "styling" | "configuration" | "css") {
    setSection(next);
  }

  function groupOpen(key: string): boolean {
    return openGroups[key] === true;
  }

  function setGroupOpen(key: string, open: boolean) {
    setOpenGroups((current) => ({ ...current, [key]: open }));
  }

  return (
    <>
      <style>{generatedCss}</style>
      {error
        ? (
          <div class="callout callout--danger" role="alert">
            <strong>Configuration error</strong>
            <div>{error}</div>
          </div>
        )
        : null}
      <div class="styling-layout">
        {
          /* Dark mode darkens the tool around the checkout: this canvas and the
            test data. The Drop-in column alone keeps the light tokens, so the
            checkout shows exactly what the merchant configured. */
        }
        <section class="styling-preview" style={previewVariables}>
          {
            /* Four blocks of one height: the shopper's country and locale, the
              theme preset, and the light/dark switch. They sit in the preview
              column so their edges are the checkout's and the test data's; the
              name and SDK version moved to the footer (owner, 2026-10-10). */
          }
          <div class="styling-toolbar">
            <label class="toolbar-field">
              <span class="toolbar-field__label">Country</span>
              <select
                id="preview-country"
                aria-label="Checkout market"
                value={country}
                onChange={(event) => updateCountry(event.currentTarget.value)}
              >
                {COUNTRIES.map(([code, name]) => (
                  <option value={code}>
                    {flagEmoji(code)} {name}
                  </option>
                ))}
              </select>
            </label>
            <label class="toolbar-field">
              <span class="toolbar-field__label">Locale</span>
              <select
                id="preview-locale"
                aria-label="Shopper locale"
                value={locale}
                onChange={(event) => updateLocale(event.currentTarget.value)}
              >
                {LOCALES.map(([code, name]) => (
                  <option key={code} value={code}>{name} ({code})</option>
                ))}
              </select>
            </label>
            <label class="toolbar-field">
              <span class="toolbar-field__label">Theme</span>
              <select
                id="preview-theme"
                aria-label="Theme preset"
                title={THEME_PRESETS.find((preset) => preset.id === activeTheme)?.description ??
                  "Your own combination."}
                value={activeTheme}
                onChange={(event) => applyTheme(event.currentTarget.value)}
              >
                {THEME_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
                {
                  /* Only offered once you have edited something: it is a state
                    you can be in, not a theme you can pick. */
                }
                {activeTheme === "custom" ? <option value="custom">Custom</option> : null}
              </select>
            </label>
            {
              /* The switch alone, no caption: its sun and moon say it (owner,
                2026-10-10); screen readers get its "Dark mode" label. */
            }
            <div class="toolbar-field toolbar-field--mode">
              <ThemeToggle />
            </div>
          </div>
          <div class="dropin-column keep-light">
            {
              /* A sibling of the host, never a child: Adyen owns that node and
                calls replaceChildren on it, so anything Preact renders inside
                would be torn out from under it. */
            }
            {completed && !loading
              ? (
                <div class="dropin-done" role="status">
                  <span class="dropin-done__mark" aria-hidden="true">✓</span>
                  <div class="dropin-done__text">
                    <strong>Payment completed</strong>
                    <span>
                      {donation === "donated"
                        ? "Donation sent."
                        : donation === "skipped"
                        ? "Donation declined."
                        : donation === "failed"
                        ? "Donation failed, the payment itself went through."
                        : "Sessions are single-use."}
                    </span>
                  </div>
                  <button type="button" class="button" onClick={startNewPayment}>
                    New payment
                  </button>
                </div>
              )
              : null}
            <div
              class={`dropin-host${completed && !loading ? " dropin-host--spent" : ""}`}
              ref={host}
              aria-busy={loading}
            >
              {loading ? <div class="dropin-placeholder">Loading Adyen TEST Drop-in…</div> : null}
            </div>
          </div>
          <TestCards />
        </section>
        <aside id="styling-panel" class="styling-panel">
          {
            /* The tabs already say what this panel is, so they are the header ,
              a "Customisation" caption above them only repeated it. Reset ends
              the same row: it belongs to the panel, and this is the panel's
              one piece of chrome. */
          }
          <div class="styling-tabs">
            <div class="styling-tabs__list" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={section === "styling"}
                onClick={() => selectSection("styling")}
              >
                Field styles
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "configuration"}
                onClick={() => selectSection("configuration")}
              >
                Components
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "css"}
                onClick={() => selectSection("css")}
              >
                Theme{tokenOverrides ? ` (${tokenOverrides})` : ""}
              </button>
            </div>
            <button
              class={`styling-reset${successFlash ? " styling-reset--success" : ""}`}
              type="button"
              title="Reset every option to the Adyen default"
              aria-label="Reset every option to the Adyen default"
              onClick={() => setConfirmingReset(true)}
            >
              <ResetIcon />
              <span class="styling-reset__text">{successFlash ? "Done" : "Reset"}</span>
            </button>
          </div>
          {
            /* Both write CSS custom properties, so they live with the rest of
              the theme rather than standing above all three tabs, where they
              read as global controls and applied to none of the other two. */
          }
          {section === "css"
            ? (
              <div class="styling-controls styling-controls--shape">
                <OptionRow
                  id="shape-radius-s"
                  label="Small radius"
                  spec={cssTokenSpec("border-radius-s")}
                  value={cssTokens["border-radius-s"] ?? ""}
                  onChange={(value) => updateToken("border-radius-s", value)}
                />
                <OptionRow
                  id="shape-radius-m"
                  label="Medium radius"
                  spec={cssTokenSpec("border-radius-m")}
                  value={cssTokens["border-radius-m"] ?? ""}
                  onChange={(value) => updateToken("border-radius-m", value)}
                />
              </div>
            )
            : null}
          <div class="styling-controls">
            {section === "styling"
              ? (
                <FieldStylesPanel
                  secureStyles={secureStyles}
                  secureState={secureState}
                  setSecureState={setSecureState}
                  updateSecure={updateSecure}
                  cardOptions={cardOptions}
                  country={country}
                  groupOpen={groupOpen}
                  setGroupOpen={setGroupOpen}
                />
              )
              : section === "configuration"
              ? (
                <ComponentsPanel
                  nativeOptions={nativeOptions}
                  cardOptions={cardOptions}
                  walletOptions={walletOptions}
                  secureStyles={secureStyles}
                  showDonation={showDonation}
                  setShowDonation={setShowDonation}
                  availableMethods={availableMethods}
                  country={country}
                  updateNative={updateNative}
                  updateCard={updateCard}
                  updateWallet={updateWallet}
                  updatePlaceholder={updatePlaceholder}
                  toggleInstantPaymentType={toggleInstantPaymentType}
                  groupOpen={groupOpen}
                  setGroupOpen={setGroupOpen}
                />
              )
              : (
                <ThemePanel
                  cssTokens={cssTokens}
                  cssRules={cssRules}
                  tokenOverrides={tokenOverrides}
                  generatedCss={generatedCss}
                  updateToken={updateToken}
                  updateRule={updateRule}
                  setCssTokens={setCssTokens}
                  setCssRules={setCssRules}
                  groupOpen={groupOpen}
                  setGroupOpen={setGroupOpen}
                />
              )}
          </div>
        </aside>
      </div>
      {confirmingReset
        ? (
          <div
            class="confirm-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) setConfirmingReset(false);
            }}
          >
            <div
              class="confirm-card"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-reset-title"
            >
              <strong id="confirm-reset-title">Reset every option?</strong>
              <p>
                Your styles, component options and theme go back to Adyen's defaults, here and on
                your next visit. This can't be undone.
              </p>
              <div class="confirm-card__actions">
                <button
                  type="button"
                  class="button button--quiet"
                  onClick={() => setConfirmingReset(false)}
                >
                  Cancel
                </button>
                <button type="button" class="button button--danger" onClick={reset} autofocus>
                  Reset everything
                </button>
              </div>
            </div>
          </div>
        )
        : null}
    </>
  );
}
