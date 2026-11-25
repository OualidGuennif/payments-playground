// Spec: knowledge/components/ask-agent.md
// Stage 1, deterministic security (spec invariant 4). Runs before any model sees a message: it
// normalizes the text, removes what hides instructions, takes out card numbers, IBANs and
// passwords, and refuses the injection phrasings and characters no shopper needs.
import type { StageVerdict } from "./sessions";

export const MAX_CHARS = 1_000;

export type RefusalReason =
  | "empty"
  | "too_long"
  | "hidden_characters"
  | "injection_signature"
  | "off_topic"
  | "injection"
  | "abuse"
  | "guard_unavailable"
  | "agent_failed"
  | "model_call_cap"
  | "output_blocked";

export type GateResult =
  | { ok: true; text: string; verdict: StageVerdict; scoreDelta: number; redacted: boolean }
  | { ok: false; reason: RefusalReason; verdict: StageVerdict; scoreDelta: number };

// Unicode tag characters spell invisible ASCII: a known way to smuggle instructions to a model.
const TAG_CHARS = /[\u{E0000}-\u{E007F}]/u;
// Zero-width characters, the soft hyphen, the word joiner, the BOM and bidirectional controls,
// by code point: written as a pattern they would sit invisibly in this file.
const isHidden = (cp: number) =>
  cp === 0xad ||
  cp === 0x61c ||
  cp === 0x180e ||
  cp === 0xfeff ||
  (cp >= 0x200b && cp <= 0x200f) ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2060 && cp <= 0x2064) ||
  (cp >= 0x2066 && cp <= 0x2069);
// C0 and C1 controls except tab and newline.
const isControl = (cp: number) =>
  (cp <= 0x1f && cp !== 0x09 && cp !== 0x0a) || (cp >= 0x7f && cp <= 0x9f);
const without = (text: string, drop: (cp: number) => boolean) =>
  [...text].filter((ch) => !drop(ch.codePointAt(0) ?? 0)).join("");

// The delimiters the agent prompt wraps facts and shopper text in, and other role markers a
// shopper might type to fake a boundary; removed from the text whatever the case.
const DELIMITERS =
  /<\s*\/?\s*(?:shop_context|shopper_message|system|assistant|developer|tool|instructions?)\b[^>]*>/gi;

// Strong signatures refuse the message: phrasings that only make sense as an attack on the agent.
// Each one names what is attacked right after the verb, so "forget the previous order, what are
// your return rules?" or "show me the care instructions" stay honest questions.
const STRONG: RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|your|these|those|of)\s+){0,3}(?:(?:previous|prior|above|earlier|preceding|system|original|initial)\s+)?(?:instructions?|prompts?|guidelines?|directives?)\b/,
  /\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|your)\s+){0,2}(?:previous|prior|above|earlier|preceding|system|original|initial)\s+(?:rules?|messages?|context)\b/,
  /\b(?:reveal|show|print|repeat|output|display|leak|dump|give|tell)\s+(?:me\s+)?(?:(?:your|the|all|of|full)\s+){0,3}(?:system|hidden|initial|original|developer|secret)\s+(?:prompt|instructions?|message|rules?)\b/,
  /\brepeat\s+(?:everything|the text|all(?: of)? the text|the words)\s+(?:above|before)\b/,
  /\byou\s+are\s+now\s+(?:in\s+)?(?:an?\s+)?(?:dan|developer mode|jailbroken|unrestricted|unfiltered|uncensored)\b/,
  /\b(?:developer|god|debug|admin)\s+mode\b/,
  /\bjailbreak|\bdo anything now\b/,
  /<\|[a-z_]{2,20}\|>|\[\/?inst\]|<<\/?sys>>|<\/?s>/,
  /^\s*(?:new|updated)\s+(?:system\s+)?instructions?\s*:/m,
  // French.
  /\b(?:ignore|ignorez|oublie|oubliez|contourne|contournez)\s+(?:(?:toutes?|tous|les|tes|vos|ces|mes)\s+){0,3}(?:(?:precedentes?|anterieures?)\s+)?(?:instructions?|consignes?|directives?)\b/,
  /\b(?:ignore|ignorez|oublie|oubliez)\s+(?:(?:toutes?|les|tes|vos)\s+){0,2}(?:regles?|messages?)\s+(?:precedente?s?|du systeme|systeme)\b/,
  /\b(?:montre|affiche|revele|repete|donne|ecris)(?:[- ]moi)?\s+(?:(?:ton|tes|le|les|vos|votre|tout)\s+){0,2}(?:prompt(?:\s+systeme)?|(?:instructions?|consignes?)\s+(?:systeme|cachee?s?|initiale?s?|secrete?s?))\b/,
  /\b(?:tu es|vous etes)\s+(?:maintenant|desormais)\s+(?:en\s+)?(?:mode\s+)?(?:dan|sans limites?|sans restrictions?|debride)\b/,
  /^\s*nouvelles?\s+(?:instructions?|consignes?)\s*:/m,
];

// Weak signatures only lower the score: they also appear in honest questions.
const WEAK: RegExp[] = [
  /\bsystem\s+prompt\b|\bprompt\s+systeme\b/,
  /\b(?:pretend (?:to be|you are)|roleplay|role-play|fais comme si|joue le role)\b/,
  /\bact as (?:a|an|my|if)\s+(?:different|new|unrestricted|evil|hacker|developer|system|admin)/,
  /\b(?:base64|rot13|hex(?:adecimal)? encod)/,
];

// Lowercase, accents removed, runs of spaces collapsed: one copy the signatures are matched on.
const folded = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ \t]+/g, " ");

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of moved) {
    const value = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

// Card numbers (13 to 19 digits, spaces or dashes between groups) that pass Luhn, valid IBANs, and
// a value typed after "password" or "mot de passe" never reach a model, a log or a transcript.
export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let out = text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return match;
    redacted = true;
    return "[card number removed]";
  });
  out = out.replace(/\b[A-Za-z]{2}\d{2}(?:[ ]?[A-Za-z0-9]){11,30}\b/g, (match) => {
    if (!ibanValid(match)) return match;
    redacted = true;
    return "[IBAN removed]";
  });
  out = out.replace(
    /\b(password|passwd|pwd|passcode|mot de passe|mdp|code pin|pin)\s*(?:is|est|:|=)\s*\S+/gi,
    (_match, label: string) => {
      redacted = true;
      return `${label}: [removed]`;
    },
  );
  return { text: out, redacted };
}

// Links to another site; the store's own host is the one exception.
export function foreignLinks(text: string, storeHost: string): string[] {
  const found = text.match(/\b(?:https?:\/\/|www\.)[^\s<>()"']+/gi) ?? [];
  return found.filter((link) => {
    try {
      const url = new URL(link.startsWith("www.") ? `https://${link}` : link);
      return url.host.toLowerCase() !== storeHost.toLowerCase();
    } catch {
      return true;
    }
  });
}

const verdict = (result: string, scoreDelta: number, detail?: string): StageVerdict => ({
  stage: "gate",
  result,
  scoreDelta,
  ...(detail ? { detail } : {}),
});

export function gate(input: unknown, storeHost: string): GateResult {
  if (typeof input !== "string")
    return { ok: false, reason: "empty", scoreDelta: 0, verdict: verdict("empty", 0) };
  const normalized = input.normalize("NFKC");
  if (TAG_CHARS.test(normalized))
    return {
      ok: false,
      reason: "hidden_characters",
      scoreDelta: -10,
      verdict: verdict("hidden_characters", -10),
    };
  const notes: string[] = [];
  let delta = 0;
  let text = without(normalized, isControl);
  const withoutHidden = without(text, isHidden);
  if (withoutHidden !== text) {
    notes.push("hidden characters removed");
    delta -= 10;
    text = withoutHidden;
  }
  const withoutDelimiters = text.replace(DELIMITERS, "");
  if (withoutDelimiters !== text) {
    notes.push("delimiters removed");
    text = withoutDelimiters;
  }
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text)
    return { ok: false, reason: "empty", scoreDelta: delta, verdict: verdict("empty", delta) };
  if (text.length > MAX_CHARS)
    return {
      ok: false,
      reason: "too_long",
      scoreDelta: delta,
      verdict: verdict("too_long", delta),
    };
  // Matched after hidden characters are gone, so a zero-width space inside "ignore" cannot split a signature.
  const probe = folded(withoutHidden);
  const strong = STRONG.find((re) => re.test(probe));
  if (strong)
    return {
      ok: false,
      reason: "injection_signature",
      scoreDelta: delta - 30,
      verdict: verdict("injection_signature", delta - 30, strong.source.slice(0, 60)),
    };
  if (WEAK.some((re) => re.test(probe))) {
    notes.push("weak signature");
    delta -= 10;
  }
  const secrets = redactSecrets(text);
  if (secrets.redacted) {
    notes.push("secret removed");
    delta -= 5;
    text = secrets.text;
  }
  if (foreignLinks(text, storeHost).length) {
    notes.push("link to another site");
    delta -= 5;
  }
  return {
    ok: true,
    text,
    redacted: secrets.redacted,
    scoreDelta: delta,
    verdict: verdict("allow", delta, notes.join(", ") || undefined),
  };
}
