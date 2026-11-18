// A software WebAuthn authenticator for tests: one ES256 key, "none" attestation, and the exact
// bytes a browser would send (CBOR attestation object, authenticator data, DER signature), so the
// store's passkey routes run through the real @simplewebauthn/server checks.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { createHash, randomBytes } from "node:crypto";

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string) =>
  new Uint8Array(createHash("sha256").update(data).digest());

// The smallest CBOR encoder the attestation needs: unsigned and negative integers, byte and text
// strings, and maps.
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function head(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length];
  if (length < 256) return [(major << 5) | 24, length];
  return [(major << 5) | 25, length >> 8, length & 0xff];
}
function cbor(value: Cbor): number[] {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return [...head(3, bytes.length), ...bytes];
  }
  if (value instanceof Uint8Array) return [...head(2, value.length), ...value];
  const out = head(5, value.size);
  for (const [k, v] of value) out.push(...cbor(k), ...cbor(v));
  return out;
}

// WebCrypto signs ECDSA as r || s; WebAuthn carries an ASN.1 DER sequence.
function der(raw: Uint8Array): Uint8Array {
  const int = (half: Uint8Array) => {
    let i = 0;
    while (i < half.length - 1 && half[i] === 0) i += 1;
    const trimmed = half.slice(i);
    return trimmed[0]! & 0x80
      ? [0x02, trimmed.length + 1, 0, ...trimmed]
      : [0x02, trimmed.length, ...trimmed];
  };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

export class SoftAuthenticator {
  readonly credentialId = new Uint8Array(randomBytes(16));
  private counter = 0;
  private constructor(
    private readonly keys: CryptoKeyPair,
    private readonly origin: string,
  ) {}

  static async create(origin: string) {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    return new SoftAuthenticator(keys, origin);
  }

  get id() {
    return b64url(this.credentialId);
  }

  private clientData(type: string, challenge: string) {
    return new TextEncoder().encode(JSON.stringify({ type, challenge, origin: this.origin }));
  }

  private authData(rpId: string, flags: number, attested?: Uint8Array) {
    this.counter += 1;
    const count = [
      this.counter >>> 24,
      (this.counter >>> 16) & 0xff,
      (this.counter >>> 8) & 0xff,
      this.counter & 0xff,
    ];
    return new Uint8Array([...sha256(rpId), flags, ...count, ...(attested ?? [])]);
  }

  // navigator.credentials.create(): user present and verified (UP, UV) with attested data (AT).
  async register(options: { challenge: string; rp: { id?: string } }) {
    const jwk = await crypto.subtle.exportKey("jwk", this.keys.publicKey);
    const cose = new Map<Cbor, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
    ]);
    const id = this.credentialId;
    const attested = new Uint8Array([
      ...new Uint8Array(16),
      id.length >> 8,
      id.length & 0xff,
      ...id,
      ...cbor(cose),
    ]);
    const authData = this.authData(options.rp.id!, 0x45, attested);
    const attestationObject = new Uint8Array(
      cbor(
        new Map<Cbor, Cbor>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData],
        ]),
      ),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", options.challenge)),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  // navigator.credentials.get(): a signature over authenticator data and the client data hash.
  async login(options: { challenge: string; rpId?: string }, rpId = options.rpId!) {
    const clientDataJSON = this.clientData("webauthn.get", options.challenge);
    const authenticatorData = this.authData(rpId, 0x05);
    const signed = new Uint8Array([...authenticatorData, ...sha256(clientDataJSON)]);
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, signed),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(der(raw)),
      },
      clientExtensionResults: {},
    };
  }
}
