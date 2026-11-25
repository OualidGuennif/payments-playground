// Spec: knowledge/components/adyen-digital.md
// The digital playground's platform context and the Adyen client for a request's profile.
import { createPlatformContext, selectedSecrets } from "@suite/platform/base-api.ts";
import { AdyenTestClient } from "@suite/platform/adyen.ts";

export const context = createPlatformContext("digital");

export async function profileClient(request: Request) {
  const selected = await selectedSecrets(context, request);
  if (!selected.secrets.merchantAccount) {
    throw new Error("The selected TEST profile has no merchant account.");
  }
  return { ...selected, client: new AdyenTestClient(selected.secrets) };
}
