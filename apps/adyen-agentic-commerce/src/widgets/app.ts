// Spec: knowledge/components/adyen-agentic-commerce.md
// The widget inside an agent host: the collection as a carousel and the bag, in one script that
// both UI resources load (the body's data-view picks the first screen). Every text from the store
// goes in through textContent, every link and image must be on the store's own origin (an image
// may also come inline).
import { connect, type Host, type Theme } from "./bridge";
import {
  type Action,
  addCall,
  attemptFor,
  type BagLine,
  type BagView,
  bagView,
  type Call,
  type CatalogView,
  type Choice,
  capabilityOf,
  catalogView,
  chatLink,
  checkoutCall,
  choose,
  coloursOf,
  contextDataFor,
  contextFor,
  countOf,
  inBag,
  inlineImage,
  isOpen,
  money,
  type PayAttempt,
  offered,
  payCall,
  type PayStep,
  payStep,
  productPage,
  quantityCall,
  refreshCheckoutCall,
  searchCall,
  shopperNote,
  sizesOf,
  type UcpProduct,
  type Velune,
  variantFor,
  veluneContext,
} from "./logic";

type State = {
  view: "catalog" | "bag";
  query: string;
  catalog?: CatalogView;
  choices: Record<string, Choice>;
  bag?: BagView;
  instrument?: string;
  attempt?: PayAttempt;
  busy?: string;
  note?: { tone: "ok" | "bad" | "info"; text: string };
  // The variant a card just added, for its brief "Added to bag".
  added?: string;
  // In the store's own panel, Pay asks for a missing email there (ADR-020).
  store?: boolean;
  // And says who is shopping, so the checkout card leads with one action (ADR-021).
  velune?: Velune;
};

const STORE = document.querySelector('meta[name="store-origin"]')?.getAttribute("content") ?? "";
function onStore(url: string | undefined): url is string {
  if (!url || !STORE) return false;
  try {
    return new URL(url).origin === STORE;
  } catch {
    return false;
  }
}
const pictured = (url: string | undefined): url is string => onStore(url) || inlineImage(url);

type Child = Node | string | false | null | undefined;
type Attrs = Record<string, string | boolean | undefined | ((event: Event) => void)>;
function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else if (typeof value === "string") el.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

const root = document.getElementById("app")!;
const state: State = {
  view: document.body.dataset.view === "bag" ? "bag" : "catalog",
  query: "",
  choices: {},
};

let host: Host;

// `stay`: a tap on the collection changed the bag, so the collection stays in view; a bag the
// agent shows, or any other answer, opens the bag.
function show(data: unknown, stay = false) {
  const capability = capabilityOf(data) ?? "";
  if (capability.startsWith("dev.ucp.shopping.catalog")) {
    const view = catalogView(data);
    if (view) {
      state.catalog = view;
      state.view = "catalog";
    }
  } else {
    const bag = bagView(data);
    if (bag) {
      state.bag = bag;
      if (!stay) state.view = "bag";
      if (!bag.instruments.some((i) => i.id === state.instrument))
        state.instrument = bag.instruments[0]?.id;
      if (bag.order) state.note = { tone: "ok", text: `Paid on Adyen TEST. ${bag.order.label}.` };
    }
  }
  render();
}

// A refused call in the shopper's words: the store's own text is written for agents.
function refusal(data: unknown) {
  const messages =
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as { messages?: unknown }).messages)
      ? (data as { messages: { code?: unknown }[] }).messages
      : [];
  const code = messages.find((m) => typeof m.code === "string")?.code;
  return shopperNote(typeof code === "string" ? code : undefined) ?? "The store could not do that.";
}

// "Added to bag" shows on the card that was added, then goes; the next tap clears it at once.
let addedTimer: ReturnType<typeof setTimeout> | undefined;
function flashAdded(variantId: string) {
  state.added = variantId;
  clearTimeout(addedTimer);
  addedTimer = setTimeout(() => {
    state.added = undefined;
    render();
  }, 1800);
}

// A button: the widget calls the tool and shows the answer itself. From the collection's cards
// (`stay`), the collection stays in view and the card that was added says so.
async function run(label: string, call: Call | undefined, stay?: { added?: string }) {
  if (!call || state.busy) return;
  state.busy = label;
  state.note = undefined;
  state.added = undefined;
  clearTimeout(addedTimer);
  render();
  try {
    const result = await host.call(call.name, call.arguments);
    if (call.name === "complete_checkout") state.attempt = undefined;
    if (result.isError) state.note = { tone: "bad", text: refusal(result.structuredContent) };
    show(result.structuredContent, stay !== undefined);
    if (!result.isError && stay?.added) flashAdded(stay.added);
    // Never "ready" beside a missing email: the bag's own line asks for it.
    if (
      !result.isError &&
      call.name === "create_checkout" &&
      !state.bag?.order &&
      !state.bag?.codes.includes("missing_buyer_email")
    )
      state.note = { tone: "info", text: "Checkout ready." };
    if (!result.isError && state.bag && call.name !== "search_catalog")
      host.tellModel(contextFor(state.bag), contextDataFor(state.bag));
  } catch (error) {
    // The attempt stays: the same checkout and card retry with the same key, never a second payment.
    state.note = { tone: "bad", text: error instanceof Error ? error.message : String(error) };
  } finally {
    state.busy = undefined;
    render();
  }
}

function act(action: Action, stay?: { added?: string }) {
  if (action.kind === "call") void run(action.label, action.call, stay);
}

async function open(url: string | undefined) {
  if (!onStore(url)) return;
  try {
    await host.open(url);
  } catch (error) {
    state.note = { tone: "bad", text: error instanceof Error ? error.message : String(error) };
    render();
  }
}

// --- header -----------------------------------------------------------------------------------

// The count last drawn on the Bag tab: it bumps only when the bag has just grown. A tap draws twice
// in one task (its answer, then the end of busy), so the bump holds until that task ends.
let drawnCount = 0;
let bumping = false;

function header() {
  const count = countOf(state.bag);
  if (count > drawnCount) {
    bumping = true;
    setTimeout(() => {
      bumping = false;
    });
  }
  drawnCount = count;
  const grew = bumping;
  const tab = (view: State["view"], label: string, badge?: HTMLElement) =>
    h(
      "button",
      {
        type: "button",
        class: "tab",
        "aria-current": state.view === view ? "page" : undefined,
        onclick: () => {
          state.view = view;
          render();
        },
      },
      label,
      badge,
    );
  const badge =
    count > 0
      ? h(
          "span",
          { class: grew ? "tally bump" : "tally", "aria-label": `${count} in your bag` },
          String(count),
        )
      : undefined;
  return h(
    "header",
    { class: "top" },
    h(
      "div",
      { class: "brand" },
      h("span", { class: "mark", "aria-hidden": "true" }, "AV"),
      h("span", { class: "name" }, "Atelier Velune"),
      h("span", { class: "badge" }, "TEST"),
    ),
    h(
      "nav",
      { class: "tabs", "aria-label": "Store" },
      tab("catalog", "Collection"),
      tab("bag", "Bag", badge),
    ),
  );
}

// --- the collection ---------------------------------------------------------------------------

function search() {
  const input = h("input", {
    type: "search",
    name: "q",
    value: state.query,
    placeholder: "Trench, shirt, bag…",
    "aria-label": "Search the collection",
    maxlength: "200",
  }) as HTMLInputElement;
  // No <form>: a host frame sandboxed without allow-forms blocks the submission, and with it the
  // submit event, so the button and Enter start the search themselves.
  const submit = () => {
    state.query = input.value;
    act(choose("Searching", () => searchCall(input.value)));
  };
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    submit();
  });
  return h(
    "div",
    { class: "search", role: "search" },
    input,
    h(
      "button",
      { type: "button", class: "btn ghost", disabled: !!state.busy, onclick: submit },
      "Search",
    ),
  );
}

function pills(p: UcpProduct, choice: Choice, name: "colour" | "size") {
  const values = name === "colour" ? coloursOf(p) : sizesOf(p);
  if (values.length < 2) return null;
  const chosen = variantFor(p, choice);
  const current = chosen?.options?.find((o) => o.name === name);
  const currentKey = name === "colour" ? (current?.id ?? current?.label) : current?.label;
  return h(
    "div",
    { class: "pills", role: "group", "aria-label": name === "colour" ? "Colour" : "Size" },
    ...values.map((value) => {
      const key = name === "colour" ? (value.id ?? value.label) : value.label;
      return h(
        "button",
        {
          type: "button",
          class: "pill",
          "aria-pressed": key === currentKey ? "true" : "false",
          disabled: !offered(p, { ...choice, [name]: undefined }, name, key),
          onclick: () => {
            state.choices[p.id] = { ...state.choices[p.id], [name]: key };
            render();
          },
        },
        value.label,
      );
    }),
  );
}

// What the bag holds of a card's variant, stepped where it is: the collection stays in view. The
// bag's last piece stays, like on the Bag view (only the assistant empties a bag).
function stepper(bag: BagView, variantId: string, title: string, held: number) {
  const step = (by: 1 | -1, text: string, name: string) =>
    h(
      "button",
      {
        type: "button",
        class: "step",
        "aria-label": name,
        disabled: !!state.busy || (by > 0 ? held >= 10 : held === 1 && countOf(bag) === 1),
        onclick: () =>
          act(
            choose("Updating your bag", () => quantityCall(bag, variantId, held + by)),
            {
              added: by > 0 ? variantId : undefined,
            },
          ),
      },
      text,
    );
  return h(
    "div",
    { class: "stepper", role: "group", "aria-label": `${title} in your bag` },
    step(-1, "−", `One less ${title}`),
    h("span", { class: "held", "aria-live": "polite" }, String(held)),
    step(1, "+", `One more ${title}`),
  );
}

function card(p: UcpProduct) {
  const choice = state.choices[p.id] ?? {};
  const variant = variantFor(p, choice);
  const image = variant?.media?.[0]?.url ?? p.media?.[0]?.url;
  const available = variant !== undefined && variant.availability?.available !== false;
  const price = variant?.price ?? p.price_range?.min;
  const label = !available ? "Sold out" : "Add to bag";
  const held = variant ? inBag(state.bag, variant.id) : 0;
  return h(
    "li",
    { class: "card" },
    variant && state.added === variant.id
      ? h("p", { class: "added", role: "status" }, "Added to bag")
      : null,
    pictured(image)
      ? h("img", {
          src: image,
          alt: variant?.title ?? p.title,
          width: "480",
          height: "480",
          loading: "lazy",
        })
      : h("div", { class: "noimg", "aria-hidden": "true" }),
    h("h3", {}, p.title),
    price ? h("p", { class: "price" }, money(price.amount, price.currency)) : null,
    pills(p, choice, "colour"),
    pills(p, choice, "size"),
    variant && state.bag && held > 0
      ? stepper(state.bag, variant.id, p.title, held)
      : h(
          "button",
          {
            type: "button",
            class: "btn",
            disabled: !available || !!state.busy,
            onclick: () => {
              if (!variant) return;
              act(
                choose("Adding to your bag", () => addCall(state.bag, variant.id)),
                {
                  added: variant.id,
                },
              );
            },
          },
          label,
        ),
    h(
      "button",
      {
        type: "button",
        class: "btn ghost details",
        onclick: () => void open(productPage(STORE, p.id, variant?.id)),
      },
      "View product details",
    ),
  );
}

function catalogScreen() {
  const view = state.catalog;
  const more =
    view?.hasNext &&
    h(
      "button",
      {
        type: "button",
        class: "btn ghost",
        disabled: !!state.busy,
        onclick: () => {
          act(choose("Loading more", () => searchCall(state.query, view.cursor)));
        },
      },
      "More",
    );
  return h(
    "section",
    { "aria-label": "Collection" },
    search(),
    view?.products.length
      ? h("ul", { class: "rail" }, ...view.products.map(card))
      : h(
          "div",
          {},
          h("p", { class: "empty" }, "Nothing to show yet. Search the collection above."),
          h(
            "button",
            {
              type: "button",
              class: "btn ghost",
              disabled: !!state.busy,
              onclick: () => {
                act(choose("Loading collection", () => searchCall("")));
              },
            },
            "Show all items",
          ),
        ),
    view?.total !== undefined && view.products.length
      ? h("p", { class: "count" }, `${view.products.length} of ${view.total} shown`)
      : null,
    more,
  );
}

// --- the bag ----------------------------------------------------------------------------------

function line(bag: BagView, l: BagLine) {
  const editable = isOpen(bag) && !bag.order;
  const step = (delta: number, text: string, aria: string) =>
    h(
      "button",
      {
        type: "button",
        class: "step",
        "aria-label": aria,
        disabled: !!state.busy || l.quantity + delta < 1 || l.quantity + delta > 10,
        onclick: () => {
          const quantity = l.quantity + delta;
          act(choose("Updating your bag", () => quantityCall(bag, l.variantId, quantity)));
        },
      },
      text,
    );
  return h(
    "li",
    { class: "line" },
    pictured(l.image)
      ? h("img", { src: l.image, alt: "", width: "56", height: "56" })
      : h("div", { class: "noimg small", "aria-hidden": "true" }),
    h(
      "div",
      { class: "what" },
      h("p", { class: "title" }, l.title),
      h("p", { class: "muted" }, money(l.amount, bag.currency)),
    ),
    editable
      ? h(
          "div",
          { class: "qty" },
          step(-1, "−", `One less ${l.title}`),
          h("span", { "aria-live": "polite" }, String(l.quantity)),
          step(1, "+", `One more ${l.title}`),
          bag.lines.length > 1
            ? h(
                "button",
                {
                  type: "button",
                  class: "link",
                  disabled: !!state.busy,
                  onclick: () => {
                    act(choose("Updating your bag", () => quantityCall(bag, l.variantId, 0)));
                  },
                },
                "Remove",
              )
            : null,
        )
      : h("span", { class: "muted" }, `× ${l.quantity}`),
  );
}

// The welcome tote: no stepper, no Remove; the store adds and removes it with the offer.
function giftLine(gift: BagLine) {
  return h(
    "li",
    { class: "line" },
    pictured(gift.image)
      ? h("img", { src: gift.image, alt: "", width: "56", height: "56" })
      : h("div", { class: "noimg small", "aria-hidden": "true" }),
    h(
      "div",
      { class: "what" },
      h("p", { class: "title" }, gift.title),
      h("p", { class: "muted ok" }, "Free with your welcome offer"),
    ),
    h("span", { class: "muted" }, "× 1"),
  );
}

function totals(bag: BagView) {
  const row = (label: string, amount: number | undefined, strong = false) =>
    amount === undefined
      ? null
      : h(
          "div",
          { class: strong ? "row strong" : "row" },
          h("dt", {}, label),
          h("dd", {}, money(amount, bag.currency)),
        );
  return h(
    "dl",
    { class: "totals" },
    row("Subtotal", bag.subtotal),
    bag.discount
      ? h(
          "div",
          { class: "row ok" },
          h("dt", {}, "Welcome offer (-5%)"),
          h("dd", {}, `-${money(bag.discount, bag.currency)}`),
        )
      : null,
    row("Shipping", bag.shipping),
    row("Total", bag.total, true),
  );
}

// The store's own panel: one primary action in the owner's order, then "Continue on website
// checkout", quieter and last. Every action but paying opens an overlay above the chat.
const LEAD: Record<PayStep, string> = {
  email: "Add your email to continue to payment.",
  pay: "Pay with a card saved in your account",
  raise: "This is over your Personal Shopper's budget.",
  connect: "Let your Personal Shopper pay with your saved card, within a budget you set.",
  "save-card": "No card is saved on your account yet.",
  "create-account": "Create an account to save a card and pay here, with 5% off a first order.",
  refresh: "Your saved cards are on their way to this checkout.",
  fix: "Fix what the store asks for above, then pay.",
};
const ACTION: Partial<Record<PayStep, string>> = {
  raise: "Raise budget & pay in chat",
  connect: "Allow & pay in chat",
  "save-card": "Save a card & pay in chat",
  "create-account": "Save a card & pay in chat",
};
function storeActions(bag: BagView, v: Velune) {
  const total = money(bag.total, bag.currency);
  const step = payStep(bag, v);
  const chosen = bag.instruments.find((i) => i.id === state.instrument) ?? bag.instruments[0];
  const button = (label: string, onclick: () => void) =>
    h("button", { type: "button", class: "btn", disabled: !!state.busy, onclick }, label);
  const link = chatLink(STORE, step, bag.id);
  let primary: HTMLElement | null = null;
  if (step === "pay" && chosen)
    primary = button(`Pay ${total} in chat`, () => {
      act(
        choose("Paying on Adyen TEST", () => {
          state.attempt = attemptFor(state.attempt, bag.id, chosen.id);
          return payCall(bag, chosen.id, state.attempt.key);
        }),
      );
    });
  else if (step === "refresh")
    primary = button("Show my saved cards", () => {
      act(choose("Checking saved cards", () => refreshCheckoutCall(bag.id)));
    });
  else if (link) primary = button(ACTION[step] ?? `Pay ${total}`, () => void open(link));
  const left =
    step === "raise" && v.grantRemaining !== undefined
      ? ` ${money(v.grantRemaining, bag.currency)} left of ${money(v.grantLimit ?? v.grantRemaining, bag.currency)}.`
      : "";
  return h(
    "div",
    { class: "actions" },
    step === "pay"
      ? h(
          "fieldset",
          { class: "cards" },
          h("legend", {}, LEAD.pay),
          ...bag.instruments.map((i) =>
            h(
              "label",
              { class: "radio" },
              h("input", {
                type: "radio",
                name: "instrument",
                value: i.id,
                checked: i.id === chosen?.id,
                onchange: () => {
                  state.instrument = i.id;
                  render();
                },
              }),
              i.label,
            ),
          ),
        )
      : h("p", { class: "muted" }, `${LEAD[step]}${left}`),
    primary,
    onStore(bag.continueUrl)
      ? h(
          "button",
          { type: "button", class: "link quiet", onclick: () => void open(bag.continueUrl) },
          "Continue on website checkout",
        )
      : null,
  );
}

function payArea(bag: BagView) {
  const total = money(bag.total, bag.currency);
  if (bag.order)
    return h(
      "div",
      { class: "actions" },
      onStore(bag.order.url)
        ? h(
            "button",
            { type: "button", class: "btn", onclick: () => void open(bag.order?.url) },
            "View the order",
          )
        : null,
    );
  if (bag.kind === "cart")
    return h(
      "div",
      { class: "actions" },
      h(
        "button",
        {
          type: "button",
          class: "btn",
          disabled: !!state.busy || !bag.lines.length,
          onclick: () => {
            act(choose("Starting checkout", () => checkoutCall(bag.id)));
          },
        },
        "Checkout",
      ),
    );
  if (!isOpen(bag)) return null;
  if (state.store && state.velune) return storeActions(bag, state.velune);
  const over = bag.codes.includes("spend_limit_exceeded");
  const ready = bag.status === "ready_for_complete" && bag.instruments.length > 0;
  const chosen = bag.instruments.find((i) => i.id === state.instrument) ?? bag.instruments[0];
  return h(
    "div",
    { class: "actions" },
    ready
      ? h(
          "fieldset",
          { class: "cards" },
          h("legend", {}, "Pay with a card saved in your account"),
          ...bag.instruments.map((i) =>
            h(
              "label",
              { class: "radio" },
              h("input", {
                type: "radio",
                name: "instrument",
                value: i.id,
                checked: i.id === chosen?.id,
                onchange: () => {
                  state.instrument = i.id;
                  render();
                },
              }),
              i.label,
            ),
          ),
        )
      : h(
          "p",
          { class: "muted" },
          over
            ? "This is over the budget you gave the assistant. Approve it on the store, or raise the budget."
            : bag.status === "ready_for_complete"
              ? "No card is saved on your Atelier Velune account yet. Pay on the store checkout, or save a test card in your account and refresh."
              : bag.codes.includes("missing_buyer_email")
                ? "Add your email to continue to payment."
                : "Fix what the store asks for above, then pay.",
        ),
    ready && chosen
      ? h(
          "button",
          {
            type: "button",
            class: "btn",
            disabled: !!state.busy,
            onclick: () => {
              act(
                choose("Paying on Adyen TEST", () => {
                  state.attempt = attemptFor(state.attempt, bag.id, chosen.id);
                  return payCall(bag, chosen.id, state.attempt.key);
                }),
              );
            },
          },
          `Pay ${total}`,
        )
      : null,
    over && onStore(bag.manageUrl)
      ? h(
          "button",
          { type: "button", class: "btn ghost", onclick: () => void open(bag.manageUrl) },
          "Raise the budget",
        )
      : null,
    onStore(bag.continueUrl)
      ? h(
          "button",
          {
            type: "button",
            class: ready ? "btn ghost" : "btn",
            // In the store's panel a missing email is asked there, then the checkout opens.
            onclick: () =>
              void open(
                state.store && !over && bag.codes.includes("missing_buyer_email")
                  ? `${STORE}/checkout/${encodeURIComponent(bag.id)}#velune-pay-email?checkoutId=${encodeURIComponent(bag.id)}`
                  : bag.continueUrl,
              ),
          },
          over
            ? "Approve on the store"
            : ready
              ? "Open the store checkout"
              : `Pay ${total} on Atelier Velune`,
        )
      : null,
    !ready && !over && bag.status === "ready_for_complete" && STORE
      ? h(
          "button",
          {
            type: "button",
            class: "btn ghost",
            onclick: () => void open(`${STORE}/account#cards`),
          },
          "Save a test card",
        )
      : null,
    !ready && !over && bag.status === "ready_for_complete"
      ? h(
          "button",
          {
            type: "button",
            class: "btn ghost",
            disabled: !!state.busy,
            onclick: () => {
              act(choose("Checking saved cards", () => refreshCheckoutCall(bag.id)));
            },
          },
          "Refresh cards",
        )
      : null,
  );
}

function bagScreen() {
  const bag = state.bag;
  if (!bag || !bag.lines.length)
    return h(
      "section",
      { "aria-label": "Bag" },
      h("p", { class: "empty" }, "Your bag is empty."),
      h(
        "button",
        {
          type: "button",
          class: "btn ghost",
          disabled: !!state.busy,
          onclick: () => {
            act(choose("Searching", () => searchCall("")));
          },
        },
        "Browse the collection",
      ),
    );
  return h(
    "section",
    { "aria-label": "Bag" },
    h(
      "ul",
      { class: "lines" },
      ...bag.lines.map((l) => line(bag, l)),
      bag.gift ? giftLine(bag.gift) : null,
    ),
    totals(bag),
    bag.problems.length && !bag.order
      ? h("ul", { class: "problems" }, ...bag.problems.map((p) => h("li", {}, p)))
      : null,
    payArea(bag),
  );
}

// --- render -----------------------------------------------------------------------------------

// The view last drawn: a change of view slides in from its tab's side, any other render stays put.
// Like the Bag tab's bump, the slide holds until the task that changed the view ends.
let drawnView = state.view;
let sliding: string | undefined;

function render() {
  const screen = state.view === "catalog" ? catalogScreen() : bagScreen();
  if (state.view !== drawnView) {
    sliding = state.view === "bag" ? "slide-from-right" : "slide-from-left";
    setTimeout(() => {
      sliding = undefined;
    });
  }
  drawnView = state.view;
  if (sliding) screen.classList.add(sliding);
  root.replaceChildren(
    header(),
    screen,
    h(
      "p",
      { class: `note ${state.note?.tone ?? ""}`, role: "status", "aria-live": "polite" },
      state.busy ? `${state.busy}…` : (state.note?.text ?? ""),
    ),
  );
}

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

host = connect({
  result: show,
  theme: setTheme,
  store: (velune) => {
    state.store = true;
    state.velune = veluneContext(velune) ?? state.velune;
    render();
  },
});
render();
