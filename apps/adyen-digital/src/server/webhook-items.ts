// Spec: knowledge/components/adyen-digital.md
// Reading a standard webhook delivery and finding the order it belongs to.
import type { StandardWebhookItem } from "@suite/platform/hmac.ts";
import type { OrderAggregate, ProfileSecrets } from "@suite/platform/types.ts";
import { context } from "./context.ts";
import { object } from "./input.ts";

export async function hmacSecrets(): Promise<ProfileSecrets[]> {
  const profiles = await context.profiles.listPublic();
  const values: ProfileSecrets[] = [];
  for (const profile of profiles) {
    const secrets = await context.profiles.getSecrets(profile.id);
    if (secrets?.hmacKey) values.push(secrets);
  }
  return values;
}

export function webhookItems(payload: unknown): StandardWebhookItem[] {
  const root = object(payload);
  if (!Array.isArray(root.notificationItems)) return [root as StandardWebhookItem];
  return root.notificationItems.map(
    (entry) => object(object(entry).NotificationRequestItem) as StandardWebhookItem,
  );
}

export function correlateWebhook(item: StandardWebhookItem): OrderAggregate | undefined {
  const additional = object(item.additionalData);
  const linkId = String(additional.paymentLinkId ?? "");
  if (linkId) {
    const byLink = context.repository.findOrderByPaymentLinkId(linkId);
    if (byLink) return byLink;
  }
  const merchantReference = String(item.merchantReference ?? "");
  if (merchantReference) {
    const byReference = context.repository.getOrderByReference(merchantReference);
    if (byReference) return byReference;
  }
  // CAPTURE, CANCELLATION and REFUND carry the reference this server gave the
  // modification ("capture-<order>"), so their payment is found through the
  // original PSP reference instead.
  for (const reference of [item.originalReference, item.pspReference]) {
    if (!reference) continue;
    const byPsp = context.repository.findOrderByPspReference(String(reference));
    if (byPsp) return byPsp;
  }
  return undefined;
}

export const MODIFICATION_EVENTS: Record<string, "capture" | "cancel"> = {
  CAPTURE: "capture",
  CANCELLATION: "cancel",
};
