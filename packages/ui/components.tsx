// Spec: knowledge/components/ui-package.md
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { THEME_SCRIPT } from "./theme.ts";

interface TestDataLink {
  href: string;
  label: string;
  /** Nothing on a phone can install a Chrome extension. */
  needsExtensions?: boolean;
}

const TEST_DATA_LINKS: TestDataLink[] = [
  {
    href:
      "https://chromewebstore.google.com/detail/adyen-test-cards/icllkfleeahmemjgoibajcmeoehkeoag",
    label: "Card dataset (Chrome extension)",
    needsExtensions: true,
  },
  {
    href:
      "https://docs.adyen.com/development-resources/test-cards-and-credentials/test-card-numbers",
    label: "Card dataset (Adyen docs)",
  },
  {
    href:
      "https://docs.adyen.com/development-resources/test-cards-and-credentials/alternative-payment-method-credentials",
    label: "Alt. payment dataset (Adyen docs)",
  },
  {
    href:
      "https://docs.klarna.com/resources/developer-tools/sample-data/sample-customer-data/#all-countries",
    label: "Klarna dataset (phone numbers)",
  },
];

/**
 * A Chrome Web Store listing is dead weight on a touch device: nothing there
 * can install an extension. Dropped with a media query rather than a hook,
 * because this menu also renders outside islands, where nothing hydrates.
 */
const EXTENSION_LINK_CSS =
  "@media (pointer: coarse), (max-width: 760px) { .header-tools__menu a[data-needs-extensions] { display: none; } }";

export function TestDataAndTools() {
  return (
    <>
      <style>{EXTENSION_LINK_CSS}</style>
      <details class="header-tools">
        <summary class="header-tools__toggle">Testing dataset</summary>
        <div class="header-tools__menu">
          {TEST_DATA_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              data-needs-extensions={link.needsExtensions ? "" : undefined}
            >
              {link.label}
            </a>
          ))}
        </div>
      </details>
    </>
  );
}

/**
 * The same text as the repository's disclaimer, served by the site itself.
 *
 * Anyone who reaches a deployed playground sees a working checkout, real
 * payment methods and an Adyen wordmark; nothing on screen otherwise says it is
 * a test harness rather than a product, or who carries the obligations if they
 * copy it. A link in a README does not reach them, this page does. Every app
 * mounts it at /disclaimer.
 */
export function DisclaimerPage(props: { appName: string; repositoryUrl?: string }) {
  return (
    <article class="legal">
      <h1>Disclaimer</h1>
      <p class="legal__lede">
        <strong>{props.appName}</strong>{" "}
        is a playground for exploring and testing Adyen integrations against the Adyen{" "}
        <strong>TEST</strong>{" "}
        environment. It is not a product, not a reference or certified integration, and it is not
        intended to be deployed to production as it stands.
      </p>

      <h2>No real money, no real cards</h2>
      <p>
        Every endpoint and credential here targets Adyen TEST. No payment made in this playground
        moves money, and no real card details are collected: card fields are rendered by Adyen
        inside their own iframes and never reach this application.
      </p>

      <h2>Not an Adyen product</h2>
      <p>
        This is an independent project. It is not built, reviewed, endorsed or supported by Adyen,
        and it is not covered by any Adyen support agreement or service level.{" "}
        <a href="https://docs.adyen.com/" target="_blank" rel="noopener noreferrer">
          Adyen's own documentation
        </a>{" "}
        and Customer Area are the authoritative sources; wherever they and this application
        disagree, Adyen is right.
      </p>

      <h2>If you reuse any of it</h2>
      <p>
        You alone remain responsible for your own payment stack. That includes, without limitation:
      </p>
      <ul>
        <li>PCI DSS scope, obligations and validation for your integration</li>
        <li>regulatory compliance, including PSD2/SCA, consumer protection, tax and local rules</li>
        <li>security review, penetration testing, secret management, access control, monitoring</li>
        <li>data protection and privacy, including GDPR for any personal data you process</li>
        <li>correctness, availability and error handling of your own payment flows</li>
        <li>your agreements with Adyen and with every payment method you enable</li>
      </ul>
      <p>
        Nothing in this application reduces those obligations, and no control in its code should be
        relied on as a compliance measure.
      </p>

      <h2>No warranty, no liability</h2>
      <p>
        Provided{" "}
        <strong>as is</strong>, without warranty of any kind, under the MIT Licence. The authors
        accept no liability for any claim, damage, financial loss, chargeback, outage, regulatory
        penalty or other consequence arising from its use, in test or in production.
      </p>

      {props.repositoryUrl
        ? (
          <p class="legal__source">
            Source and full terms:{" "}
            <a href={props.repositoryUrl} target="_blank" rel="noopener noreferrer">
              {props.repositoryUrl.replace(/^https?:\/\//, "")}
            </a>
          </p>
        )
        : null}
    </article>
  );
}

/** Inline in every app's <head>, before any stylesheet paints. */
export function ThemeScript() {
  // A constant written in this repo, never user input. As a text child it
  // would be HTML-escaped by the server renderer and stop being JavaScript.
  // deno-lint-ignore react-no-danger
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}

/**
 * The light/dark switch. Its position and aria-checked come from the theme
 * script, not from props, so it is correct on first paint and needs no island.
 */
export function ThemeToggle() {
  return (
    <button
      type="button"
      class="theme-toggle"
      role="switch"
      data-theme-toggle
      aria-label="Dark mode"
      title="Dark mode"
    >
      <span class="theme-toggle__track" aria-hidden="true">
        <span class="theme-toggle__thumb">
          <svg class="theme-toggle__sun" viewBox="0 0 24 24" width="14" height="14">
            <circle cx="12" cy="12" r="4.2" fill="currentColor" />
            <path
              d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
          <svg class="theme-toggle__moon" viewBox="0 0 24 24" width="14" height="14">
            <path
              d="M20.3 14.6A8.5 8.5 0 0 1 9.4 3.7a8.5 8.5 0 1 0 10.9 10.9z"
              fill="currentColor"
            />
          </svg>
        </span>
      </span>
    </button>
  );
}

/**
 * Always on screen, on every page and every width: a screenshot of these
 * playgrounds must never be mistakable for a live checkout.
 */
export function TestPill() {
  return (
    <span
      class="env-pill"
      title="Test environment only, never use production credentials or live endpoints."
    >
      TEST
    </span>
  );
}

/**
 * The playgrounds' own mark, not Adyen's.
 *
 * A logo in a site's header is a claim of identity, not a description of what
 * the site talks about, "Adyen" beside a "DEMOS" chip reads as an Adyen
 * product line, which is exactly the impression these are not entitled to
 * give. Adyen still appears wherever it is genuinely descriptive: the SDK
 * version, links to their docs, and the payment-method logos the SDK renders
 * itself.
 */
export function PlaygroundWordmark(props: { label: string }) {
  return (
    <span class="wordmark">
      <span class="wordmark__dot" aria-hidden="true" />
      <span class="wordmark__text">{props.label}</span>
    </span>
  );
}

const NAV = [
  { href: "/", label: "Home" },
  { href: "/back-office", label: "Back Office" },
] as const;

const DOCS_URL = "https://docs.adyen.com";

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zm8.1-2.3.1-.9-.1-.9 2-1.6-2-3.4-2.4.9a7.6 7.6 0 0 0-1.6-.9L15.7 3h-3.9l-.4 2.5c-.6.2-1.1.5-1.6.9l-2.4-.9-2 3.4 2 1.6-.1.9.1.9-2 1.6 2 3.4 2.4-.9c.5.4 1 .7 1.6.9l.4 2.5h3.9l.4-2.5c.6-.2 1.1-.5 1.6-.9l2.4.9 2-3.4z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function AppShell(props: {
  title: string;
  currentPath: string;
  children: ComponentChildren;
  compact?: boolean;
  /**
   * Header with only the theme toggle and settings, plus Home and Back Office
   * on inner pages; the TEST pill moves to the footer. Digital's front page is
   * its navigation, so a name and section links there only repeated it
   * (owner, 2026-10-10).
   */
  minimal?: boolean;
}) {
  const current = (href: string) => props.currentPath === href ? "page" : undefined;
  return (
    <>
      <a class="skip-link" href="#main-content">Skip to content</a>
      {props.minimal
        ? <MinimalHeader currentPath={props.currentPath} />
        : (
          <header class="shell-header">
            <div class="shell-header__bar">
              <div class="shell-header__start">
                <a class="brand" href="/" aria-label={props.title}>
                  <PlaygroundWordmark label={props.title} />
                </a>
                <TestPill />
              </div>
              <nav class="shell-nav" aria-label="Main navigation">
                {NAV.map((item) => (
                  <a key={item.href} href={item.href} aria-current={current(item.href)}>
                    {item.label}
                  </a>
                ))}
              </nav>
              <div class="shell-header__actions">
                <TestDataAndTools />
                <ThemeToggle />
                <a
                  class="shell-icon-button shell-settings"
                  href="/settings"
                  aria-label="Settings"
                  title="Settings"
                  aria-current={current("/settings")}
                >
                  <GearIcon />
                </a>
                <details class="shell-menu">
                  <summary class="shell-icon-button" aria-label="Menu">
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                      <path
                        d="M4 8h16M4 16h16"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                      />
                    </svg>
                  </summary>
                  <nav class="shell-menu__sheet" aria-label="Menu">
                    {NAV.map((item) => (
                      <a key={item.href} href={item.href} aria-current={current(item.href)}>
                        {item.label}
                      </a>
                    ))}
                    <a href="/settings" aria-current={current("/settings")}>Settings</a>
                    <a href="/wiki" aria-current={current("/wiki")}>Wiki</a>
                    <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">Adyen docs ↗</a>
                  </nav>
                </details>
              </div>
            </div>
          </header>
        )}
      <div class={props.compact ? "app-frame app-frame--compact" : "app-frame"}>
        <div class="app-content">
          <main id="main-content" tabindex={-1}>{props.children}</main>
          <footer class={props.minimal ? "app-footer app-footer--wide" : "app-footer"}>
            <span class="app-footer__meta">
              {props.minimal ? <TestPill /> : null}
              Adyen Web 6.47.0 · Checkout API v72
            </span>
            <nav class="app-footer__links" aria-label="Footer">
              <a href="/wiki" aria-current={current("/wiki")}>Wiki</a>
              <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">Adyen docs ↗</a>
              <a href="/disclaimer" aria-current={current("/disclaimer")}>Disclaimer</a>
            </nav>
          </footer>
        </div>
      </div>
    </>
  );
}

function MinimalHeader(props: { currentPath: string }) {
  return (
    <header class="shell-header shell-header--minimal">
      <div class="shell-float">
        {props.currentPath === "/"
          ? <span />
          : (
            <nav class="shell-glass shell-nav" aria-label="Main navigation">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={props.currentPath === item.href ? "page" : undefined}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          )}
        <div class="shell-glass">
          <ThemeToggle />
          <a
            class="shell-icon-button"
            href="/settings"
            aria-label="Settings"
            title="Settings"
            aria-current={props.currentPath === "/settings" ? "page" : undefined}
          >
            <GearIcon />
          </a>
        </div>
      </div>
    </header>
  );
}

export function PageHeader(props: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ComponentChildren;
}) {
  return (
    <header class="page-header">
      <div>
        {props.eyebrow ? <span class="eyebrow">{props.eyebrow}</span> : null}
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      {props.actions ? <div class="page-actions">{props.actions}</div> : null}
    </header>
  );
}

export function StatusPill(props: {
  children: ComponentChildren;
  tone?: "neutral" | "positive" | "warning" | "danger" | "info";
}) {
  return <span class={`status-pill status-pill--${props.tone ?? "neutral"}`}>{props.children}
  </span>;
}

export function EmptyState(props: {
  title: string;
  description: string;
  children?: ComponentChildren;
}) {
  return (
    <div class="empty-state">
      <span class="empty-state__icon" aria-hidden="true">◎</span>
      <h2>{props.title}</h2>
      <p>{props.description}</p>
      {props.children}
    </div>
  );
}

export function Field(props: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ComponentChildren;
}) {
  return (
    <div class="field">
      <label for={props.htmlFor}>{props.label}</label>
      {props.children}
      {props.hint ? <small>{props.hint}</small> : null}
    </div>
  );
}

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Native <input type="color"> has no way to type/paste a hex value directly ,
// pairs it with a text input kept in sync both ways, so the text field always
// reflects the live color (not some unrelated default) and only pushes
// upstream once the typed value is a valid hex, so a half-typed value doesn't
// blank out the swatch.
export function ColorField(
  props: { label: string; htmlFor: string; value: string; onChange: (value: string) => void },
) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <div class="field">
      <label for={props.htmlFor}>{props.label}</label>
      <div class="color-field">
        <input
          id={props.htmlFor}
          type="color"
          value={props.value}
          onInput={(event) => {
            const next = event.currentTarget.value;
            setText(next);
            props.onChange(next);
          }}
        />
        <input
          type="text"
          class="color-field__hex"
          value={text}
          spellcheck={false}
          maxLength={7}
          aria-label={`${props.label} hex value`}
          onInput={(event) => {
            const next = event.currentTarget.value;
            setText(next);
            if (HEX_PATTERN.test(next)) props.onChange(next);
          }}
        />
      </div>
    </div>
  );
}

export function Callout(props: {
  title: string;
  children: ComponentChildren;
  tone?: "info" | "warning" | "danger";
  compact?: boolean;
}) {
  return (
    <aside
      class={`callout callout--${props.tone ?? "info"}${props.compact ? " callout--compact" : ""}`}
      role="note"
    >
      <strong>{props.title}</strong>
      <div>{props.children}</div>
    </aside>
  );
}
