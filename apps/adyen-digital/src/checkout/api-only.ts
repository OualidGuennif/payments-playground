// Spec: knowledge/components/adyen-digital.md
// API only: this page's own card form, with Adyen-hosted Secure Fields for the card data.
import { type Core, CustomCard } from "@adyen/adyen-web";
import type { Theme } from "@suite/ui/theme.ts";
import type { MountedComponent } from "./client.ts";
import { CUSTOM_CARD_MARKUP, securedFieldStyles } from "./flow-helpers.ts";

/**
 * Bring-your-own-UI: this markup is ours, only the three data-cse spans
 * become Adyen-hosted Secure Fields iframes when CustomCard.mount() scans
 * this container. No prebuilt Card component involved.
 */
export function mountCustomCard(
  checkout: Core,
  host: HTMLElement,
  options: { theme: Theme; amountText: string },
): { component: MountedComponent; holderName: HTMLInputElement | null } {
  host.innerHTML = CUSTOM_CARD_MARKUP;
  const statusEl = host.querySelector<HTMLElement>('[data-role="status"]');
  const submitBtn = host.querySelector<HTMLButtonElement>('[data-role="submit"]');
  const holderName = host.querySelector<HTMLInputElement>("#customCardHolderName");
  const styles = securedFieldStyles(options.theme);
  const component = new CustomCard(checkout, {
    type: "card",
    autoFocus: true,
    ...(styles ? { styles } : {}),
    onLoad: () => {
      if (statusEl) statusEl.textContent = "Loading secure fields…";
    },
    onConfigSuccess: () => {
      if (statusEl) statusEl.textContent = "";
      if (submitBtn) submitBtn.disabled = false;
    },
    onBrand: (event: { brand?: string }) => {
      if (statusEl && event?.brand) {
        statusEl.textContent = `Detected network: ${event.brand.toUpperCase()}`;
      }
    },
    onValidationError: (errors: Array<{ fieldType?: string }>) => {
      const first = errors?.[0];
      if (statusEl && first?.fieldType) statusEl.textContent = `Check ${first.fieldType}.`;
    },
  } as never);
  if (submitBtn) submitBtn.textContent = `Pay ${options.amountText}`;
  submitBtn?.addEventListener("click", () => component.submit());
  component.mount(host);
  return { component: component as MountedComponent, holderName };
}
