import { test } from "bun:test";
import { assert, assertEquals } from "../../../../testing/assert.ts";
import { pollRenewal, type RenewalWait } from "./session-renewal.ts";

function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

const wait = (refusals: number): RenewalWait => ({ waiting: true, refusals, limit: 5 });

test("the renewal waits while the server counts refusals, then takes the new session", async () => {
  const answers: Array<RenewalWait | { session: string }> = [wait(3), wait(4), { session: "CS2" }];
  const seen: number[] = [];
  const session = await pollRenewal({
    ask: async () => answers.shift() as RenewalWait | { session: string },
    onWait: (answer) => seen.push(answer.refusals),
    stale: () => false,
    ...fakeClock(),
  });
  assertEquals(session, { session: "CS2" });
  assertEquals(seen, [3, 4]);
});

test("a renewal still waiting after 60 s ends in an error, never a session", async () => {
  let asked = 0;
  let failure: unknown;
  try {
    await pollRenewal({
      ask: async () => {
        asked += 1;
        return wait(2);
      },
      onWait: () => undefined,
      stale: () => false,
      ...fakeClock(),
    });
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error);
  assert(failure.message.includes("2 of 5 refusals"));
  // Asked at 0 s, 2 s, … 60 s.
  assertEquals(asked, 31);
});

test("a refusal from the server and a newer run both stop the renewal", async () => {
  let failure: unknown;
  try {
    await pollRenewal({
      ask: async () => {
        throw new Error("This order is paid.");
      },
      onWait: () => undefined,
      stale: () => false,
      ...fakeClock(),
    });
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error && failure.message === "This order is paid.");

  let stale = false;
  const result = await pollRenewal({
    ask: async () => {
      stale = true;
      return wait(1);
    },
    onWait: () => undefined,
    stale: () => stale,
    ...fakeClock(),
  });
  assertEquals(result, null);
});
