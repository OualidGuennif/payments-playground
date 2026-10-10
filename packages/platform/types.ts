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

export interface LifecycleCapabilities {
  paymentMethod: string;
  separateCapture: boolean;
  automaticCapture: boolean;
  settlementOnly: boolean;
  refund: boolean;
  partialRefund: boolean;
  cancel: boolean;
  validityMinutes: number;
  notes: string;
  sourceUrl: string;
}

export interface ActionPermission {
  allowed: boolean;
  reason: string;
}

export interface ActionPermissions {
  capture: ActionPermission;
  cancel: ActionPermission;
  refund: ActionPermission;
}
