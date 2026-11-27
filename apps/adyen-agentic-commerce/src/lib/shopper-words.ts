// Spec: knowledge/components/adyen-agentic-commerce.md
// What a shopper reads when the store says no: one sentence per refusal code, in plain words. The
// store's own texts name fields (`buyer.email`) and states for agents; a person never sees them.
// Pure and browser-safe: the server's browser routes and the pages share it.

const WORDS: Record<string, string> = {
  missing_buyer_email: "Add an email so we can send your receipt.",
  empty_checkout: "Your bag is empty.",
  out_of_stock: "Something in your bag has just sold out. Remove it to go on.",
  checkout_expired: "This checkout expired. Start again from your bag.",
  checkout_canceled: "This checkout was canceled. Start again from your bag.",
  checkout_not_payable: "This checkout can't be paid yet. Check the details on this page.",
  checkout_not_editable: "This checkout can no longer change.",
  checkout_not_cancelable: "This checkout can no longer be canceled.",
  checkout_changed: "Your bag changed while you were paying. Check the new total, then pay.",
  payment_in_progress:
    "A payment for this bag is already in progress, here or in the chat. This page updates when it ends.",
  payment_refused: "The payment was declined. Try again, or use another card.",
  payment_unavailable: "The payment could not start. Try again in a moment.",
  amount_mismatch: "No order was placed: the payment did not match your bag. We will check it.",
  shopper_pays: "Your assistant handed this checkout to you: pay for it on this page.",
  spend_limit_exceeded:
    "This is more than your assistant may spend. Pay on this page, or raise its limit in your account.",
  payments_unavailable: "Payments are switched off on this store right now.",
  not_found: "We could not find this checkout. Start again from your bag.",
  invalid_line_items: "Something in your bag is no longer available. Refresh the page.",
  invalid_line_item: "Something in your bag is no longer available. Refresh the page.",
  item_not_found: "Something in your bag is no longer available. Refresh the page.",
  variant_required: "Choose a colour and a size for each item.",
  invalid_quantity: "Choose a quantity from 1 to 10.",
  invalid_buyer: "Check your name and email: something looks incomplete.",
  cart_canceled: "This bag was emptied. Add something to start again.",
  no_saved_card: "Your account has no saved card yet. Pay on this page instead.",
  invalid_credential: "This card could not be used. Pay on this page instead.",
  unknown_instrument: "This way of paying is not available. Pay on this page instead.",
  unsupported_handler: "This way of paying is not available. Pay on this page instead.",
  too_many_line_items: "Your bag holds as many different items as it can.",
  invalid_email: "Check the email address: it looks incomplete.",
  email_set: "This checkout already has an email for the receipt.",
  welcome_offer_ineligible:
    "The welcome offer is for a first order only. Your total has been updated: check it, then pay.",
  sign_in_required: "Sign in to your account first.",
  invalid_request: "Something in that request was not right. Refresh the page and try again.",
  invalid_delivery: "Choose a delivery option and an address or pickup point from the list.",
  rate_limited: "Too many tries at once. Wait a minute, then try again.",
  session_failed: "The payment form could not open. Refresh the page to try again.",
  result_unconfirmed: "Adyen has not confirmed the payment yet. This page updates when it does.",
};

const FALLBACK = "Something went wrong on our side. Refresh the page and try again.";

/** Whether a code has its own sentence (tests check every code a shopper can meet has one). */
export const hasWords = (code: string) => Object.hasOwn(WORDS, code);

/** The sentence for a refusal code; an unknown code (or `toString`) gets a general sentence. */
export const shopperWords = (code: string | undefined) =>
  code && hasWords(code) ? (WORDS[code] as string) : FALLBACK;
