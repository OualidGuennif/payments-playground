// Spec: knowledge/components/platform-package.md
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseDotenv } from "./dotenv.ts";
import type { AppId, ProfileSecrets, PublicProfile } from "./types.ts";
import { isTestClientKey, profileIsTestOnly } from "./test-only.ts";

export interface ServerConfig {
  appId: AppId;
  port: number;
  publicOrigin: string;
  databasePath: string;
  signingSecret: string;
  defaultProfile: PublicProfile;
  defaultSecrets: ProfileSecrets;
}

function readEnvFile(path: string): Record<string, string> {
  try {
    return parseDotenv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * `docker run --env-file` passes `KEY="value"` through with its quotes, unlike
 * every dotenv parser, so a .env written for local dev handed Adyen an API key
 * wrapped in quotes and got 401s. No credential here is quoted.
 */
export function unquoteEnvValue(value: string): string {
  const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") &&
    value.at(-1) === value[0];
  return quoted ? value.slice(1, -1) : value;
}

function environmentWithLocalFallback(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const unquoted = unquoteEnvValue(value);
    values[key] = unquoted;
    // Written back too: profiles.ts and the Basic Auth check read process.env
    // directly, and both are set up after this on every startup.
    if (unquoted !== value) process.env[key] = unquoted;
  }
  const cwd = process.cwd();
  const candidates = [
    values.LEGACY_ENV_PATH,
    join(cwd, ".env"),
    join(cwd, "..", ".env"),
    join(cwd, "..", "checkoutPlayground copie", ".env"),
    join(cwd, "..", "..", "..", "checkoutPlayground copie", ".env"),
    join(cwd, "checkoutPlayground copie", ".env"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const absolute = isAbsolute(candidate) ? candidate : resolve(candidate);
    for (const [key, value] of Object.entries(readEnvFile(absolute))) {
      if (!values[key]) values[key] = value;
    }
  }
  return values;
}

function secretsFrom(values: Record<string, string>): ProfileSecrets {
  return {
    apiKey: values.ADYEN_API_KEY,
    merchantAccount: values.ADYEN_MERCHANT_ACCOUNT,
    clientKey: values.ADYEN_CLIENT_KEY,
    hmacKey: values.ADYEN_HMAC_KEY ?? values.HMAC_KEY,
    webhookBasicAuthUser: values.WEBHOOK_BASIC_AUTH_USER,
    webhookBasicAuthPassword: values.WEBHOOK_BASIC_AUTH_PASSWORD,
  };
}

/** Both apps render Adyen Web, so both need the publishable client key. */
export const REQUIRED_SECRETS: Array<keyof ProfileSecrets> = [
  "apiKey",
  "merchantAccount",
  "clientKey",
];

export function loadServerConfig(appId: AppId): ServerConfig {
  const values = environmentWithLocalFallback();
  const secrets = secretsFrom(values);
  profileIsTestOnly(secrets);
  const missingFields = REQUIRED_SECRETS.filter((field) => !secrets[field]);
  if (secrets.clientKey && !isTestClientKey(secrets.clientKey)) {
    missingFields.push("clientKey");
  }
  const port = Number(values.PORT || 8000);
  const publicOrigin = values.PUBLIC_ORIGIN || `http://localhost:${port}`;
  const defaultDb = join(process.cwd(), "data", `${appId}.sqlite`);

  return {
    appId,
    port,
    publicOrigin,
    databasePath: values.DATABASE_PATH || defaultDb,
    signingSecret: values.SESSION_SIGNING_SECRET ||
      `ephemeral-${appId}-${crypto.randomUUID()}`,
    defaultProfile: {
      id: "default",
      label: "Default TEST profile",
      appId,
      isDefault: true,
      isConfigured: missingFields.length === 0,
      missingFields,
      merchantAccount: secrets.merchantAccount,
      capabilities: ["adyen-test"],
      updatedAt: new Date().toISOString(),
    },
    defaultSecrets: secrets,
  };
}
