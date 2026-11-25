// Spec: knowledge/components/ask-agent.md
// Stage 1, deterministic security (spec invariant 4). Runs before any model sees a message: it
// normalizes the text, removes what hides instructions, takes out card numbers, IBANs and
// passwords, and refuses the injection phrasings and characters no shopper needs. The families
// follow the prompt-injection-defense skill's taxonomy (ATTACK-01 to ATTACK-12).
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
  | {
      ok: true;
      text: string;
      verdict: StageVerdict;
      scoreDelta: number;
      redacted: boolean;
      signals: string[];
    }
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

export const STRONG_DELTA = -35;

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
  // ATTACK-12, a faked boundary: our own delimiters, role tags and system headers.
  /<\s*\/?\s*(?:shop_context|shopper_message|last_answer|tool_data|system|assistant|developer|tool|instructions?|user_input)\b[^>]*>/,
  /^\s*#{1,6}\s*(?:system|assistant|developer|admin)\b|\[\s*(?:system|admin|developer)(?:\s+(?:message|prompt|note|override))?\s*\]/m,
  // ATTACK-03, claimed authority.
  /\b(?:i am|i'm|im|this is)\s+your\s+(?:developer|creator|admin(?:istrator)?|owner|operator|programmer|maker)\b/,
  /\b(?:i am|i'm|im|this is)\s+the\s+(?:developer|creator|admin(?:istrator)?|programmer)\s+of\s+(?:this|the|your)\s+(?:site|store|shop|assistant|bot|ai|model|chat)\b/,
  /\bthis is\s+(?:openai|anthropic|google|mistral|deepseek)\s+(?:speaking|support|staff|security|here|calling)\b/,
  /\b(?:system administrator|sysadmin|root user)\s+(?:here|speaking)\b|\b(?:maintenance|root|sudo|admin)\s+(?:override|access granted)\b|\binternal test(?:ing)? mode\b/,
  // ATTACK-02, a role without rules.
  /\b(?:act as|acting as|pretend|play (?:a|the) (?:character|role|game)|roleplay|role-play|you are now|from now on you are)\b[^.!?\n]{0,60}\b(?:no|without(?: any)?)\s+(?:rules?|restrictions?|limits?|filters?|guidelines?|censorship)\b/,
  // French.
  /\b(?:ignore|ignorez|oublie|oubliez|contourne|contournez)\s+(?:(?:toutes?|tous|les|tes|vos|ces|mes)\s+){0,3}(?:(?:precedentes?|anterieures?)\s+)?(?:instructions?|consignes?|directives?)\b/,
  /\b(?:ignore|ignorez|oublie|oubliez)\s+(?:(?:toutes?|les|tes|vos)\s+){0,2}(?:regles?|messages?)\s+(?:precedente?s?|du systeme|systeme)\b/,
  /\b(?:montre|affiche|revele|repete|donne|ecris)(?:[- ]moi)?\s+(?:(?:ton|tes|le|les|vos|votre|tout)\s+){0,2}(?:prompt(?:\s+systeme)?|(?:instructions?|consignes?)\s+(?:systeme|cachee?s?|initiale?s?|secrete?s?))\b/,
  /\b(?:tu es|vous etes)\s+(?:maintenant|desormais)\s+(?:en\s+)?(?:mode\s+)?(?:dan|sans limites?|sans restrictions?|debride)\b/,
  /^\s*nouvelles?\s+(?:instructions?|consignes?)\s*:/m,
  /\b(?:je suis|c'est|ici)\s+(?:ton|votre)\s+(?:developpeur|createur|administrateur|admin|concepteur|proprietaire)\b/,
  /\b(?:je suis|c'est|ici)\s+(?:le|l')\s*(?:developpeur|createur|administrateur|concepteur)\s+(?:du|de (?:ce|cet|cette|la|l'))\s*(?:site|magasin|boutique|assistant|bot|ia|chat)\b/,
  /\b(?:personnage|role|ia|assistant|joues?|incarnes?)\b[^.!?\n]{0,60}\bsans\s+(?:aucune?s?\s+)?(?:regles?|limites?|restrictions?|filtres?|censure)\b/,
];

// Weak signatures only lower the score and are named to the guard: they also appear in honest
// questions.
const WEAK: [signal: string, pattern: RegExp][] = [
  ["mentions the system prompt", /\bsystem\s+prompt\b|\bprompt\s+systeme\b/],
  [
    "role-play",
    /\b(?:pretend (?:to be|you are)|roleplay|role-play|fais comme si|joue le role)\b|\bact as (?:a|an|my|if)\s+(?:different|new|unrestricted|evil|hacker|developer|system|admin)/,
  ],
  ["mentions an encoding", /\b(?:base64|rot13|hex(?:adecimal)? encod)/],
  [
    "pressure or urgency",
    /\b(?:emergency|someone will die|you have \d+ seconds|i(?:'ll| will) report you|shut you down|urgence|quelqu'un va mourir|je vais te signaler)\b/,
  ],
  [
    "claims an earlier agreement or a right",
    /\b(?:as we (?:discussed|agreed)|you (?:already|previously) (?:agreed|said|promised|helped)|i have (?:admin|root|special) (?:rights|privileges|access)|comme convenu|tu (?:m'as|avais|as) deja (?:dit|promis|accepte))\b/,
  ],
  ["minimizes a request", /\b(?:just this once|juste cette fois)\b/],
];

// ATTACK-09: look-alike letters (Cyrillic, Greek) and digit spellings read as the Latin letters
// they imitate, so "іgnоrе" and "1gn0re" meet the same signatures as "ignore".
const LOOKALIKE: Record<string, string> = {
  а: "a",
  в: "b",
  е: "e",
  ё: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  ӏ: "l",
  α: "a",
  β: "b",
  ε: "e",
  η: "n",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
};
const DIGIT_LETTER: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
};
const latin = (text: string) => [...text].map((ch) => LOOKALIKE[ch] ?? ch).join("");
const undigited = (text: string) => text.replace(/[013457@$]/g, (ch) => DIGIT_LETTER[ch] ?? ch);

// Base64 runs long enough to carry a sentence, decoded when they read as text.
function decodedRuns(text: string): string[] {
  const runs = text.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? [];
  return runs.flatMap((run) => {
    const decoded = Buffer.from(run, "base64").toString("utf8");
    const printable = decoded.replace(/[^\x20-\x7e\u00a0-\u024f\s]/g, "");
    return printable.length >= decoded.length * 0.9 && /[a-z]{3}/i.test(decoded) ? [decoded] : [];
  });
}

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

// The first strong signature in a text, as it reads, with look-alikes and digit spellings read as
// letters, or inside a base64 run; matched after hidden characters are gone, so a zero-width space
// inside "ignore" cannot split it. Also screens the store's answers before the agent reads them.
export function strongSignature(text: string): string | undefined {
  const probes = [folded(text), folded(latin(text)), undigited(folded(latin(text)))];
  for (const decoded of decodedRuns(text)) probes.push(folded(latin(decoded)));
  for (const probe of probes) {
    const found = STRONG.find((re) => re.test(probe));
    if (found) return found.source.slice(0, 60);
  }
  return undefined;
}

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
  const strong = strongSignature(withoutHidden);
  if (strong)
    return {
      ok: false,
      reason: "injection_signature",
      scoreDelta: delta + STRONG_DELTA,
      verdict: verdict("injection_signature", delta + STRONG_DELTA, strong),
    };
  const probe = folded(latin(withoutHidden));
  const signals = WEAK.filter(([, re]) => re.test(probe)).map(([signal]) => signal);
  if (signals.length) {
    notes.push(...signals);
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
    signals,
    redacted: secrets.redacted,
    scoreDelta: delta,
    verdict: verdict("allow", delta, notes.join(", ") || undefined),
  };
}
