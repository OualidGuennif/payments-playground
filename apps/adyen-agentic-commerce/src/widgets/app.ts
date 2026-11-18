// Spec: knowledge/components/adyen-agentic-commerce.md
// The widget inside an agent host: the collection as a carousel and the bag, in one script that
// both UI resources load (the body's data-view picks the first screen). Every text from the store
// goes in through textContent, every link and image must be on the store's own origin.
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
  checkoutCall,
  choose,
  coloursOf,
  contextFor,
  isOpen,
  type Mode,
  money,
  type PayAttempt,
  offered,
  payCall,
  quantityCall,
  say,
  searchCall,
  sizesOf,
  type UcpProduct,
  variantFor,
} from "./logic";

type State = {
  mode: Mode;
  view: "catalog" | "bag";
  query: string;
  catalog?: CatalogView;
  choices: Record<string, Choice>;
  bag?: BagView;
  instrument?: string;
  attempt?: PayAttempt;
  busy?: string;
  note?: { tone: "ok" | "bad" | "info"; text: string };
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
  mode: "hand",
  view: document.body.dataset.view === "bag" ? "bag" : "catalog",
  query: "",
  choices: {},
};

let host: Host;

function show(data: unknown) {
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
      state.view = "bag";
      if (!bag.instruments.some((i) => i.id === state.instrument))
        state.instrument = bag.instruments[0]?.id;
      if (bag.order) state.note = { tone: "ok", text: `Paid on Adyen TEST. ${bag.order.label}.` };
    }
  }
  render();
}

function refusal(data: unknown) {
  const messages =
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as { messages?: unknown }).messages)
      ? (data as { messages: { content?: unknown }[] }).messages
      : [];
  const first = messages.find((m) => typeof m.content === "string")?.content;
  return typeof first === "string" ? first : "The store could not do that.";
}

// "By hand": the widget calls the tool and shows the answer itself.
async function run(label: string, call: Call | undefined) {
  if (!call || state.busy) return;
  state.busy = label;
  state.note = undefined;
  render();
  try {
    const result = await host.call(call.name, call.arguments);
    if (call.name === "complete_checkout") state.attempt = undefined;
    if (result.isError) state.note = { tone: "bad", text: refusal(result.structuredContent) };
    show(result.structuredContent);
    if (!result.isError && state.bag && call.name !== "search_catalog")
      host.tellModel(contextFor(state.bag));
  } catch (error) {
    // The attempt stays: the same checkout and card retry with the same key, never a second payment.
    state.note = { tone: "bad", text: error instanceof Error ? error.message : String(error) };
  } finally {
    state.busy = undefined;
    render();
  }
}

function act(action: Action) {
  if (action.kind === "call") void run(action.label, action.call);
  else if (action.kind === "say") void ask(action.text);
}

// "With the assistant": the widget only writes to the assistant, which calls the tools.
async function ask(text: string) {
  if (state.busy) return;
  state.busy = "Asking the assistant";
  render();
  try {
    await host.say(text);
    state.note = { tone: "info", text: `Sent to the assistant: “${text}”` };
  } catch (error) {
    state.note = { tone: "bad", text: error instanceof Error ? error.message : String(error) };
  } finally {
    state.busy = undefined;
    render();
  }
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

function header() {
  const count = state.bag?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0;
  const modeButton = (mode: Mode, label: string) =>
    h(
      "button",
      {
        type: "button",
        class: "seg",
        "aria-pressed": state.mode === mode ? "true" : "false",
        onclick: () => {
          state.mode = mode;
          state.note = undefined;
          host.remember({ mode });
          render();
        },
      },
      label,
    );
  const tab = (view: State["view"], label: string) =>
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
    );
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
      "div",
      { class: "modes", role: "group", "aria-label": "Who shops" },
      modeButton("hand", "By hand"),
      modeButton("assistant", "With the assistant"),
    ),
    h(
      "nav",
      { class: "tabs", "aria-label": "Store" },
      tab("catalog", "Collection"),
      tab("bag", count ? `Bag (${count})` : "Bag"),
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
    act(
      choose(
        state.mode,
        "Searching",
        () => searchCall(input.value),
        () => say.search(input.value),
      ),
    );
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

function card(p: UcpProduct) {
  const choice = state.choices[p.id] ?? {};
  const variant = variantFor(p, choice);
  const image = variant?.media?.[0]?.url ?? p.media?.[0]?.url;
  const available = variant !== undefined && variant.availability?.available !== false;
  const price = variant?.price ?? p.price_range?.min;
  const label = !available ? "Sold out" : state.mode === "hand" ? "Add to bag" : "Ask to add";
  return h(
    "li",
    { class: "card" },
    onStore(image)
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
    h(
      "button",
      {
        type: "button",
        class: "btn",
        disabled: !available || !!state.busy,
        onclick: () => {
          if (!variant) return;
          act(
            choose(
              state.mode,
              "Adding to your bag",
              () => addCall(state.bag, variant.id),
              () => say.add(p, variant),
            ),
          );
        },
      },
      label,
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
          act(
            choose(
              state.mode,
              "Loading more",
              () => searchCall(state.query, view.cursor),
              () => say.more(),
            ),
          );
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
      : h("p", { class: "empty" }, "Nothing to show yet. Search the collection above."),
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
          act(
            choose(
              state.mode,
              "Updating your bag",
              () => quantityCall(bag, l.variantId, quantity),
              () => say.quantity(l, quantity),
            ),
          );
        },
      },
      text,
    );
  return h(
    "li",
    { class: "line" },
    onStore(l.image)
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
                    act(
                      choose(
                        state.mode,
                        "Updating your bag",
                        () => quantityCall(bag, l.variantId, 0),
                        () => say.quantity(l, 0),
                      ),
                    );
                  },
                },
                "Remove",
              )
            : null,
        )
      : h("span", { class: "muted" }, `× ${l.quantity}`),
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
    row("Shipping", bag.shipping),
    row("Total", bag.total, true),
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
            act(
              choose(
                state.mode,
                "Starting checkout",
                () => checkoutCall(bag.id),
                () => say.checkout(),
              ),
            );
          },
        },
        state.mode === "hand" ? "Checkout" : "Ask to check out",
      ),
    );
  if (!isOpen(bag)) return null;
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
              ? "No saved card is shared with the assistant. Pay on the store instead."
              : "The store needs something before payment; see above.",
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
                choose(
                  state.mode,
                  "Paying on Adyen TEST",
                  () => {
                    state.attempt = attemptFor(state.attempt, bag.id, chosen.id);
                    return payCall(bag, chosen.id, state.attempt.key);
                  },
                  () => say.pay(chosen, total),
                ),
              );
            },
          },
          state.mode === "hand" ? `Pay ${total}` : `Ask to pay ${total}`,
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
          { type: "button", class: "btn ghost", onclick: () => void open(bag.continueUrl) },
          over ? "Approve on the store" : "Open the store checkout",
        )
      : null,
    h(
      "p",
      { class: "fine" },
      "Adyen TEST: no real money moves. Your assistant may ask you to confirm.",
    ),
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
            act(
              choose(
                state.mode,
                "Searching",
                () => searchCall(""),
                () => say.search(""),
              ),
            );
          },
        },
        "Browse the collection",
      ),
    );
  return h(
    "section",
    { "aria-label": "Bag" },
    h("ul", { class: "lines" }, ...bag.lines.map((l) => line(bag, l))),
    totals(bag),
    bag.problems.length && !bag.order
      ? h("ul", { class: "problems" }, ...bag.problems.map((p) => h("li", {}, p)))
      : null,
    payArea(bag),
  );
}

// --- render -----------------------------------------------------------------------------------

function render() {
  root.replaceChildren(
    header(),
    state.view === "catalog" ? catalogScreen() : bagScreen(),
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

host = connect({ result: show, theme: setTheme });
const remembered = host.recalled().mode;
if (remembered === "hand" || remembered === "assistant") state.mode = remembered;
render();
