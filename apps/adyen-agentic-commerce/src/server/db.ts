// Spec: knowledge/components/adyen-agentic-commerce.md
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";

// A small document store: the demo has one shopper and a handful of rows, so JSON documents keyed
// by collection keep the schema in the TypeScript types instead of in migrations.
export type Collection =
  | "carts"
  | "checkouts"
  | "orders"
  | "payments"
  | "webhooks"
  | "clients"
  | "grants"
  | "auth_requests"
  | "codes"
  | "tokens"
  | "cards";

const SCHEMA = `
create table if not exists docs (
  collection text not null,
  id text not null,
  data text not null,
  created_at text not null,
  updated_at text not null,
  primary key (collection, id)
);
create index if not exists docs_created on docs (collection, created_at);
create table if not exists idempotency (
  scope text not null,
  key text not null,
  request_hash text not null,
  status integer not null,
  response text not null,
  created_at text not null,
  primary key (scope, key)
);
create table if not exists trace (
  id integer primary key autoincrement,
  at text not null,
  channel text not null,
  actor text not null,
  method text not null,
  path text not null,
  status integer not null,
  ref text,
  detail text not null
);
create table if not exists seen_jti (
  jti text primary key,
  expires_at integer not null
);
`;

let db: Database | undefined;

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path, { create: true, strict: true });
  database.exec("pragma journal_mode = wal; pragma busy_timeout = 5000;");
  database.exec(SCHEMA);
  return database;
}

export function database(): Database {
  db ??= openDatabase(config().databasePath);
  return db;
}

// Tests swap in an in-memory database.
export function useDatabase(next: Database): void {
  db = next;
}

const now = () => new Date().toISOString();

export function put<T extends object>(collection: Collection, id: string, data: T): T {
  const at = now();
  database()
    .query(
      `insert into docs (collection, id, data, created_at, updated_at) values ($c, $id, $d, $at, $at)
       on conflict (collection, id) do update set data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run({ c: collection, id, d: JSON.stringify(data), at });
  return data;
}

export function get<T>(collection: Collection, id: string): T | undefined {
  const row = database()
    .query<{ data: string }, { c: string; id: string }>(
      "select data from docs where collection = $c and id = $id",
    )
    .get({ c: collection, id });
  return row ? (JSON.parse(row.data) as T) : undefined;
}

export function remove(collection: Collection, id: string): void {
  database().query("delete from docs where collection = $c and id = $id").run({ c: collection, id });
}

export function list<T>(collection: Collection, limit = 200): T[] {
  return database()
    .query<{ data: string }, { c: string; n: number }>(
      "select data from docs where collection = $c order by created_at desc limit $n",
    )
    .all({ c: collection, n: limit })
    .map((row) => JSON.parse(row.data) as T);
}

// Replay protection for JWT ids: true when the jti was not seen before and is now recorded.
export function claimJti(jti: string, expiresAt: number): boolean {
  const d = database();
  d.query("delete from seen_jti where expires_at < $t").run({ t: Math.floor(Date.now() / 1000) });
  const result = d.query("insert or ignore into seen_jti (jti, expires_at) values ($j, $e)")
    .run({ j: jti, e: expiresAt });
  return result.changes === 1;
}
