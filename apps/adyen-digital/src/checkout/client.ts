// Spec: knowledge/components/adyen-digital.md
// What every flow module shares: the Eden client and the shapes Adyen Web hands its callbacks.
import type { Core } from "@adyen/adyen-web";
import { apiClient } from "@suite/ui/client.ts";
import type { App } from "@/server/api";

// Built per call with the profile the call is for: the client reads window,
// which a server render does not have.
export const api = (profileId?: string) => apiClient<App>(() => profileId);

/** What the result screen shows once a payment has an outcome. */
export interface PaymentOutcome {
  resultCode?: string;
  pspReference?: string;
  method?: string;
}

export interface CallbackActions {
  resolve(value?: unknown): void;
  reject(): void;
}

export interface MountedComponent {
  mount(el: HTMLElement): void;
  unmount(): void;
}

export type ComponentConstructor = new (
  checkout: Core,
  props?: Record<string, unknown>,
) => MountedComponent;

/** A non-empty string field of an Adyen answer, or undefined. */
export function field(value: unknown, key: string): string | undefined {
  const entry =
    value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof entry === "string" && entry ? entry : undefined;
}
