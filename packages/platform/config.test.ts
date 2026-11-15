import { test } from "bun:test";
import { assertEquals } from "../../testing/assert.ts";
import { unquoteEnvValue } from "./config.ts";

test("an env value quoted by `docker run --env-file` is read without its quotes", () => {
  assertEquals(unquoteEnvValue('"AQE-test-key"'), "AQE-test-key");
  assertEquals(unquoteEnvValue("'8001'"), "8001");
  assertEquals(unquoteEnvValue("plain"), "plain");
  assertEquals(unquoteEnvValue('"unbalanced'), '"unbalanced');
  assertEquals(unquoteEnvValue('"'), '"');
  assertEquals(unquoteEnvValue(""), "");
});
