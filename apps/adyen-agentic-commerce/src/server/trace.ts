// Spec: knowledge/components/adyen-agentic-commerce.md
import { database } from "./db";

export type TraceEntry = {
  id: number;
  at: string;
  channel: string;
  actor: string;
  method: string;
  path: string;
  status: number;
  ref: string | null;
  detail: unknown;
};

const SECRET_KEYS =
  /^(authorization|access_token|refresh_token|code|code_verifier|client_assertion|token|storedPaymentMethodId|stored_payment_method_id|poppy-session|apiKey|sessionData|hmacSignature|additionalData)$/i;

// Every trace row passes through here so a secret can never reach the Back Office or the logs.
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // A UCP message's code ("payment_refused") is public; any other "code" may be an OAuth code.
    const message = typeof record.content === "string" && typeof record.severity === "string";
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(record)) {
      const secret = SECRET_KEYS.test(key) && !(message && key === "code");
      out[key] = secret ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 400) return `${value.slice(0, 400)}…`;
  return value;
}

export function trace(entry: Omit<TraceEntry, "id" | "at">): void {
  database()
    .query(
      `insert into trace (at, channel, actor, method, path, status, ref, detail)
       values ($at, $channel, $actor, $method, $path, $status, $ref, $detail)`,
    )
    .run({
      at: new Date().toISOString(),
      channel: entry.channel,
      actor: entry.actor,
      method: entry.method,
      path: entry.path,
      status: entry.status,
      ref: entry.ref ?? null,
      detail: JSON.stringify(redact(entry.detail)),
    });
}

export function recentTrace(limit = 150, ref?: string): TraceEntry[] {
  const rows = ref
    ? database().query<Record<string, unknown>, { n: number; r: string }>(
      "select * from trace where ref = $r order by id desc limit $n",
    ).all({ n: limit, r: ref })
    : database().query<Record<string, unknown>, { n: number }>(
      "select * from trace order by id desc limit $n",
    ).all({ n: limit });
  return rows.map((row) => ({ ...(row as TraceEntry), detail: JSON.parse(String(row.detail)) }));
}
