import { useState } from "react";
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
    <div className="test-data">
      <section
        className="test-cards test-cards--primary"
        data-open={cardsOpen ? "true" : "false"}
        data-expanded={showAllCards ? "true" : "false"}
        aria-label="Card dataset"
      >
        <button
          className="test-cards__toggle"
          type="button"
          aria-expanded={cardsOpen}
          onClick={() => setCardsOpen(!cardsOpen)}
        >
          <span>Card dataset</span>
          <span className="test-cards__chevron" aria-hidden="true">{cardsOpen ? "−" : "+"}</span>
        </button>
        <div className="test-cards__body">
          <div className="test-cards__list">
            {TEST_CARDS.map((card, index) => (
              <button
                className="test-card"
                type="button"
                key={card.pan}
                data-secondary={index >= PRIMARY_CARD_COUNT ? "true" : "false"}
                title={`Copy ${card.pan}`}
                onClick={() => copy(card.pan)}
              >
                <span className="test-card__top">
                  <span className="test-card__scheme">{card.scheme}</span>
                  {card.note ? <span className="test-card__note">{card.note}</span> : null}
                </span>
                <span className="test-card__pan">{card.pan}</span>
                <span className="test-card__bottom">
                  <span>{card.expiry}</span>
                  <span>CVC {card.cvc}</span>
                  <span className="test-card__copy">{copied === card.pan ? "Copied" : "Copy"}</span>
                </span>
              </button>
            ))}
          </div>
          <button
            className="test-cards__more"
            type="button"
            onClick={() => setShowAllCards(!showAllCards)}
          >
            {showAllCards ? "Show less" : `Show ${foldedAway} more`}
          </button>
        </div>
      </section>

      <section
        className="test-cards"
        data-open={altOpen ? "true" : "false"}
        aria-label="Alternative payment dataset"
      >
        <button
          className="test-cards__toggle"
          type="button"
          aria-expanded={altOpen}
          onClick={() => setAltOpen(!altOpen)}
        >
          <span>Alternative payment dataset</span>
          <span className="test-cards__chevron" aria-hidden="true">{altOpen ? "−" : "+"}</span>
        </button>
        <div className="test-cards__body">
          <div className="test-cards__list">
            {ALT_METHODS.map((method) => {
              const key = `${method.name}-${method.note ?? ""}`;
              const content = (
                <>
                  <span className="test-card__top">
                    <span className="test-card__scheme">{method.name}</span>
                    {method.note ? <span className="test-card__note">{method.note}</span> : null}
                  </span>
                  {method.value
                    ? (
                      <span
                        className={`test-card__pan${
                          method.value.length > 20 ? " test-card__pan--long" : ""
                        }`}
                      >
                        {method.value}
                      </span>
                    )
                    : null}
                  {method.disclaimer
                    ? (
                      <span className="test-card__disclaimer">
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
                      <span className="test-card__bottom">
                        {method.detail ? <span>{method.detail}</span> : null}
                        <span className="test-card__copy">
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
                    className="test-card"
                    type="button"
                    key={key}
                    title={`Copy ${method.value}`}
                    onClick={() => copy(method.value as string)}
                  >
                    {content}
                  </button>
                )
                : <div className="test-card test-card--static" key={key}>{content}</div>;
            })}
          </div>
          <a
            className="test-cards__more test-cards__more--link"
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
