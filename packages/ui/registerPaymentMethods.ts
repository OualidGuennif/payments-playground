// Spec: knowledge/components/ui-package.md
import { AdyenCheckout, components } from "@adyen/adyen-web";

/**
 * Adyen Web tree-shakes any payment method component you don't explicitly
 * import, unlike the legacy playground, which loaded the UMD bundle from
 * Adyen's CDN with every component already included. An explicit per-method
 * whitelist here (Card, PayPal, ...) meant every new method the merchant
 * account enabled in the Adyen Customer Area (Affirm, Bancontact + its
 * BcmcMobile wallet variant, Klarna, ...) silently failed to render until
 * someone noticed and added it to the list, a maintenance trap.
 *
 * `components` is Adyen Web's own namespace export bundling every payment
 * method Element class it ships. Registering all of them removes the
 * whitelist entirely: whatever `/paymentMethods` returns for any country
 * renders correctly, today and for any method enabled later, with zero code
 * changes. The only time this needs touching again is a `@adyen/adyen-web`
 * version bump that adds brand-new component classes, which `components`
 * picks up automatically anyway.
 *
 * Import this module once (for its side effect) before the first
 * `AdyenCheckout(...)` call in any app that mounts Drop-in or lets the
 * shopper pick an individual Component.
 */
AdyenCheckout.register(...Object.values(components));
