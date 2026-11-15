// Spec: knowledge/operations/build-and-test.md
// The @std/assert helpers the suites were written with under Deno, on bun:test's expect, so every
// ported assertion keeps its exact wording and strength (deep equality checks types and keys).
import { expect } from "bun:test";

type ErrorClass<E extends Error> = abstract new (...args: never[]) => E;

export function assert(condition: unknown, message = "Assertion failed."): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  try {
    expect(actual).toStrictEqual(expected);
  } catch (error) {
    if (message === undefined) throw error;
    throw new Error(`${message}\n${(error as Error).message}`);
  }
}

export function assertNotEquals<T>(actual: T, expected: T): void {
  expect(actual).not.toStrictEqual(expected);
}

export function assertExists<T>(
  value: T,
  message = "Expected a value.",
): asserts value is NonNullable<T> {
  if (value === null || value === undefined) throw new Error(message);
}

export function assertStringIncludes(actual: string, expected: string): void {
  expect(actual).toContain(expected);
}

function checkError<E extends Error>(error: unknown, type?: ErrorClass<E>, includes?: string): E {
  if (type && !(error instanceof type)) {
    throw new Error(`Expected a ${type.name}, got ${String(error)}.`);
  }
  if (includes !== undefined) expect((error as Error).message).toContain(includes);
  return error as E;
}

export function assertThrows<E extends Error = Error>(
  run: () => unknown,
  type?: ErrorClass<E>,
  includes?: string,
): E {
  try {
    run();
  } catch (error) {
    return checkError(error, type, includes);
  }
  throw new Error("Expected the function to throw.");
}

export async function assertRejects<E extends Error = Error>(
  run: () => Promise<unknown>,
  type?: ErrorClass<E>,
  includes?: string,
): Promise<E> {
  try {
    await run();
  } catch (error) {
    return checkError(error, type, includes);
  }
  throw new Error("Expected the promise to reject.");
}
