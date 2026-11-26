// Spec: knowledge/components/adyen-agentic-commerce.md
// A credential (a network token's number and expiry) enters a stored record only through an HMAC
// whose key never reaches the database (derived from the Adyen API key, else random for this
// process), so the stored value cannot be searched offline.
import { createHmac, randomBytes } from "node:crypto";
import { config } from "./config";
import { canonicalJson, sha256 } from "./util";

let fingerprintKey: string | Buffer | undefined;

export function credentialFingerprint(credential: unknown): string {
  const apiKey = config().adyen.apiKey;
  fingerprintKey ??= apiKey ? sha256(`velune-idempotency:${apiKey}`) : randomBytes(32);
  return createHmac("sha256", fingerprintKey).update(canonicalJson(credential)).digest("hex");
}
