import { assertEquals, assertRejects } from "@std/assert";
import adyenApiLibrary from "@adyen/api-library";
import { type AdyenHttpClient, AdyenRequestError, AdyenTestClient } from "./adyen.ts";

const { HttpClientException } = adyenApiLibrary;

type Call = Parameters<AdyenHttpClient["request"]>;

/** Stands in for the library's transport so the request it is handed can be inspected. */
function recordingHttpClient(respond: () => Promise<string>) {
  const calls: Call[] = [];
  const httpClient: AdyenHttpClient = {
    request: (...call: Call) => {
      calls.push(call);
      return respond();
    },
  };
  return { calls, httpClient };
}

Deno.test("sessions uses the exact Checkout v72 TEST endpoint and TEST credentials", async () => {
  const { calls, httpClient } = recordingHttpClient(() =>
    Promise.resolve(JSON.stringify({ id: "CS_TEST", sessionData: "session-data" }))
  );
  const client = new AdyenTestClient({
    apiKey: "test-api-key",
    merchantAccount: "TestMerchant",
  }, httpClient);

  const response = await client.sessions({
    merchantAccount: "TestMerchant",
    amount: { currency: "EUR", value: 2599 },
  }, "idem-test");

  assertEquals(calls.length, 1);
  const [endpoint, json, config, isApiKeyRequired, requestOptions] = calls[0];
  assertEquals(endpoint, "https://checkout-test.adyen.com/v72/sessions");
  assertEquals(config.apiKey, "test-api-key");
  assertEquals(config.environment, "TEST");
  assertEquals(isApiKeyRequired, true);
  assertEquals(requestOptions.method, "POST");
  assertEquals(requestOptions.idempotencyKey, "idem-test");
  assertEquals(JSON.parse(json).merchantAccount, "TestMerchant");
  assertEquals(response, { id: "CS_TEST", sessionData: "session-data" });
});

Deno.test("Adyen HTTP errors preserve the upstream status and safe message", async () => {
  const responseBody = JSON.stringify({
    status: 422,
    errorCode: "901",
    message: "Invalid Merchant Account",
  });
  const { httpClient } = recordingHttpClient(() =>
    Promise.reject(
      new HttpClientException({
        message: "HTTP Exception: 422. Unprocessable Entity",
        statusCode: 422,
        errorCode: "901",
        responseBody,
        apiError: JSON.parse(responseBody),
      }),
    )
  );
  const client = new AdyenTestClient({
    apiKey: "test-api-key",
    merchantAccount: "TestMerchant",
  }, httpClient);

  const error = await assertRejects(
    () => client.paymentMethods({ merchantAccount: "TestMerchant" }),
    AdyenRequestError,
    "Invalid Merchant Account",
  );
  assertEquals(error.statusCode, 422);
  assertEquals(error.errorCode, "901");
});

Deno.test("a transport failure is reported as a connection error, not a 500", async () => {
  const { httpClient } = recordingHttpClient(() =>
    // The shape the library rejects with when the socket itself fails.
    Promise.reject({
      name: "ApiException",
      statusCode: 500,
      message: "connect ECONNREFUSED 1.2.3.4:443",
    })
  );
  const client = new AdyenTestClient({
    apiKey: "test-api-key",
    merchantAccount: "TestMerchant",
  }, httpClient);

  const error = await assertRejects(
    () => client.paymentMethods({ merchantAccount: "TestMerchant" }),
    AdyenRequestError,
    "Adyen TEST connection failed: connect ECONNREFUSED 1.2.3.4:443",
  );
  assertEquals(error.statusCode, 502);
});
