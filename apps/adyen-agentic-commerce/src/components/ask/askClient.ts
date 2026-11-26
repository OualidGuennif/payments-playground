"use client";
// Spec: knowledge/components/ask-agent.md
// The panel's only door to the server: /api/ask, every POST with X-Ask: 1. It holds no key, no
// model and no score; the server's answers say what the shopper may see.
import { useSyncExternalStore } from "react";
import { parseEvents, type StreamEvent } from "./askLogic";

export type Answer<T> = {
  status: number;
  data?: T;
  error?: string;
  message?: string;
  reason?: string;
};

const NETWORK = "The assistant could not be reached. Check your connection and try again.";
const POST_HEADERS = { "content-type": "application/json", "x-ask": "1" };

async function problemOf<T>(response: Response): Promise<Answer<T>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    status: response.status,
    error: text(body.error) ?? "unknown",
    message: text(body.message) ?? "Something went wrong. Please try again.",
    reason: text(body.reason),
  };
}

export async function askCall<T>(path: string, body?: unknown): Promise<Answer<T>> {
  try {
    const response = await fetch(
      `/api/ask${path}`,
      body === undefined
        ? { cache: "no-store" }
        : { method: "POST", headers: POST_HEADERS, body: JSON.stringify(body) },
    );
    if (!response.ok) return problemOf(response);
    return { status: response.status, data: (await response.json()) as T };
  } catch {
    return { status: 0, error: "network", message: NETWORK };
  }
}

// A message's answer arrives as a stream; each complete event is handed over as it comes.
export async function sendMessage(
  text: string,
  page: string,
  onEvent: (event: StreamEvent) => void,
  bag?: { variantId: string; quantity: number }[],
): Promise<Answer<undefined>> {
  let response: Response;
  try {
    response = await fetch("/api/ask/messages", {
      method: "POST",
      headers: POST_HEADERS,
      body: JSON.stringify({ text, page, bag }),
    });
  } catch {
    return { status: 0, error: "network", message: NETWORK };
  }
  if (!response.ok || !response.body) return problemOf(response);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const parsed = parseEvents(buffer + value.replaceAll("\r\n", "\n"));
      buffer = parsed.rest;
      for (const event of parsed.events) onEvent(event);
    }
  } catch {
    return { status: 0, error: "network", message: NETWORK };
  }
  return { status: response.status };
}

// Open or closed, shared by the header's button and the panel; a reload reopens it.
const OPEN_KEY = "av-ask-open";
let open = false;
const listeners = new Set<() => void>();

export function setAskOpen(next: boolean) {
  open = next;
  try {
    if (next) sessionStorage.setItem(OPEN_KEY, "1");
    else sessionStorage.removeItem(OPEN_KEY);
  } catch {
    // Storage refused (private mode): the panel still opens, it just will not reopen on reload.
  }
  for (const listener of listeners) listener();
}

export function wasAskOpen(): boolean {
  try {
    return sessionStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAskOpen = () =>
  useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
