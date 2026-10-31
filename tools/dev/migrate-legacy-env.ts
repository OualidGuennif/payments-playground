import { parse } from "@std/dotenv";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

type AppEnv = {
  directory: string;
  values: Array<[key: string, value: string, comment?: string]>;
};

const suiteRoot = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const legacyPath = resolve(suiteRoot, "..", "checkoutPlayground copie", ".env");

function readEnv(path: string): Record<string, string> {
  try {
    const text = Deno.readTextFileSync(path)
      .split("\n")
      .map((line) => line.replace(/^\s*export\s+/, ""))
      .join("\n");
    return parse(text);
  } catch {
    return {};
  }
}

function randomBase64(size = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function envValue(value: string): string {
  if (value === "") return "";
  return JSON.stringify(value);
}

const legacy = readEnv(legacyPath);

function legacyValue(...keys: string[]): string {
  for (const key of keys) {
    if (legacy[key]) return legacy[key];
  }
  return "";
}

function common(
  port: number,
  database: string,
  overrides: Record<string, string> = {},
): Array<[string, string, string?]> {
  return [
    ["PORT", String(port), "Local runtime"],
    ["PUBLIC_ORIGIN", `http://127.0.0.1:${port}`],
    ["DATABASE_PATH", `./data/${database}.sqlite`],
    ["ADYEN_API_KEY", overrides.ADYEN_API_KEY ?? legacyValue("ADYEN_API_KEY")],
    [
      "ADYEN_MERCHANT_ACCOUNT",
      overrides.ADYEN_MERCHANT_ACCOUNT ?? legacyValue("ADYEN_MERCHANT_ACCOUNT"),
    ],
    ["ADYEN_CLIENT_KEY", overrides.ADYEN_CLIENT_KEY ?? legacyValue("ADYEN_CLIENT_KEY")],
    ["ADYEN_HMAC_KEY", overrides.ADYEN_HMAC_KEY ?? legacyValue("ADYEN_HMAC_KEY")],
    ["PROFILE_ENCRYPTION_KEY", randomBase64(), "Local security"],
    ["SESSION_SIGNING_SECRET", randomBase64()],
    ["PLAYGROUND_BASIC_AUTH_USER", ""],
    ["PLAYGROUND_BASIC_AUTH_PASSWORD", ""],
  ];
}

const apps: AppEnv[] = [
  {
    directory: "apps/adyen-digital",
    values: common(8001, "digital"),
  },
  {
    directory: "apps/adyen-ipp-endless-aisle",
    values: [
      ...common(8002, "ipp", {
        ADYEN_API_KEY: legacyValue("ADYEN_DEVICE_API_KEY", "ADYEN_API_KEY"),
        ADYEN_MERCHANT_ACCOUNT: legacyValue(
          "ADYEN_MERCHANT_ACCOUNT_POS",
          "ADYEN_MERCHANT_ACCOUNT",
        ),
        ADYEN_CLIENT_KEY: "",
      }).filter(([key]) => key !== "ADYEN_CLIENT_KEY"),
      ["ADYEN_TERMINAL_ID", legacyValue("ADYEN_TERMINAL_ID", "OMNI_TERMINAL_ID")],
      ["WEBHOOK_BASIC_AUTH_USER", ""],
      ["WEBHOOK_BASIC_AUTH_PASSWORD", ""],
    ],
  },
  {
    directory: "apps/adyen-agentic-commerce",
    values: [
      ...common(8003, "agentic"),
      ["AGENTIC_REAL_ENABLED", "false", "Keep false until the real TEST contract is verified"],
      [
        "ADYEN_AGENTIC_BEARER_TOKEN",
        legacyValue("ADYEN_AGENTIC_BEARER_TOKEN", "AGENTIC_AGENT_BEARER_TOKEN"),
      ],
    ],
  },
  {
    directory: "apps/adyen-v6-styling",
    values: common(8004, "styling").filter(([key]) => key !== "ADYEN_HMAC_KEY"),
  },
];

if (Object.keys(legacy).length === 0) {
  throw new Error(`No readable legacy environment was found at ${legacyPath}`);
}

for (const app of apps) {
  const envPath = join(suiteRoot, app.directory, ".env");
  const existing = readEnv(envPath);
  const lines = [
    "# TEST ENVIRONMENT ONLY, generated from the legacy local playground.",
    "# This file is ignored by Git and Docker. Never commit it.",
    "",
  ];
  const populated: string[] = [];
  const missing: string[] = [];

  for (const [key, proposed, comment] of app.values) {
    if (comment) {
      if (lines.at(-1) !== "") lines.push("");
      lines.push(`# ${comment}`);
    }
    const value = existing[key] || proposed;
    lines.push(`${key}=${envValue(value)}`);
    if (value) populated.push(key);
    else missing.push(key);
  }

  Deno.writeTextFileSync(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  try {
    Deno.chmodSync(envPath, 0o600);
  } catch {
    // File remains ignored even where chmod is not available.
  }

  console.log(
    `✓ ${app.directory}/.env: ${populated.length} populated, ${missing.length} optional/missing`,
  );
}
