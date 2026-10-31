// Spec: knowledge/components/platform-package.md
import { dirname } from "@std/path";
import type { Database } from "@db/sqlite";
import type { AppId, ProfileSecrets, PublicProfile } from "./types.ts";
import { profileIsTestOnly } from "./test-only.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface ProfileRow {
  id: string;
  app_id: AppId;
  label: string;
  encrypted_secrets: string;
  nonce: string;
  created_at: string;
  updated_at: string;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parseKey(value: string): Uint8Array {
  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
  }
  const decoded = decodeBase64(value);
  if (decoded.byteLength !== 32) {
    throw new Error("PROFILE_ENCRYPTION_KEY must be 32-byte Base64 or 64-character hex.");
  }
  return decoded;
}

function localKeyPath(databasePath: string): string {
  return `${databasePath}.profile-key`;
}

function resolveEncryptionKey(databasePath: string): Uint8Array {
  const configured = Deno.env.get("PROFILE_ENCRYPTION_KEY");
  if (configured) return parseKey(configured);

  if (Deno.env.get("RENDER") || Deno.env.get("DENO_DEPLOYMENT_ID")) {
    throw new Error(
      "PROFILE_ENCRYPTION_KEY is required before saving custom profiles in a hosted environment.",
    );
  }

  const keyPath = localKeyPath(databasePath);
  try {
    return decodeBase64(Deno.readTextFileSync(keyPath).trim());
  } catch {
    const key = crypto.getRandomValues(new Uint8Array(32));
    Deno.mkdirSync(dirname(keyPath), { recursive: true });
    Deno.writeTextFileSync(keyPath, encodeBase64(key), { mode: 0o600 });
    try {
      Deno.chmodSync(keyPath, 0o600);
    } catch {
      // chmod is not available on every host; file remains inside ignored data/.
    }
    return key;
  }
}

function requiredFields(appId: AppId): Array<keyof ProfileSecrets> {
  if (appId === "ipp") return ["apiKey", "merchantAccount", "terminalId"];
  if (appId === "agentic") return ["apiKey", "merchantAccount"];
  return ["apiKey", "merchantAccount", "clientKey"];
}

function publicFrom(
  row: ProfileRow,
  secrets: ProfileSecrets,
): PublicProfile {
  const missingFields = requiredFields(row.app_id).filter((field) => !secrets[field]);
  return {
    id: row.id,
    label: row.label,
    appId: row.app_id,
    isDefault: false,
    isConfigured: missingFields.length === 0,
    missingFields,
    merchantAccount: secrets.merchantAccount,
    capabilities: row.app_id === "agentic"
      ? [
        "mock-ready",
        secrets.agenticBearerToken ? "real-token-configured" : "real-token-unavailable",
      ]
      : ["adyen-test"],
    updatedAt: row.updated_at,
  };
}

export class ProfileStore {
  readonly #database: Database;
  readonly #databasePath: string;
  readonly #appId: AppId;
  readonly #defaultProfile: PublicProfile;
  readonly #defaultSecrets: ProfileSecrets;

  constructor(input: {
    database: Database;
    databasePath: string;
    appId: AppId;
    defaultProfile: PublicProfile;
    defaultSecrets: ProfileSecrets;
  }) {
    this.#database = input.database;
    this.#databasePath = input.databasePath;
    this.#appId = input.appId;
    this.#defaultProfile = input.defaultProfile;
    this.#defaultSecrets = input.defaultSecrets;
  }

  async #cryptoKey(): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
      "raw",
      arrayBuffer(resolveEncryptionKey(this.#databasePath)),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  }

  async #encrypt(secrets: ProfileSecrets): Promise<{ ciphertext: string; nonce: string }> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: arrayBuffer(nonce) },
        await this.#cryptoKey(),
        encoder.encode(JSON.stringify(secrets)),
      ),
    );
    return { ciphertext: encodeBase64(ciphertext), nonce: encodeBase64(nonce) };
  }

  async #decrypt(row: ProfileRow): Promise<ProfileSecrets> {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: arrayBuffer(decodeBase64(row.nonce)) },
      await this.#cryptoKey(),
      arrayBuffer(decodeBase64(row.encrypted_secrets)),
    );
    return JSON.parse(decoder.decode(plaintext)) as ProfileSecrets;
  }

  async listPublic(): Promise<PublicProfile[]> {
    const rows = this.#database.prepare<ProfileRow>(
      "SELECT * FROM profiles WHERE app_id = ? ORDER BY updated_at DESC",
    ).all(this.#appId);
    const profiles: PublicProfile[] = [this.#defaultProfile];
    for (const row of rows) {
      try {
        profiles.push(publicFrom(row, await this.#decrypt(row)));
      } catch {
        profiles.push({
          id: row.id,
          label: row.label,
          appId: row.app_id,
          isDefault: false,
          isConfigured: false,
          missingFields: ["decryptionFailed"],
          capabilities: [],
          updatedAt: row.updated_at,
        });
      }
    }
    return profiles;
  }

  async getPublic(id: string): Promise<PublicProfile | undefined> {
    if (id === "default") return this.#defaultProfile;
    const row = this.#database.prepare<ProfileRow>(
      "SELECT * FROM profiles WHERE app_id = ? AND id = ?",
    ).get(this.#appId, id);
    return row ? publicFrom(row, await this.#decrypt(row)) : undefined;
  }

  async getSecrets(id: string): Promise<ProfileSecrets | undefined> {
    if (id === "default") return { ...this.#defaultSecrets };
    const row = this.#database.prepare<ProfileRow>(
      "SELECT * FROM profiles WHERE app_id = ? AND id = ?",
    ).get(this.#appId, id);
    return row ? await this.#decrypt(row) : undefined;
  }

  async save(
    label: string,
    secrets: ProfileSecrets,
    id = crypto.randomUUID(),
  ): Promise<PublicProfile> {
    const normalizedLabel = label.trim().slice(0, 80);
    if (normalizedLabel.length < 2) {
      throw new Error("Profile label must contain at least 2 characters.");
    }
    profileIsTestOnly(secrets);
    const encrypted = await this.#encrypt(secrets);
    const now = new Date().toISOString();
    this.#database.prepare(
      `INSERT INTO profiles
       (id, app_id, label, encrypted_secrets, nonce, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label,
       encrypted_secrets = excluded.encrypted_secrets, nonce = excluded.nonce,
       updated_at = excluded.updated_at`,
    ).run(
      id,
      this.#appId,
      normalizedLabel,
      encrypted.ciphertext,
      encrypted.nonce,
      now,
      now,
    );
    return (await this.getPublic(id))!;
  }

  delete(id: string): boolean {
    if (id === "default") {
      throw new Error("The environment-backed default profile cannot be deleted.");
    }
    return this.#database.prepare(
      "DELETE FROM profiles WHERE app_id = ? AND id = ?",
    ).run(this.#appId, id) > 0;
  }
}
