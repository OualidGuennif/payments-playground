// Spec: knowledge/components/platform-package.md
import { Database } from "@db/sqlite";
import { dirname } from "@std/path";
import { SCHEMA_SQL } from "./migrations.ts";
import { sanitize } from "./sanitize.ts";
import type {
  Amount,
  AppId,
  AttemptAggregate,
  AttemptState,
  JsonValue,
  ModificationEvent,
  ModificationKind,
  ModificationRequest,
  OrderAggregate,
  OrderState,
  TimelineEntry,
} from "./types.ts";
import { isModificationEvent } from "./modifications.ts";

interface OrderRow {
  id: string;
  app_id: AppId;
  reference: string;
  flow: string;
  state: OrderState;
  amount_value: number;
  currency: string;
  paid_value: number;
  expires_at: string | null;
  payment_link_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AttemptRow {
  id: string;
  order_id: string;
  state: AttemptState;
  payment_method: string | null;
  psp_reference: string | null;
  amount_value: number;
  currency: string;
  refusal_reason: string | null;
  created_at: string;
  updated_at: string;
}

function json(value: unknown): string {
  return JSON.stringify(sanitize(value));
}

function parseJson(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return { parseError: true };
  }
}

function mapAction(row: {
  id: string;
  action: string;
  state: string;
  idempotency_key: string;
  payload: string;
  created_at: string;
}): ModificationRequest {
  const payload = parseJson(row.payload) as Record<string, unknown>;
  const amount = (payload.amount ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    kind: row.action as ModificationKind,
    state: row.state === "rejected"
      ? "rejected"
      : row.state === "requested"
      ? "requested"
      : "received",
    value: typeof amount.value === "number" ? amount.value : undefined,
    currency: typeof amount.currency === "string" ? amount.currency : undefined,
    pspReference: typeof payload.pspReference === "string" ? payload.pspReference : undefined,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

function mapOrder(row: OrderRow): OrderAggregate {
  return {
    id: row.id,
    reference: row.reference,
    appId: row.app_id,
    flow: row.flow,
    state: row.state,
    amount: { value: row.amount_value, currency: row.currency },
    paidValue: row.paid_value,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.payment_link_id ? { paymentLinkId: row.payment_link_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAttempt(row: AttemptRow): AttemptAggregate {
  return {
    id: row.id,
    orderId: row.order_id,
    state: row.state,
    ...(row.payment_method ? { paymentMethod: row.payment_method } : {}),
    ...(row.psp_reference ? { pspReference: row.psp_reference } : {}),
    amount: { value: row.amount_value, currency: row.currency },
    ...(row.refusal_reason ? { refusalReason: row.refusal_reason } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Back Office paginates 10 orders/page and shows at most 7 pages, so there is
// never a reason to retain more than that per app, purge the rest on write
// so the TEST database doesn't grow unbounded across repeated demo runs.
const MAX_RETAINED_ORDERS_PER_APP = 70;

export class Repository {
  readonly database: Database;

  constructor(path: string) {
    if (path !== ":memory:") Deno.mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path);
    this.database.exec(SCHEMA_SQL);
  }

  close(): void {
    this.database.close();
  }

  createOrder(input: {
    appId: AppId;
    flow: string;
    amount: Amount;
    reference?: string;
    expiresAt?: string;
    paymentLinkId?: string;
    metadata?: unknown;
  }): OrderAggregate {
    const id = crypto.randomUUID();
    const reference = input.reference ?? `${input.appId}-${Date.now()}-${id.slice(0, 8)}`;
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO orders
       (id, app_id, reference, flow, state, amount_value, currency, paid_value,
        expires_at, payment_link_id, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, 0, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.appId,
      reference,
      input.flow,
      input.amount.value,
      input.amount.currency,
      input.expiresAt ?? null,
      input.paymentLinkId ?? null,
      json(input.metadata ?? {}),
      now,
      now,
    );
    this.purgeOldOrders(input.appId);
    return this.getOrder(id)!;
  }

  private purgeOldOrders(appId: AppId, keep = MAX_RETAINED_ORDERS_PER_APP): void {
    this.database.prepare(
      `DELETE FROM orders WHERE app_id = ? AND id NOT IN (
         SELECT id FROM orders WHERE app_id = ? ORDER BY updated_at DESC LIMIT ?
       )`,
    ).run(appId, appId, keep);
  }

  getOrder(id: string): OrderAggregate | undefined {
    const row = this.database.prepare<OrderRow>("SELECT * FROM orders WHERE id = ?").get(id);
    return row ? mapOrder(row) : undefined;
  }

  getOrderByReference(reference: string): OrderAggregate | undefined {
    const row = this.database.prepare<OrderRow>("SELECT * FROM orders WHERE reference = ?").get(
      reference,
    );
    return row ? mapOrder(row) : undefined;
  }

  findOrderByPaymentLinkId(linkId: string): OrderAggregate | undefined {
    const row = this.database.prepare<OrderRow>(
      "SELECT * FROM orders WHERE payment_link_id = ?",
    ).get(linkId);
    return row ? mapOrder(row) : undefined;
  }

  /** A modification webhook names its payment only through originalReference. */
  findOrderByPspReference(pspReference: string): OrderAggregate | undefined {
    const row = this.database.prepare<OrderRow>(
      `SELECT orders.* FROM orders JOIN attempts ON attempts.order_id = orders.id
       WHERE attempts.psp_reference = ? LIMIT 1`,
    ).get(pspReference);
    return row ? mapOrder(row) : undefined;
  }

  listOrders(appId: AppId, limit = 100): OrderAggregate[] {
    return this.database.prepare<OrderRow>(
      "SELECT * FROM orders WHERE app_id = ? ORDER BY updated_at DESC LIMIT ?",
    ).all(appId, limit).map(mapOrder);
  }

  updateOrder(
    id: string,
    values: {
      state?: OrderState;
      paidValue?: number;
      paymentLinkId?: string;
      expiresAt?: string;
    },
  ): OrderAggregate {
    const order = this.getOrder(id);
    if (!order) throw new Error("Order not found.");
    this.database.prepare(
      `UPDATE orders SET state = ?, paid_value = ?, payment_link_id = ?,
       expires_at = ?, updated_at = ? WHERE id = ?`,
    ).run(
      values.state ?? order.state,
      values.paidValue ?? order.paidValue,
      values.paymentLinkId ?? order.paymentLinkId ?? null,
      values.expiresAt ?? order.expiresAt ?? null,
      new Date().toISOString(),
      id,
    );
    return this.getOrder(id)!;
  }

  createSession(input: {
    orderId: string;
    kind: string;
    adyenSessionId?: string;
    state?: string;
    expiresAt?: string;
  }): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO payment_sessions
       (id, order_id, kind, adyen_session_id, state, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.orderId,
      input.kind,
      input.adyenSessionId ?? null,
      input.state ?? "created",
      input.expiresAt ?? null,
      now,
      now,
    );
    return id;
  }

  createAttempt(input: {
    orderId: string;
    amount: Amount;
    state?: AttemptState;
    paymentMethod?: string;
    pspReference?: string;
    refusalReason?: string;
    metadata?: unknown;
  }): AttemptAggregate {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO attempts
       (id, order_id, state, payment_method, psp_reference, amount_value, currency,
        refusal_reason, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.orderId,
      input.state ?? "created",
      input.paymentMethod ?? null,
      input.pspReference ?? null,
      input.amount.value,
      input.amount.currency,
      input.refusalReason ?? null,
      json(input.metadata ?? {}),
      now,
      now,
    );
    return mapAttempt(
      this.database.prepare<AttemptRow>("SELECT * FROM attempts WHERE id = ?").get(id)!,
    );
  }

  updateAttempt(
    id: string,
    values: {
      state?: AttemptState;
      paymentMethod?: string;
      pspReference?: string;
      refusalReason?: string;
    },
  ): AttemptAggregate {
    const existing = this.database.prepare<AttemptRow>("SELECT * FROM attempts WHERE id = ?").get(
      id,
    );
    if (!existing) throw new Error("Attempt not found.");
    this.database.prepare(
      `UPDATE attempts SET state = ?, payment_method = ?, psp_reference = ?,
       refusal_reason = ?, updated_at = ? WHERE id = ?`,
    ).run(
      values.state ?? existing.state,
      values.paymentMethod ?? existing.payment_method,
      values.pspReference ?? existing.psp_reference,
      values.refusalReason ?? existing.refusal_reason,
      new Date().toISOString(),
      id,
    );
    return mapAttempt(
      this.database.prepare<AttemptRow>("SELECT * FROM attempts WHERE id = ?").get(id)!,
    );
  }

  listAttempts(orderId: string): AttemptAggregate[] {
    return this.database.prepare<AttemptRow>(
      "SELECT * FROM attempts WHERE order_id = ? ORDER BY created_at",
    ).all(orderId).map(mapAttempt);
  }

  recordPaymentPart(input: {
    orderId: string;
    attemptId?: string;
    pspReference?: string;
    amount: Amount;
    state: string;
  }): string {
    // The /payments response and the AUTHORISATION webhook both report the
    // same authorisation; one PSP reference is one part, whichever lands first.
    if (input.pspReference) {
      const existing = this.database.prepare<{ id: string }>(
        `SELECT id FROM payment_parts
         WHERE order_id = ? AND psp_reference = ? AND state = ?`,
      ).get(input.orderId, input.pspReference, input.state);
      if (existing) return existing.id;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO payment_parts
       (id, order_id, attempt_id, psp_reference, amount_value, currency, state,
        created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.orderId,
      input.attemptId ?? null,
      input.pspReference ?? null,
      input.amount.value,
      input.amount.currency,
      input.state,
      now,
      now,
    );
    return id;
  }

  recordApiCall(input: {
    appId: AppId;
    correlationId: string;
    name: string;
    method: string;
    endpoint: string;
    status: number;
    durationMs: number;
    request: unknown;
    response: unknown;
    error?: string;
  }): string {
    const id = crypto.randomUUID();
    this.database.prepare(
      `INSERT INTO api_calls
       (id, app_id, correlation_id, name, method, endpoint, status, duration_ms,
        request_payload, response_payload, error, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.appId,
      input.correlationId,
      input.name,
      input.method,
      input.endpoint,
      input.status,
      input.durationMs,
      json(input.request),
      json(input.response),
      input.error ?? null,
      new Date().toISOString(),
    );
    return id;
  }

  recordCallback(input: {
    appId: AppId;
    correlationId: string;
    name: string;
    payload: unknown;
    occurredAt?: string;
  }): string {
    const id = crypto.randomUUID();
    this.database.prepare(
      `INSERT INTO frontend_callbacks
       (id, app_id, correlation_id, name, payload, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.appId,
      input.correlationId,
      input.name,
      json(input.payload),
      input.occurredAt ?? new Date().toISOString(),
    );
    return id;
  }

  recordWebhook(input: {
    appId: AppId;
    dedupeKey: string;
    correlationId: string;
    eventType: string;
    pspReference?: string;
    hmacValid: boolean;
    payload: unknown;
  }): { id: string; duplicate: boolean } {
    const id = crypto.randomUUID();
    const changes = this.database.prepare(
      `INSERT OR IGNORE INTO webhooks
       (id, app_id, dedupe_key, correlation_id, event_type, psp_reference,
        hmac_valid, payload, received_at, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.appId,
      input.dedupeKey,
      input.correlationId,
      input.eventType,
      input.pspReference ?? null,
      input.hmacValid ? 1 : 0,
      json(input.payload),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    return { id, duplicate: changes === 0 };
  }

  recordAction(input: {
    appId: AppId;
    orderId?: string;
    correlationId: string;
    action: string;
    state: string;
    idempotencyKey: string;
    payload: unknown;
  }): { id: string; duplicate: boolean } {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const changes = this.database.prepare(
      `INSERT OR IGNORE INTO lifecycle_actions
       (id, app_id, order_id, correlation_id, action, state, idempotency_key,
        payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.appId,
      input.orderId ?? null,
      input.correlationId,
      input.action,
      input.state,
      input.idempotencyKey,
      json(input.payload),
      now,
      now,
    );
    return { id, duplicate: changes === 0 };
  }

  /** The captures, cancels and refunds this app sent for an order, oldest first. */
  listActions(orderId: string): ModificationRequest[] {
    return this.database.prepare<{
      id: string;
      action: string;
      state: string;
      idempotency_key: string;
      payload: string;
      created_at: string;
    }>(
      "SELECT * FROM lifecycle_actions WHERE order_id = ? ORDER BY created_at",
    ).all(orderId).map((row) => mapAction(row));
  }

  findAction(idempotencyKey: string): ModificationRequest | undefined {
    const row = this.database.prepare<{
      id: string;
      action: string;
      state: string;
      idempotency_key: string;
      payload: string;
      created_at: string;
    }>("SELECT * FROM lifecycle_actions WHERE idempotency_key = ?").get(idempotencyKey);
    return row ? mapAction(row) : undefined;
  }

  /** Records Adyen's answer: the modification's PSP reference, or why the call failed. */
  updateAction(
    id: string,
    input: { state: ModificationRequest["state"]; pspReference?: string; reason?: string },
  ): void {
    const row = this.database.prepare<{ payload: string }>(
      "SELECT payload FROM lifecycle_actions WHERE id = ?",
    ).get(id);
    if (!row) return;
    const payload = {
      ...(parseJson(row.payload) as Record<string, unknown>),
      ...(input.pspReference ? { pspReference: input.pspReference } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    };
    this.database.prepare(
      "UPDATE lifecycle_actions SET state = ?, payload = ?, updated_at = ? WHERE id = ?",
    ).run(input.state, json(payload), new Date().toISOString(), id);
  }

  /** HMAC-valid CAPTURE, CANCELLATION, REFUND (and their failures) for an order. */
  modificationEvents(correlationId: string): ModificationEvent[] {
    return this.database.prepare<{
      event_type: string;
      payload: string;
      received_at: string;
    }>(
      "SELECT event_type, payload, received_at FROM webhooks WHERE correlation_id = ? AND hmac_valid = 1",
    ).all(correlationId).filter((row) => isModificationEvent(row.event_type)).map((row) => {
      const payload = parseJson(row.payload) as Record<string, unknown>;
      const amount = (payload.amount ?? {}) as Record<string, unknown>;
      return {
        eventCode: row.event_type,
        success: String(payload.success).toLowerCase() === "true",
        value: typeof amount.value === "number" ? amount.value : undefined,
        pspReference: typeof payload.pspReference === "string" ? payload.pspReference : undefined,
        reason: typeof payload.reason === "string" && payload.reason ? payload.reason : undefined,
        receivedAt: row.received_at,
      };
    });
  }

  audit(input: {
    appId: AppId;
    correlationId: string;
    actor?: string;
    action: string;
    outcome: string;
    payload?: unknown;
  }): string {
    const id = crypto.randomUUID();
    this.database.prepare(
      `INSERT INTO audit_log
       (id, app_id, correlation_id, actor, action, outcome, payload, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.appId,
      input.correlationId,
      input.actor ?? "playground-user",
      input.action,
      input.outcome,
      json(input.payload ?? {}),
      new Date().toISOString(),
    );
    return id;
  }

  timeline(correlationId: string): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    const apiRows = this.database.prepare<{
      id: string;
      correlation_id: string;
      name: string;
      method: string;
      endpoint: string;
      status: number;
      occurred_at: string;
      duration_ms: number;
      request_payload: string;
      response_payload: string;
      error: string | null;
    }>("SELECT * FROM api_calls WHERE correlation_id = ?").all(correlationId);
    for (const row of apiRows) {
      entries.push({
        id: row.id,
        correlationId: row.correlation_id,
        kind: "api_call",
        name: row.name,
        status: String(row.status),
        occurredAt: row.occurred_at,
        durationMs: row.duration_ms,
        method: row.method,
        endpoint: row.endpoint,
        payload: {
          request: parseJson(row.request_payload),
          response: parseJson(row.response_payload),
          ...(row.error ? { error: row.error } : {}),
        },
      });
    }

    const callbackRows = this.database.prepare<{
      id: string;
      correlation_id: string;
      name: string;
      payload: string;
      occurred_at: string;
    }>("SELECT * FROM frontend_callbacks WHERE correlation_id = ?").all(correlationId);
    for (const row of callbackRows) {
      entries.push({
        id: row.id,
        correlationId: row.correlation_id,
        kind: "frontend_callback",
        name: row.name,
        status: "received",
        occurredAt: row.occurred_at,
        payload: parseJson(row.payload),
      });
    }

    const webhookRows = this.database.prepare<{
      id: string;
      correlation_id: string;
      event_type: string;
      hmac_valid: number;
      payload: string;
      received_at: string;
    }>("SELECT * FROM webhooks WHERE correlation_id = ?").all(correlationId);
    for (const row of webhookRows) {
      entries.push({
        id: row.id,
        correlationId: row.correlation_id,
        kind: "webhook",
        name: row.event_type,
        status: row.hmac_valid ? "hmac-valid" : "hmac-invalid",
        hmacValid: Boolean(row.hmac_valid),
        occurredAt: row.received_at,
        payload: parseJson(row.payload),
      });
    }

    const actionRows = this.database.prepare<{
      id: string;
      correlation_id: string;
      action: string;
      state: string;
      payload: string;
      created_at: string;
    }>("SELECT * FROM lifecycle_actions WHERE correlation_id = ?").all(correlationId);
    for (const row of actionRows) {
      entries.push({
        id: row.id,
        correlationId: row.correlation_id,
        kind: "action",
        name: row.action,
        status: row.state,
        occurredAt: row.created_at,
        payload: parseJson(row.payload),
      });
    }

    return entries.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  }
}
