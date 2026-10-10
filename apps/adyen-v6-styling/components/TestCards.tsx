import { useState } from "preact/hooks";
import { ALT_METHODS, KLARNA_DOCS, TEST_CARDS } from "@suite/ui/testData.ts";
import { useCopy } from "@suite/ui/useCopy.ts";

/**
 * The first four are the everyday schemes; the rest are the ones you only
 * reach for when testing a specific market or flow, so every screen starts
 * with these four and keeps the others behind "Show more".
 */
const PRIMARY_CARD_COUNT = 4;

/**
 * Test credentials sit one tap away from the Drop-in instead of behind a trip
 * to the docs. Both sections collapse on every screen, this is reference
 * material, and the checkout is what the page is about.
 */
export function TestCards() {
  // Closed is the phone's starting point, where the checkout has to come
  // first. On a desktop the cards sit beside it and cost nothing, so CSS drops
  // the bar entirely and shows them whatever this says.
  const [cardsOpen, setCardsOpen] = useState(false);
  const [altOpen, setAltOpen] = useState(false);
  const [showAllCards, setShowAllCards] = useState(false);
  const { copied, copy } = useCopy();

  const foldedAway = TEST_CARDS.length - PRIMARY_CARD_COUNT;

  return (
    <div class="test-data">
      <section
        class="test-cards test-cards--primary"
        data-open={cardsOpen ? "true" : "false"}
        data-expanded={showAllCards ? "true" : "false"}
        aria-label="Card dataset"
      >
        <button
          class="test-cards__toggle"
          type="button"
          aria-expanded={cardsOpen}
          onClick={() => setCardsOpen(!cardsOpen)}
        >
          <span>Card dataset</span>
          <span class="test-cards__chevron" aria-hidden="true">{cardsOpen ? "−" : "+"}</span>
        </button>
        <div class="test-cards__body">
          <div class="test-cards__list">
            {TEST_CARDS.map((card, index) => (
              <button
                class="test-card"
                type="button"
                key={card.pan}
                data-secondary={index >= PRIMARY_CARD_COUNT ? "true" : "false"}
                title={`Copy ${card.pan}`}
                onClick={() => copy(card.pan)}
              >
                <span class="test-card__top">
                  <span class="test-card__scheme">{card.scheme}</span>
                  {card.note ? <span class="test-card__note">{card.note}</span> : null}
                </span>
                <span class="test-card__pan">{card.pan}</span>
                <span class="test-card__bottom">
                  <span>{card.expiry}</span>
                  <span>CVC {card.cvc}</span>
                  <span class="test-card__copy">{copied === card.pan ? "Copied" : "Copy"}</span>
                </span>
              </button>
            ))}
          </div>
          <button
            class="test-cards__more"
            type="button"
            onClick={() => setShowAllCards(!showAllCards)}
          >
            {showAllCards ? "Show less" : `Show ${foldedAway} more`}
          </button>
        </div>
      </section>

      <section
        class="test-cards"
        data-open={altOpen ? "true" : "false"}
        aria-label="Alternative payment dataset"
      >
        <button
          class="test-cards__toggle"
          type="button"
          aria-expanded={altOpen}
          onClick={() => setAltOpen(!altOpen)}
        >
          <span>Alternative payment dataset</span>
          <span class="test-cards__chevron" aria-hidden="true">{altOpen ? "−" : "+"}</span>
        </button>
        <div class="test-cards__body">
          <div class="test-cards__list">
            {ALT_METHODS.map((method) => {
              const key = `${method.name}-${method.note ?? ""}`;
              const content = (
                <>
                  <span class="test-card__top">
                    <span class="test-card__scheme">{method.name}</span>
                    {method.note ? <span class="test-card__note">{method.note}</span> : null}
                  </span>
                  {method.value
                    ? (
                      <span
                        class={`test-card__pan${
                          method.value.length > 20 ? " test-card__pan--long" : ""
                        }`}
                      >
                        {method.value}
                      </span>
                    )
                    : null}
                  {method.disclaimer
                    ? (
                      <span class="test-card__disclaimer">
                        {method.disclaimer.text}{" "}
                        <a
                          href={method.disclaimer.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {method.disclaimer.linkLabel}
                        </a>
                      </span>
                    )
                    : (
                      <span class="test-card__bottom">
                        {method.detail ? <span>{method.detail}</span> : null}
                        <span class="test-card__copy">
                          {copied === method.value ? "Copied" : "Copy"}
                        </span>
                      </span>
                    )}
                </>
              );
              // Only the pasteable ones are buttons; a wallet tile carries no
              // credential, so a button there would do nothing when pressed.
              return method.value
                ? (
                  <button
                    class="test-card"
                    type="button"
                    key={key}
                    title={`Copy ${method.value}`}
                    onClick={() => copy(method.value as string)}
                  >
                    {content}
                  </button>
                )
                : <div class="test-card test-card--static" key={key}>{content}</div>;
            })}
          </div>
          <a
            class="test-cards__more test-cards__more--link"
            href={KLARNA_DOCS}
            target="_blank"
            rel="noopener noreferrer"
          >
            More Klarna shopper data
          </a>
        </div>
      </section>
    </div>
  );
}
