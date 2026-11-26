// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
// "This browser has an account here": a cookie with no personal data that outlives sign-out and an
// expired session, so a returning shopper is greeted and offered sign-in rather than sign-up or a
// bare form. It decides nothing: every page and route still asks for the session itself.
import { useEffect, useState } from "react";

const NAME = "velune_known";
const MAX_AGE = 400 * 86_400;

export function rememberAccount(): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing in Firefox; one fixed value
  document.cookie = `${NAME}=1; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
}

export const knownAccount = () =>
  document.cookie.split(";").some((part) => part.trim() === `${NAME}=1`);

/** False on the server and in the first render, then whether this browser had an account here. */
export function useKnownAccount(): boolean {
  const [known, setKnown] = useState(false);
  useEffect(() => setKnown(knownAccount()), []);
  return known;
}

/** The sign-in page, back to this page afterwards. */
export const signInHere = () =>
  `/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
