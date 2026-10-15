export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  label TEXT NOT NULL,
  encrypted_secrets TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS profiles_app_idx ON profiles(app_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  flow TEXT NOT NULL,
  state TEXT NOT NULL,
  amount_value INTEGER NOT NULL,
  currency TEXT NOT NULL,
  paid_value INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  payment_link_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_app_idx ON orders(app_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS payment_sessions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  adyen_session_id TEXT,
  state TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  payment_method TEXT,
  psp_reference TEXT,
  amount_value INTEGER NOT NULL,
  currency TEXT NOT NULL,
  refusal_reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_order_idx ON attempts(order_id, created_at);

CREATE TABLE IF NOT EXISTS payment_parts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  psp_reference TEXT,
  amount_value INTEGER NOT NULL,
  currency TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_calls (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  request_payload TEXT NOT NULL,
  response_payload TEXT NOT NULL,
  error TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_calls_correlation_idx
  ON api_calls(correlation_id, occurred_at);

CREATE TABLE IF NOT EXISTS frontend_callbacks (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS frontend_callbacks_correlation_idx
  ON frontend_callbacks(correlation_id, occurred_at);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  psp_reference TEXT,
  hmac_valid INTEGER NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  processing_error TEXT
);
CREATE INDEX IF NOT EXISTS webhooks_correlation_idx ON webhooks(correlation_id, received_at);

CREATE TABLE IF NOT EXISTS lifecycle_actions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  correlation_id TEXT NOT NULL,
  action TEXT NOT NULL,
  state TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_correlation_idx ON audit_log(correlation_id, occurred_at);

-- The playground no longer calls GET /sessions/{id}: Adyen does not update
-- the status it returns. Runs at every start, so old rows go everywhere.
DELETE FROM api_calls WHERE name = 'Checkout API GET /sessions/{id}';
`;
