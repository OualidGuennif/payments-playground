import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

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

export function TestBanner() {
  return (
    <div class="test-banner" role="note" aria-label="Test environment warning">
      <span class="test-badge">TEST</span>
      <span>
        Test environment only, never use production credentials or live endpoints.
      </span>
    </div>
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

const PRIMARY_NAV = [
  { href: "/", label: "Home" },
  { href: "/back-office", label: "Back Office" },
  { href: "/wiki", label: "Wiki" },
] as const;

export function AppShell(props: {
  title: string;
  subtitle: string;
  currentPath: string;
  children: ComponentChildren;
  compact?: boolean;
  /** Set when the page renders <TestDataAndTools /> itself. */
  ownTestingDataset?: boolean;
}) {
  return (
    <>
      <a class="skip-link" href="#main-content">Skip to content</a>
      <div class="app-chrome">
        <header class="app-header">
          <div class="app-header__top">
            <a class="brand" href="/" aria-label={props.title}>
              <PlaygroundWordmark label={props.title} />
            </a>
            <nav class="app-nav-inline" aria-label="Main navigation">
              {PRIMARY_NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={props.currentPath === item.href ? "page" : undefined}
                >
                  {item.label}
                </a>
              ))}
              <a href="https://docs.adyen.com" target="_blank" rel="noopener noreferrer">
                Documentation
              </a>
            </nav>
            <div class="app-header__actions">
              <span class="environment-state">
                <span aria-hidden="true" />
                TEST connected
              </span>
              {
                /* Apps with their own market selector render this next to it
                  instead, so it sits with the things it relates to. */
              }
              {props.ownTestingDataset ? null : <TestDataAndTools />}
              <a class="button button--quiet button--small" href="/settings">Settings</a>
            </div>
          </div>
        </header>
        <TestBanner />
      </div>
      <div class={props.compact ? "app-frame app-frame--compact" : "app-frame"}>
        <div class="app-content">
          <main id="main-content" tabindex={-1}>{props.children}</main>
          <footer class="app-footer">
            <span>© 2026 Payments Playground · TEST environment only</span>
            <span>
              {props.subtitle} · Adyen Web 6.46.0 · Checkout API v72 ·{" "}
              <a href="/disclaimer">Disclaimer</a>
            </span>
          </footer>
        </div>
      </div>
    </>
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
