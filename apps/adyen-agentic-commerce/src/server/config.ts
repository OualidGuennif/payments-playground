// Spec: knowledge/components/adyen-agentic-commerce.md
// Reads the environment once. The Adyen endpoints are not configurable: the library is always built
// for TEST and a client key must carry the test_ prefix, so a LIVE credential fails closed at boot.

export const SHOPPER_REFERENCE = "ogaccountnew";
export const CURRENCY = "EUR";
export const UCP_VERSION = "2026-08-25";
export const PAP_VERSION = "1.0";

export type Config = {
  publicOrigin: string;
  domain: string;
  databasePath: string;
  adyen: {
    apiKey?: string;
    merchantAccount?: string;
    clientKey?: string;
    hmacKey?: string;
  };
  backOffice?: { user: string; password: string };
};

export class ConfigError extends Error {}

// `docker run --env-file` keeps the quotes of a dotenv `KEY="value"` line, so they are removed here
// rather than reaching Adyen as part of a key.
function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/^(["'])(.*)\1$/s, "$2").trim();
  return trimmed ? trimmed : undefined;
}

// The proxy reads the Basic Auth pair straight from the environment and needs the same cleaning.
export { clean as cleanEnvValue };

export function readConfig(env: Record<string, string | undefined>): Config {
  const publicOrigin = (clean(env.PUBLIC_ORIGIN) ?? `http://localhost:${clean(env.PORT) ?? "8003"}`)
    .replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(publicOrigin);
  } catch {
    throw new ConfigError("PUBLIC_ORIGIN is not a URL");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new ConfigError("PUBLIC_ORIGIN must be an origin without a path");
  }
  const clientKey = clean(env.ADYEN_CLIENT_KEY);
  if (clientKey && !clientKey.startsWith("test_")) {
    throw new ConfigError("ADYEN_CLIENT_KEY is not a TEST client key");
  }
  if (clean(env.ADYEN_ENVIRONMENT) && clean(env.ADYEN_ENVIRONMENT)!.toUpperCase() !== "TEST") {
    throw new ConfigError("Only the Adyen TEST environment is allowed");
  }
  const user = clean(env.PLAYGROUND_BASIC_AUTH_USER);
  const password = clean(env.PLAYGROUND_BASIC_AUTH_PASSWORD);
  return {
    publicOrigin: url.origin,
    domain: url.host,
    databasePath: clean(env.DATABASE_PATH) ?? "data/agentic.sqlite",
    adyen: {
      apiKey: clean(env.ADYEN_API_KEY),
      merchantAccount: clean(env.ADYEN_MERCHANT_ACCOUNT),
      clientKey,
      hmacKey: clean(env.ADYEN_HMAC_KEY),
    },
    backOffice: user && password ? { user, password } : undefined,
  };
}

let cached: Config | undefined;

export function config(): Config {
  cached ??= readConfig(process.env);
  return cached;
}

export function paymentsConfigured(c: Config = config()): boolean {
  return Boolean(c.adyen.apiKey && c.adyen.merchantAccount && c.adyen.clientKey);
}
