import { assertEquals } from "@std/assert";
import { paymentsRiskFields, sessionRiskFields } from "./sessionContext.ts";
import { addressDataset } from "./addresses.ts";

function nativeThreeDS(fields: Record<string, unknown>): unknown {
  const authenticationData = fields.authenticationData as {
    threeDSRequestData: { nativeThreeDS: string };
  };
  return authenticationData.threeDSRequestData.nativeThreeDS;
}

Deno.test("native 3DS is preferred unless the playground switch turns it off", () => {
  const { billingAddress, deliveryAddress } = addressDataset("FR");
  assertEquals(nativeThreeDS(sessionRiskFields("FR")), "preferred");
  assertEquals(nativeThreeDS(sessionRiskFields("FR", false)), "disabled");
  assertEquals(nativeThreeDS(paymentsRiskFields(billingAddress, deliveryAddress)), "preferred");
  assertEquals(
    nativeThreeDS(paymentsRiskFields(billingAddress, deliveryAddress, false)),
    "disabled",
  );
});
