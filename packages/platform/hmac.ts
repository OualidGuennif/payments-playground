// Spec: knowledge/components/platform-package.md
const encoder = new TextEncoder();

export interface StandardWebhookItem {
  pspReference?: string;
  originalReference?: string;
  merchantAccountCode?: string;
  merchantReference?: string;
  amount?: { value?: number; currency?: string };
  eventCode?: string;
  success?: string | boolean;
  additionalData?: { hmacSignature?: string; [key: string]: unknown };
  [key: string]: unknown;
}

function escape(value: unknown): string {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

export function standardWebhookSigningString(item: StandardWebhookItem): string {
  return [
    item.pspReference,
    item.originalReference,
    item.merchantAccountCode,
    item.merchantReference,
    item.amount?.value,
    item.amount?.currency,
    item.eventCode,
    item.success,
  ].map(escape).join(":");
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[a-f0-9]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("The HMAC key must be hexadecimal.");
  }
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function calculateStandardHmac(
  item: StandardWebhookItem,
  hmacKeyHex: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    arrayBuffer(hexToBytes(hmacKeyHex)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(standardWebhookSigningString(item))),
  );
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function verifyStandardHmac(
  item: StandardWebhookItem,
  hmacKeyHex: string | undefined,
): Promise<boolean> {
  if (!hmacKeyHex || !item.additionalData?.hmacSignature) return false;
  try {
    const expected = base64ToBytes(await calculateStandardHmac(item, hmacKeyHex));
    const received = base64ToBytes(item.additionalData.hmacSignature);
    return constantTimeEqual(expected, received);
  } catch {
    return false;
  }
}

export async function verifyHeaderHmac(
  rawBody: string,
  receivedSignature: string | undefined,
  hmacKeyHex: string | undefined,
): Promise<boolean> {
  if (!receivedSignature || !hmacKeyHex) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      arrayBuffer(hexToBytes(hmacKeyHex)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)),
    );
    return constantTimeEqual(expected, base64ToBytes(receivedSignature));
  } catch {
    return false;
  }
}
