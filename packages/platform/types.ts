export type AppId = "digital" | "ipp" | "agentic" | "styling";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Amount {
  currency: string;
  value: number;
}

export interface Address {
  street: string;
  houseNumberOrName: string;
  postalCode: string;
  city: string;
  country: string;
  stateOrProvince?: string;
  firstName?: string;
  lastName?: string;
}

export interface AddressPair {
  billingAddress: Address;
  deliveryAddress: Address;
}

export type OrderState =
  | "open"
  | "payment_pending"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "expired"
  | "failed";

export type AttemptState =
  | "created"
  | "pending"
  | "authorised"
  | "refused"
  | "cancelled"
  | "expired"
  | "error";

export interface OrderAggregate {
  id: string;
  reference: string;
  appId: AppId;
  flow: string;
  state: OrderState;
  amount: Amount;
  paidValue: number;
  expiresAt?: string;
  paymentLinkId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttemptAggregate {
  id: string;
  orderId: string;
  state: AttemptState;
  paymentMethod?: string;
  pspReference?: string;
  amount: Amount;
  refusalReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEntry {
  id: string;
  correlationId: string;
  kind: "api_call" | "frontend_callback" | "webhook" | "action" | "state";
  name: string;
  status: string;
  occurredAt: string;
  durationMs?: number;
  payload: JsonValue;
  hmacValid?: boolean;
  /** API calls only: what the inspector shows and copies as cURL. */
  method?: string;
  endpoint?: string;
}

export interface PublicProfile {
  id: string;
  label: string;
  appId: AppId;
  isDefault: boolean;
  isConfigured: boolean;
  missingFields: string[];
  capabilities: string[];
  updatedAt: string;
  /** Not a secret, needed client-side for Google Pay's gatewayMerchantId. */
  merchantAccount?: string;
}

export interface ProfileSecrets {
  apiKey?: string;
  merchantAccount?: string;
  clientKey?: string;
  hmacKey?: string;
  terminalId?: string;
  webhookBasicAuthUser?: string;
  webhookBasicAuthPassword?: string;
  agenticBearerToken?: string;
}

/**
 * What Adyen supports for a payment method (docs.adyen.com/payment-methods,
 * read 2026-10-10), plus how this TEST merchant account captures it.
 */
export interface LifecycleCapabilities {
  paymentMethod: string;
  separateCapture: boolean;
  partialCapture: boolean;
  /** Also needs Adyen to enable multiple partial captures on the merchant account. */
  multiplePartialCaptures: boolean;
  refund: boolean;
  partialRefund: boolean;
  multiplePartialRefunds: boolean;
  /**
   * The merchant account's setting, not Adyen's limit: captured on
   * authorisation, so there is nothing left to capture or cancel.
   */
  automaticCapture: boolean;
  validityMinutes: number;
  notes: string;
  sourceUrl: string;
}

export interface ActionPermission {
  allowed: boolean;
  reason: string;
  /** Adyen received a request of this kind and its webhook has not arrived. */
  waiting?: boolean;
  /** Minor units: the most this action can take now. */
  maxValue?: number;
  /** Whether less than maxValue may be requested. */
  partial?: boolean;
}

export type ModificationKind = "capture" | "cancel" | "refund";

/** A capture, cancel or refund this playground sent, as stored. */
export interface ModificationRequest {
  id: string;
  kind: ModificationKind;
  /** requested: sent, no answer yet; received: Adyen said so; rejected: the call failed. */
  state: "requested" | "received" | "rejected";
  value?: number;
  currency?: string;
  pspReference?: string;
  reason?: string;
  idempotencyKey: string;
  createdAt: string;
}

/** An HMAC-valid modification webhook for the payment. */
export interface ModificationEvent {
  eventCode: string;
  success: boolean;
  value?: number;
  pspReference?: string;
  reason?: string;
  receivedAt: string;
}

/** One capture, cancel or refund with its outcome, as the Back Office shows it. */
export interface Modification {
  kind: ModificationKind;
  status: "pending" | "succeeded" | "failed" | "reversed" | "rejected";
  value?: number;
  pspReference?: string;
  reason?: string;
  idempotencyKey?: string;
  requestedAt?: string;
  settledAt?: string;
  /** Sent from somewhere else (the Customer Area, another system): only its webhook is known. */
  external: boolean;
}

/** Minor units. What the webhooks settled, and what is still waiting for one. */
export interface Ledger {
  authorised: number;
  captured: number;
  capturePending: number;
  refunded: number;
  refundPending: number;
  cancelled: boolean;
  cancelPending: boolean;
}

export interface ActionPermissions {
  capture: ActionPermission;
  cancel: ActionPermission;
  refund: ActionPermission;
}
