// Spec: knowledge/components/ask-agent.md
// Stage 5, deterministic output filter (spec invariant 8). The agent's text is never an authority:
// whatever a model wrote passes here before a shopper reads it, so a leaked prompt, a link that
// carries data off the store, a card number or an invented price stops at this point.
import { redactSecrets } from "./gate";
import type { StageVerdict } from "./sessions";

export const MAX_ANSWER_CHARS = 2_000;
export const MAX_PRICES = 500;
export const PRICE_PLACEHOLDER = "(price on the card)";
export const LINK_PLACEHOLDER = "[link removed]";

export type OutputResult =
  | { ok: true; text: string; scoreDelta: number; verdict: StageVerdict }
  | { ok: false; reason: "output_blocked"; scoreDelta: number; verdict: StageVerdict };

// Letters and digits only, lowercased: a canary spelled with spaces, dashes or capitals still matches.
const squashed = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const onStore = (href: string, storeOrigin: string) => {
  try {
    // Resolved against the store, so a relative path stays and "//evil.example" does not.
    return new URL(href, storeOrigin).origin === storeOrigin;
  } catch {
    return false;
  }
};

// Markdown links and images whose target is off the store keep their label and lose the target:
// an image URL is the classic way to carry a conversation to another server.
const MARKDOWN_LINK = /!?\[([^\]\n]{0,300})\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;
const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>()"'\]]+/gi;

function withoutForeignLinks(text: string, storeOrigin: string) {
  let removed = 0;
  const out = text
    .replace(MARKDOWN_LINK, (match, label: string, href: string) => {
      if (onStore(href, storeOrigin)) return match;
      removed++;
      return label;
    })
    .replace(BARE_URL, (url) => {
      if (onStore(url.startsWith("www.") ? `https://${url}` : url, storeOrigin)) return url;
      removed++;
      return LINK_PLACEHOLDER;
    });
  return { text: out, removed };
}

// Spaces a writer puts in an amount: the ordinary one and the two no-break spaces French uses.
const SPACE = `[ ${String.fromCharCode(0xa0, 0x202f)}]`;
const NUMBER = `(?:\\d{1,3}(?:[.,${SPACE.slice(1, -1)}]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?`;
const AMOUNT = new RegExp(
  `(?:€|\\bEUR)${SPACE}?(${NUMBER})(?!\\d)|(?<![\\d.,])(${NUMBER})${SPACE}?(?:€|EUR\\b|euros?\\b)`,
  "gi",
);

// "1.299,00", "1,299.00", "1 299" and "12,5" to minor units. The last separator is the decimal one
// only when one or two digits follow it; every other separator groups thousands.
export function amountToMinor(raw: string): number | undefined {
  const compact = raw.replace(new RegExp(SPACE, "g"), "");
  const decimal = /[.,](\d{1,2})$/.exec(compact);
  const whole = (decimal ? compact.slice(0, decimal.index) : compact).replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return undefined;
  const cents = decimal ? Number(decimal[1]?.padEnd(2, "0")) : 0;
  const minor = Number(whole) * 100 + cents;
  return Number.isSafeInteger(minor) ? minor : undefined;
}

// Every EUR amount written in a text, in minor units: the shopper's own figures count as known.
export function amountsIn(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(AMOUNT)) {
    const minor = amountToMinor(match[1] ?? match[2] ?? "");
    if (minor !== undefined) found.push(minor);
  }
  return found;
}

const PRICE_KEY = /amount|price|total|subtotal|limit|remaining|spent/i;

// The integers a tool result holds under a price-like key (the store speaks EUR minor units).
export function pricesIn(value: unknown, found: number[] = [], depth = 0): number[] {
  if (depth > 12 || found.length >= MAX_PRICES || value === null || typeof value !== "object")
    return found;
  for (const [key, child] of Object.entries(value)) {
    if (found.length >= MAX_PRICES) break;
    if (PRICE_KEY.test(key) && Number.isSafeInteger(child) && (child as number) >= 0)
      found.push(child as number);
    else if (typeof child === "object") pricesIn(child, found, depth + 1);
  }
  return found;
}

// Newest first, so the bounded list keeps what the conversation is about now.
export const mergePrices = (known: number[], added: number[]) =>
  [...new Set([...added, ...known])].slice(0, MAX_PRICES);

function withoutUnknownAmounts(text: string, prices: number[]) {
  const known = new Set(prices);
  let replaced = 0;
  const out = text.replace(AMOUNT, (match, before?: string, after?: string) => {
    const minor = amountToMinor(before ?? after ?? "");
    if (minor !== undefined && known.has(minor)) return match;
    replaced++;
    return PRICE_PLACEHOLDER;
  });
  return { text: out, replaced };
}

// Cut at the last sentence end that keeps at least half the room; else at the cap.
function capped(text: string) {
  if (text.length <= MAX_ANSWER_CHARS) return { text, cut: false };
  const head = text.slice(0, MAX_ANSWER_CHARS - 1);
  const end = Math.max(...[". ", "! ", "? ", "\n"].map((mark) => head.lastIndexOf(mark)));
  const kept = end >= MAX_ANSWER_CHARS / 2 ? head.slice(0, end + 1) : head;
  return { text: `${kept.trimEnd()}…`, cut: true };
}

export function filterOutput(input: {
  text: string;
  canary: string;
  storeOrigin: string;
  prices: number[];
}): OutputResult {
  const canary = squashed(input.canary);
  if (canary.length >= 12 && squashed(input.text).includes(canary))
    return {
      ok: false,
      reason: "output_blocked",
      scoreDelta: -100,
      verdict: { stage: "output", result: "output_blocked", scoreDelta: -100, detail: "canary" },
    };
  const notes: string[] = [];
  let delta = 0;
  const links = withoutForeignLinks(input.text, input.storeOrigin);
  if (links.removed) {
    notes.push(`${links.removed} link(s) removed`);
    delta -= 5;
  }
  const secrets = redactSecrets(links.text);
  if (secrets.redacted) notes.push("secret removed");
  const amounts = withoutUnknownAmounts(secrets.text, input.prices);
  if (amounts.replaced) notes.push(`${amounts.replaced} amount(s) replaced`);
  const final = capped(amounts.text.trim());
  if (final.cut) notes.push("cut");
  return {
    ok: true,
    text: final.text,
    scoreDelta: delta,
    verdict: {
      stage: "output",
      result: "allow",
      scoreDelta: delta,
      ...(notes.length ? { detail: notes.join(", ") } : {}),
    },
  };
}
