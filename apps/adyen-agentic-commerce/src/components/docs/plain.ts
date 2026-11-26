// Spec: knowledge/components/adyen-agentic-commerce.md
// The Docs in plain words, for a reader who is not an engineer: what each part is for, said
// before its diagram, and what to keep from it, said after. The steps themselves stay in
// content.ts; this file only frames them.

export type Plain = { plain: string[]; remember: string[] };

export const OVERVIEW_PLAIN: Plain = {
  plain: [
    "This store is a demo of shopping through an AI assistant. You tell an assistant such as ChatGPT what you want, and it does the clicking for you, through entrances the store built for software: a tool server, a shopping API and tools in the page.",
    "Each page of these docs answers one question: how the assistant finds the store and what it sells (MCP, UCP, WebMCP), how it proves who it is and gets your permission (Poppy), and how the payment is taken without the assistant ever touching your card (Adyen).",
  ],
  remember: [
    "The assistant never sees your card. It names a card you saved yourself, or hands the bag back to you to pay.",
    "You set the budget. The store checks every payment against it, and you can lower it or disconnect the assistant from your account page.",
    "Every message in these diagrams shows up in the Back Office log, so you can watch a real purchase happen.",
  ],
};

export const HOW_TO_READ =
  "Each column is one party. Each arrow is one message, read from top to bottom, and a dashed arrow is an answer. Next and Back walk through the messages one at a time; the same steps are written out under the diagram.";

export const GLOSSARY: [string, string][] = [
  ["Assistant or agent", "A program, often a chat AI, that acts for you."],
  [
    "MCP",
    "A standard way for an assistant to use tools on a server, like a remote control with labelled buttons.",
  ],
  ["UCP", "The shopping vocabulary: catalogue, cart, checkout, order."],
  ["Poppy (PAP)", "How an assistant introduces itself and asks for your permission."],
  ["Token", "The pass the assistant gets once you allow it. It carries only what you allowed."],
  ["Scope", "One thing the pass allows, such as managing carts or paying."],
  ["Webhook", "Adyen's message to the store confirming a payment, signed so it cannot be faked."],
  ["Adyen TEST", "Adyen's test platform. Payments look real, but no money moves."],
];

export const PLAIN: Record<string, Plain> = {
  poppy: {
    plain: [
      "When someone rings your doorbell saying they come from your bank, you want proof. Poppy gives a store that proof about an AI assistant: the assistant has its own web address, publishes its public keys there, and signs its requests with a private key only it holds.",
      "Poppy also covers permission. The assistant cannot shop on your account until you sign in on this store's own page, read what it asks for, choose a budget and press Allow.",
    ],
    remember: [
      "The store checks the assistant's identity at every sign-in, so nobody can borrow its name.",
      "You type your password on the store's page; the assistant never gets it.",
      "Each connected assistant appears on your account page, where you can disconnect it at any time.",
    ],
  },
  mcp: {
    plain: [
      "MCP is a plug standard. Any assistant that speaks it, ChatGPT or Claude for example, can connect to any server that offers tools, the way any USB device fits any USB port. This store offers 13 tools: search the catalogue, build a cart, check out, pay, read an order.",
      'The first time the assistant connects, the store answers "sign in first" and points to its sign-in page. Once you allow it, the assistant comes back with a pass and can use the tools within what you allowed.',
    ],
    remember: [
      "The store checks every tool call against the pass: what you allowed, and the budget left.",
      "Paying is a separate tool marked as one to confirm, so a careful assistant asks you before using it.",
      "Over budget, the assistant gets a link for you to pay yourself or to raise its budget.",
    ],
  },
  "code-mode": {
    plain: [
      'Think of giving a helper a written shopping list instead of phoning them about every item. With plain MCP the assistant makes one call, waits, reads the whole answer, then makes the next. With Code Mode it writes a short program once ("find a linen shirt, take the first size in stock, start a checkout") and the store runs it.',
      "The program runs in a sealed box inside the store. The box can only press the store's own buttons, with the assistant's own pass. It cannot reach the internet, read files or pay.",
    ],
    remember: [
      "The assistant makes one round trip and reads only the result it asked for, instead of every answer along the way.",
      "Each step inside the code is checked exactly like a normal tool call, so the code can do nothing the assistant could not do already.",
      "Paying always happens outside the code, as one call you can be asked to confirm.",
    ],
  },
  webmcp: {
    plain: [
      'WebMCP is for an assistant built into your browser, one that sees the page you are on. The page hands it a few tools that do the same things as the buttons you see, which suits a request like "add the shirt in M to my bag" while you browse. Your browser needs WebMCP switched on; the check further down says whether it is.',
    ],
    remember: [
      "The tools do only what the page's own buttons do.",
      "Nothing here signs you in or spends money: you pay yourself on the checkout page.",
    ],
  },
  ucp: {
    plain: [
      "UCP is a shared vocabulary for shopping: what a product, a cart, a checkout and an order look like, and how payment is offered. An assistant that learned it once can shop at any store that speaks it.",
      "The store publishes a profile saying what it supports, then answers the same requests over a plain web API (REST) and over MCP. Both run the same code, so prices and rules are the same whichever door is used.",
    ],
    remember: [
      "The store computes every price and total; the assistant only says what you want.",
      "A checkout moves through a few clear states: not ready, ready to pay, paid, or waiting for you.",
      "Assistants have two ways to pay: a card you saved, or a one-time card token the assistant holds.",
    ],
  },
  adyen: {
    plain: [
      "Adyen is the payment company behind the checkout. Everything here runs on Adyen's TEST platform, so the cards are test cards and no real money moves.",
      "There are two kinds of payment. When you pay yourself, Adyen's Drop-in form in your browser sends your card straight to Adyen, and the store never sees the number. When an assistant pays, the store asks Adyen to charge a card you saved earlier, on your behalf.",
    ],
    remember: [
      "Your card number never reaches the store or the assistant.",
      "A payment counts only when Adyen says so, in its answer or in a signed webhook.",
      "A declined card ends that attempt only. The order stays open, so you or the assistant can try again.",
    ],
  },
  chatgpt: {
    plain: [
      "In ChatGPT the store draws a small shop inside the conversation: a row of products and a bag you can tap. You connect the store once; after that the carousel and the bag appear whenever you shop.",
      "You can tap to pick a colour and size, or just ask the assistant. Either way the rules are those of any connected assistant: your permission, your budget, and no card details in the chat.",
    ],
    remember: [
      "The widget is a window on the store; it holds no pass and no card.",
      "Tapping Pay asks ChatGPT to run the payment tool, and ChatGPT may ask you to confirm.",
    ],
  },
};

// A ten-minute tour for someone presenting the store: each stop says what to do and what the
// audience should notice. Links stay on this origin.
export type DemoStop = { minutes: number; title: string; act: string; see: string; href: string };

export const DEMO: DemoStop[] = [
  {
    minutes: 1,
    title: "Put the shop and its log side by side",
    act: "Open the shop in one window and the Back Office log in another.",
    see: "Every request from now on appears in the log within a second, with who sent it and what the store answered.",
    href: "/back-office",
  },
  {
    minutes: 2,
    title: "Ask the store's own assistant",
    act: "Press Ask, type `add the printed silk scarf to my bag`, then pick a colour.",
    see: "The bag in the chat and the Cart count at the top change together: there is one bag per browser, whoever fills it.",
    href: "/shop",
  },
  {
    minutes: 1,
    title: "Pay for the bag yourself",
    act: "Open the cart, go to checkout and pay with an Adyen test card.",
    see: "While that payment runs, any other attempt on the same checkout, from the chat or from an assistant, is refused until the first one ends.",
    href: "/cart",
  },
  {
    minutes: 2,
    title: "Connect an outside assistant",
    act: "Add this store's MCP address to ChatGPT or Claude, sign in on the store's page, set a budget and press Allow. Then ask it for a linen shirt.",
    see: "The assistant searches and builds a checkout. It never asks for your password or card.",
    href: "/agents",
  },
  {
    minutes: 1,
    title: "Go over the budget",
    act: "Ask the assistant for something that costs more than the budget you set.",
    see: "The store stops it and gives a link instead. You approve the purchase or raise the budget from your account page.",
    href: "/account",
  },
  {
    minutes: 1,
    title: "Show Code Mode",
    act: "From a copy of the code, run `bun scripts/pap-agent.ts --auto-consent --code-mode`.",
    see: "The assistant sends one short program instead of one call per step. The log shows one Code Mode line followed by each store call it made.",
    href: "/docs/code-mode",
  },
  {
    minutes: 1,
    title: "Read the order",
    act: "Open Orders in the Back Office and pick the newest one.",
    see: "The order comes from Adyen's answer, never from the browser. A declined card would leave it open for another try.",
    href: "/back-office",
  },
  {
    minutes: 1,
    title: "End with the browser's own assistant",
    act: 'In a browser with WebMCP switched on, open the WebMCP page and read "In this browser".',
    see: "The page lends the browser's assistant the same few actions as its buttons, and nothing more.",
    href: "/docs/webmcp",
  },
];
