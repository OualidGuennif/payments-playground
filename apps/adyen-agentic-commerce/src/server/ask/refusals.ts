// Spec: knowledge/components/ask-agent.md
// The fixed sentences a refused message gets instead of a model's answer, in French when the
// shopper writes French, else in English.
import type { RefusalReason } from "./gate";

export type Lang = "fr" | "en";

const FRENCH =
  /[àâçéèêëîïôûùüÿœ]|\b(?:je|tu|vous|bonjour|salut|merci|est-ce|pour|avec|une|des|les|mon|ma|mes|quel|quelle|cherche|veux|voudrais|robe|chemise|taille|panier)\b/i;

export const languageOf = (text: string): Lang => (FRENCH.test(text) ? "fr" : "en");

// The store's line: what anything off the shop gets, from the guard, the gate or the agent itself,
// so the Personal Shopper never talks about itself and never shows what it noticed.
export const STORE_LINE: Record<Lang, string> = {
  en: "I'm your Atelier Velune Personal Shopper: I'm here for our pieces, sizes, your bag and your orders. What can I find for you today?",
  fr: "Je suis votre Personal Shopper Atelier Velune : je suis là pour nos pièces, les tailles, votre panier et vos commandes. Que puis-je vous trouver aujourd'hui ?",
};

const TEXTS: Record<RefusalReason, Record<Lang, string>> = {
  empty: {
    en: "Type a question about the shop and I'll help.",
    fr: "Posez une question sur la boutique et je vous aide.",
  },
  too_long: {
    en: "That message is too long for me. Could you shorten it to under 1,000 characters?",
    fr: "Ce message est trop long. Pouvez-vous le raccourcir sous 1 000 caractères ?",
  },
  hidden_characters: {
    en: "Your message contains hidden characters I can't accept. Please retype it.",
    fr: "Votre message contient des caractères cachés que je ne peux pas accepter. Merci de le retaper.",
  },
  injection_signature: STORE_LINE,
  off_topic: STORE_LINE,
  injection: STORE_LINE,
  abuse: {
    en: "I can't help with that. I'm here for questions about the shop.",
    fr: "Je ne peux pas vous aider avec ça. Je suis là pour vos questions sur la boutique.",
  },
  guard_unavailable: {
    en: "I can't answer right now. Please try again in a moment.",
    fr: "Je ne peux pas répondre pour l'instant. Réessayez dans un instant.",
  },
  agent_failed: {
    en: "Something went wrong on my side. Please try again.",
    fr: "Un problème est survenu de mon côté. Merci de réessayer.",
  },
  model_call_cap: {
    en: "That took me too many steps. Could you ask in a simpler way?",
    fr: "Cela m'a demandé trop d'étapes. Pouvez-vous reformuler plus simplement ?",
  },
  output_blocked: {
    en: "I can't share that answer. Ask me about our products, your bag or your orders.",
    fr: "Je ne peux pas partager cette réponse. Demandez-moi nos produits, votre panier ou vos commandes.",
  },
};

export const refusalText = (reason: RefusalReason, lang: Lang) => TEXTS[reason][lang];
