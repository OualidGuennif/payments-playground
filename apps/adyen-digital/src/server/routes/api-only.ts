// Spec: knowledge/components/adyen-digital.md
// API only: the merchant's own form posts Adyen-encrypted card fields.
import { rejectRawCardData } from "@suite/platform/sanitize.ts";
import { status } from "elysia";
import { object } from "../input.ts";
import { createPayment } from "../payments.ts";
import { Elysia } from "elysia";

export const apiOnlyRoutes = new Elysia().post(
  "/api/digital/api-only",
  async ({ body: rawBody, request: http, server }) => {
    const body = object(rawBody);
    rejectRawCardData(body);
    const paymentMethod = object(body.paymentMethod);
    if (
      !Object.values(paymentMethod).some(
        (value) => typeof value === "string" && (value.startsWith("adyenjs_") || value.length > 12),
      )
    ) {
      return status(400, {
        error:
          "API Only accepts Adyen-encrypted component values or a stored payment method token, never raw card data.",
      });
    }
    // Reuse the Advanced Flow contract after the explicit PCI boundary check.
    return createPayment(
      { ...body, flow: "api-only-pci" },
      http,
      server?.requestIP(http)?.address,
      "api-only",
    );
  },
);
// Capture, cancel or refund. Each request carries the Idempotency-Key the
// Back Office minted for that intent (Adyen keeps it 7 to 14 days and returns
// the first response to a retry), and this route stores it too: a key it has
// seen answers with what is known instead of reaching Adyen again. A request
// Adyen answered "received" blocks another of its kind until its webhook,
// the only source of the outcome, arrives.;
