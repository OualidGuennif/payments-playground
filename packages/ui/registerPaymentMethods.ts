// Spec: knowledge/components/ui-package.md
import { AdyenCheckout, components } from "@adyen/adyen-web";

/**
 * Adyen Web tree-shakes components that are not imported explicitly; a
 * per-method whitelist silently missed every method enabled later in the
 * Customer Area. `components` exports every Element class, so registering all
 * of them removes the whitelist: whatever `/paymentMethods` returns renders.
 * Import this module once, before the first `AdyenCheckout(...)` call.
 */
AdyenCheckout.register(...Object.values(components));
