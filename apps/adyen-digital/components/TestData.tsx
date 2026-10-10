import { ALT_METHODS, KLARNA_DOCS, TEST_CARDS } from "@suite/ui/testData.ts";
import { useCopy } from "@suite/ui/useCopy.ts";

// The digital flows also need a card that always asks for a 3DS2 challenge.
const CARDS = [
  ...TEST_CARDS.slice(0, 1),
  {
    scheme: "Visa",
    note: "3DS2 challenge",
    pan: "4917 6100 0000 0000",
    expiry: "03/30",
    cvc: "737",
  },
  ...TEST_CARDS.slice(1),
];

const LINKS = [
  {
    href:
      "https://docs.adyen.com/development-resources/test-cards-and-credentials/test-card-numbers",
    label: "All test card numbers",
  },
  {
    href:
      "https://docs.adyen.com/development-resources/test-cards-and-credentials/alternative-payment-method-credentials",
    label: "Alternative payment method credentials",
  },
  { href: KLARNA_DOCS, label: "Klarna sample shoppers" },
];

/** Adyen TEST credentials, one tap to copy. Content of the checkout's test-data sheet. */
export function TestData() {
  const { copied, copy } = useCopy();
  return (
    <div class="test-data-list">
      <p class="sheet__note">
        Expiry 03/30 works for every card. The 3DS2 simulator asks for the word
        <code>password</code>.
      </p>
      <h3>Cards</h3>
      <div class="copy-list">
        {CARDS.map((card) => (
          <button
            type="button"
            class="copy-row"
            key={card.pan}
            onClick={() => copy(card.pan)}
            title={`Copy ${card.pan}`}
          >
            <span class="copy-row__main">
              <span class="copy-row__title">
                {card.scheme}
                {card.note ? <span class="copy-row__note">{card.note}</span> : null}
              </span>
              <span class="copy-row__value">{card.pan}</span>
            </span>
            <span class="copy-row__side">
              <span>CVC {card.cvc}</span>
              <span class="copy-row__action">{copied === card.pan ? "Copied" : "Copy"}</span>
            </span>
          </button>
        ))}
      </div>
      <h3>Other methods</h3>
      <div class="copy-list">
        {ALT_METHODS.filter((method) => method.value).map((method) => (
          <button
            type="button"
            class="copy-row"
            key={`${method.name}-${method.note ?? ""}`}
            onClick={() => copy(method.value as string)}
          >
            <span class="copy-row__main">
              <span class="copy-row__title">
                {method.name}
                {method.note ? <span class="copy-row__note">{method.note}</span> : null}
              </span>
              <span class="copy-row__value">{method.value}</span>
            </span>
            <span class="copy-row__side">
              {method.detail ? <span>{method.detail}</span> : null}
              <span class="copy-row__action">{copied === method.value ? "Copied" : "Copy"}</span>
            </span>
          </button>
        ))}
      </div>
      <p class="sheet__note">
        Apple Pay and PayPal need your own sandbox accounts.
      </p>
      <h3>References</h3>
      <ul class="link-list">
        {LINKS.map((link) => (
          <li key={link.href}>
            <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
