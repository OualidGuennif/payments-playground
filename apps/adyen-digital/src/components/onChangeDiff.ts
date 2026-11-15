/**
 * What one Adyen Web onChange moved since the previous one. The state is
 * re-sent whole on every edit, so a row per event only reads well as a diff.
 */

import { clip, field, text } from "./read.ts";

/** Fields that change on every call without meaning anything to a reader. */
const NOISE = /(^|\.)(sdkData|checkoutAttemptId|riskData|browserInfo)(\.|$)/;

type Flat = Map<string, string>;

function flatten(value: unknown, path = "", out: Flat = new Map()): Flat {
  if (path && NOISE.test(path)) return out;
  if (value === undefined) return out;
  // An error is one value, whatever its shape: it is there or it is not.
  const isError = /^errors\.[^.]+$/.test(path);
  if (!isError && value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      flatten(entry, path ? `${path}.${key}` : key, out);
    }
    return out;
  }
  const leaf = path.split(".").at(-1) ?? "";
  // An encrypted value changes with every keystroke; only whether it is
  // there says something. Only in the payment data: valid.encrypted* and
  // errors.encrypted* are that field's status and read as they are.
  if (path.startsWith("data.") && leaf.startsWith("encrypted")) {
    out.set(path, value ? "set" : "empty");
  } else {
    out.set(path, value === undefined ? "undefined" : JSON.stringify(value));
  }
  return out;
}

export interface Change {
  path: string;
  before?: string;
  after?: string;
}

export function diff(previous: unknown, current: unknown): Change[] {
  const before = flatten(previous);
  const after = flatten(current);
  const changes: Change[] = [];
  for (const [path, value] of after) {
    if (before.get(path) !== value) changes.push({ path, before: before.get(path), after: value });
  }
  for (const [path, value] of before) {
    if (!after.has(path)) changes.push({ path, before: value });
  }
  return changes;
}

export function plain(value: string | undefined): string {
  if (value === undefined) return "—";
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
}

/** Adyen Web reports "no error" as null or false, and an error as an object. */
function noError(value: string | undefined): boolean {
  return value === undefined || value === "null" || value === "false";
}

function errorText(value: string): string {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return text(parsed.errorI18n) ?? text(parsed.errorMessage) ?? text(parsed.error) ?? "error";
  } catch {
    return "error";
  }
}

/** One short phrase per change, the way a person would say it; null when it says nothing. */
function phrase(change: Change): string | null {
  const parts = change.path.split(".");
  const leaf = parts.at(-1) ?? change.path;
  const after = change.after;
  if (parts[0] === "valid") return `${leaf} ${after === "true" ? "✓" : "✗"}`;
  if (parts[0] === "errors") {
    if (noError(after)) return noError(change.before) ? null : `${leaf} error cleared`;
    return `${leaf}: ${clip(errorText(after as string), 32)}`;
  }
  if (change.path === "isValid") return after === "true" ? "form valid" : "form incomplete";
  if (after === "set") return `${leaf} entered`;
  if (after === "empty") return `${leaf} cleared`;
  if (after === undefined) return `${leaf} removed`;
  return `${leaf} ${clip(plain(after))}`;
}

export function onChangeSummary(payload: unknown, changes: Change[] | null): string[] {
  if (!changes) {
    const method = text(field(payload, "data.paymentMethod.type"));
    const brand = text(field(payload, "data.paymentMethod.brand"));
    const valid = field(payload, "isValid") === true ? "form valid" : "form incomplete";
    return [method, brand, valid].filter((part): part is string => Boolean(part));
  }
  if (!changes.length) return ["no change"];
  const phrases = changes.map(phrase).filter((part): part is string => part !== null);
  return phrases.length ? phrases : ["internal update"];
}
