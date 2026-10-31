// The package is CommonJS and re-exports its classes through getters, which
// Deno's CJS named-export detection cannot see, the default import is the
// whole `module.exports`, so reading the classes off it is the shape that
// works. See `library()` for why nothing is read at module load.
import adyenApiLibrary from "@adyen/api-library";
import type { ProfileSecrets } from "./types.ts";
import { assertTestOnly, profileIsTestOnly } from "./test-only.ts";

/**
 * The library's `ClientInterface`, taken off its own transport class. That
 * interface is a default export, which the same CJS interop cannot surface
 * as a type, but every implementation of it is structurally this.
 */
export type AdyenHttpClient = Pick<
  InstanceType<typeof adyenApiLibrary.HttpURLConnectionClient>,
  "request"
>;

/**
 * Resolves the library's exports, on first use rather than at module load.
 *
 * `@adyen/api-library` is CommonJS and is kept out of the SSR bundle by
 * `ssr.external` in each vite.config.ts, so what actually lands in
 * `adyenApiLibrary` depends on which interop ran: importing under Deno hands
 * back `module.exports` itself, while an ESM namespace built around the same
 * module nests it one level deeper under `default`. Both are accepted here.
 *
 * Doing this lazily matters: every app's `main.ts` reaches this module, so the
 * built `_fresh/server.js` evaluates it, and `tools/build/assert-built-ssr.ts`
 * imports that bundle. Anything thrown while this module initialises would
 * surface there as a bare import failure with no useful message, so importing
 * this file stays free of side effects and the cost is paid on first request.
 */
function library(): typeof adyenApiLibrary {
  const direct = adyenApiLibrary as unknown as Record<string, unknown> | undefined;
  if (typeof direct?.HttpURLConnectionClient === "function") return adyenApiLibrary;
  const nested = direct?.default as typeof adyenApiLibrary | undefined;
  if (typeof nested?.HttpURLConnectionClient === "function") return nested;
  throw new Error(
    "@adyen/api-library did not expose HttpURLConnectionClient, unexpected CommonJS interop shape.",
  );
}

type Payload = Record<string, unknown>;
type HttpMethod = "GET" | "POST";

const CHECKOUT_BASE_URL = "https://checkout-test.adyen.com/v72";
const DEVICE_BASE_URL = "https://device-api-test.adyen.com/v1";
const APPLICATION_NAME = "adyen-test-playground-suite";
const DEFAULT_TIMEOUT_MS = 45_000;

export class AdyenRequestError extends Error {
  readonly statusCode: number;
  readonly errorCode?: string;

  constructor(message: string, statusCode: number, errorCode?: string) {
    super(message);
    this.name = "AdyenRequestError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

type EventListener = (...args: never[]) => void;
type ResponseLike = { complete?: boolean; on: (event: string, listener: () => void) => void };
type RequestLike = {
  flushHeaders: () => void;
  on: (event: string, listener: EventListener) => unknown;
};
type CreateRequest = (
  endpoint: string,
  requestOptions: Record<string, unknown>,
  applicationName?: string,
) => RequestLike;

/**
 * The library's own node:https transport, adapted to pre-2.8 Deno.
 *
 * `HttpURLConnectionClient` is written against Node, and two of the details
 * it relies on were missing from Deno's node:http layer until 2.8.0. The
 * pinned runtime is past that now, so neither workaround is load-bearing in
 * CI or in the images; both are no-ops on a runtime that already behaves,
 * and they keep the suite usable on an older local Deno. Neither has
 * anything to do with CORS, TLS or the endpoints, the misdiagnosis that led
 * the suite to drop the library's transport in the first place.
 *
 * 1. `doRequest()` opens every call with `flushHeaders()`, purely to push
 *    the header block out ahead of the body. Before 2.8.0 that call stranded
 *    the request: nothing reached the wire, no error was raised, and the
 *    promise never settled. Dropping it costs nothing, because the `write()`
 *    and `end()` that follow flush the very same headers.
 *
 * 2. At the end of the response `doRequest()` rejects unless `res.complete`
 *    is true. Before 2.8.0 Deno never flipped that flag, so every call ,
 *    including successful ones, failed with "The connection was terminated
 *    while the message was still being sent". Setting it as the message ends
 *    restores Node's meaning; the listener is attached before the library's
 *    own so it wins the ordering, and it is skipped on runtimes that already
 *    set it.
 */
function nativeHttpClient(): AdyenHttpClient {
  const client = new (library().HttpURLConnectionClient)();
  // `createRequest` is declared private in the shipped typings but is an
  // ordinary prototype method at runtime, and it is the only point where the
  // ClientRequest is reachable before `doRequest()` starts using it.
  const internals = client as unknown as { createRequest: CreateRequest };
  const createRequest = internals.createRequest.bind(client);

  internals.createRequest = (...args) => {
    const request = createRequest(...args);
    request.flushHeaders = () => {};
    const on = request.on.bind(request);
    request.on = (event, listener) => {
      if (event !== "response") return on(event, listener);
      return on(
        "response",
        ((response: ResponseLike) => {
          response.on("end", () => {
            if (response.complete !== true) response.complete = true;
          });
          (listener as unknown as (response: ResponseLike) => void)(response);
        }) as unknown as EventListener,
      );
    };
    return request;
  };
  return client;
}

let cachedHttpClient: AdyenHttpClient | undefined;

/** Built once, on first request rather than at module load. */
function sharedHttpClient(): AdyenHttpClient {
  return cachedHttpClient ??= nativeHttpClient();
}

function responseObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseBody(body: string): unknown {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function httpStatus(value: unknown): number | undefined {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : undefined;
}

/**
 * The library signals failures three different ways: `HttpClientException`
 * carrying the parsed Adyen error, a bare `Error` whose message is the raw
 * response body (the branch it takes for the `errors[]` validation shape,
 * which also drops the HTTP status), and `ApiException` for transport
 * failures. All three collapse back to the status/message/errorCode triplet
 * the apps and the Back Office timeline already display.
 */
function asRequestError(error: unknown): AdyenRequestError {
  const thrown = responseObject(error);

  // `ApiException` covers both the library's own missing-API-key guard (401)
  // and every socket-level failure, which it reports with its default 500.
  // Only the latter is a connection problem, and saying so keeps the Back
  // Office timeline able to tell "Adyen refused this" from "Adyen was not
  // reachable".
  if (thrown.name === "ApiException" && thrown.statusCode === 500) {
    return new AdyenRequestError(
      `Adyen TEST connection failed: ${text(thrown.message) ?? "unknown network error"}`,
      502,
    );
  }

  const body = responseObject(parseBody(
    text(thrown.responseBody) ?? (error instanceof Error ? error.message : ""),
  ));
  const apiError = responseObject(thrown.apiError);
  const firstError = responseObject(Array.isArray(body.errors) ? body.errors[0] : undefined);

  const status = httpStatus(thrown.statusCode) ?? httpStatus(body.status);
  const message = text(apiError.message) ?? text(body.message) ?? text(body.detail) ??
    text(body.title) ?? text(firstError.message);
  const errorCode = text(apiError.errorCode) ?? text(body.errorCode) ?? text(firstError.errorCode);

  if (status !== undefined) {
    return new AdyenRequestError(
      message ?? `Adyen TEST returned HTTP ${status}.`,
      status,
      errorCode,
    );
  }
  // No status anywhere, but Adyen still described the rejection: the library
  // lost the code on the way through, so report it as a request error rather
  // than as the connection failure a 502 would imply.
  if (message !== undefined) return new AdyenRequestError(message, 400, errorCode);

  const reason = error instanceof Error ? error.message : "unknown network error";
  return new AdyenRequestError(`Adyen TEST connection failed: ${reason}`, 502);
}

async function adyenRequest(input: {
  apiKey: string;
  endpoint: string;
  method?: HttpMethod;
  payload?: Payload;
  // The library builds the request path from the endpoint's pathname alone,
  // so a query string written into `endpoint` is silently dropped.
  params?: Record<string, string>;
  idempotencyKey?: string;
  timeoutMs?: number;
  httpClient: AdyenHttpClient;
}): Promise<unknown> {
  assertTestOnly({ endpoint: input.endpoint });
  const { Config, EnvironmentEnum } = library();
  const config = new Config({
    apiKey: input.apiKey,
    environment: EnvironmentEnum.TEST,
    applicationName: APPLICATION_NAME,
    connectionTimeoutMillis: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  try {
    const body = await input.httpClient.request(
      input.endpoint,
      input.payload === undefined ? "" : JSON.stringify(input.payload),
      config,
      true,
      {
        method: input.method ?? "POST",
        headers: { Accept: "application/json" },
        ...(input.params ? { params: input.params } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      },
    );
    return parseBody(body);
  } catch (error) {
    throw asRequestError(error);
  }
}

export class AdyenTestClient {
  readonly #secrets: ProfileSecrets;
  readonly #httpClient: AdyenHttpClient;

  constructor(secrets: ProfileSecrets, httpClient: AdyenHttpClient = sharedHttpClient()) {
    profileIsTestOnly(secrets);
    if (!secrets.apiKey) throw new Error("The selected profile has no Adyen TEST API key.");
    this.#secrets = secrets;
    this.#httpClient = httpClient;
  }

  async sessions(payload: Payload, idempotencyKey: string): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/sessions`,
      payload,
      idempotencyKey,
      httpClient: this.#httpClient,
    });
  }

  async paymentMethods(payload: Payload): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/paymentMethods`,
      payload,
      httpClient: this.#httpClient,
    });
  }

  async payments(payload: Payload, idempotencyKey: string): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/payments`,
      payload,
      idempotencyKey,
      httpClient: this.#httpClient,
    });
  }

  async paymentDetails(payload: Payload, idempotencyKey: string): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/payments/details`,
      payload,
      idempotencyKey,
      httpClient: this.#httpClient,
    });
  }

  async createPaymentLink(payload: Payload, idempotencyKey: string): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/paymentLinks`,
      payload,
      idempotencyKey,
      httpClient: this.#httpClient,
    });
  }

  async getPaymentLink(linkId: string): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/paymentLinks/${encodeURIComponent(linkId)}`,
      method: "GET",
      httpClient: this.#httpClient,
    });
  }

  /** A gift card's balance; read-only on Adyen's side, so no idempotency key. */
  async paymentMethodsBalance(payload: Payload): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/paymentMethods/balance`,
      payload,
      httpClient: this.#httpClient,
    });
  }

  async createOrder(payload: Payload, idempotencyKey: string): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/orders`,
      payload,
      idempotencyKey,
      httpClient: this.#httpClient,
    });
  }

  async cancelOrder(payload: Payload, idempotencyKey: string): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/orders/cancel`,
      payload,
      idempotencyKey,
      httpClient: this.#httpClient,
    });
  }

  async capture(pspReference: string, payload: Payload, idempotencyKey: string): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/payments/${encodeURIComponent(pspReference)}/captures`,
      payload,
      idempotencyKey,
      httpClient: this.#httpClient,
    });
  }

  async cancel(pspReference: string, payload: Payload, idempotencyKey: string): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/payments/${encodeURIComponent(pspReference)}/cancels`,
      payload,
      idempotencyKey,
      httpClient: this.#httpClient,
    });
  }

  async refund(pspReference: string, payload: Payload, idempotencyKey: string): Promise<unknown> {
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${CHECKOUT_BASE_URL}/payments/${encodeURIComponent(pspReference)}/refunds`,
      payload,
      idempotencyKey,
      httpClient: this.#httpClient,
    });
  }

  async terminalSync(payload: Payload): Promise<unknown> {
    if (!this.#secrets.merchantAccount || !this.#secrets.terminalId) {
      throw new Error("The selected TEST profile requires merchantAccount and terminalId.");
    }
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${DEVICE_BASE_URL}/merchants/${
        encodeURIComponent(this.#secrets.merchantAccount)
      }/devices/${encodeURIComponent(this.#secrets.terminalId)}/sync`,
      payload,
      timeoutMs: 120_000,
      httpClient: this.#httpClient,
    });
  }

  async connectedDevices(): Promise<unknown> {
    if (!this.#secrets.merchantAccount) throw new Error("merchantAccount is required.");
    return await adyenRequest({
      apiKey: this.#secrets.apiKey!,
      endpoint: `${DEVICE_BASE_URL}/merchants/${
        encodeURIComponent(this.#secrets.merchantAccount)
      }/connectedDevices`,
      method: "GET",
      httpClient: this.#httpClient,
    });
  }
}
