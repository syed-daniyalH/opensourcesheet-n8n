import assert from "node:assert/strict";
import test from "node:test";
import { withRetry } from "../src/retry.js";

test("retries transient failures with exponential delays", async () => {
  let attempts = 0;
  const delays: number[] = [];

  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error(`temporary failure ${attempts}`);
      return "ok";
    },
    { maxRetries: 3, baseDelayMs: 10, sleep: async (delay) => delays.push(delay) },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("stops after the configured retry budget", async () => {
  let attempts = 0;

  await assert.rejects(
    () => withRetry(
      async () => {
        attempts += 1;
        throw new Error("permanent failure");
      },
      { maxRetries: 2, baseDelayMs: 1, sleep: async () => undefined },
    ),
    /permanent failure/,
  );

  assert.equal(attempts, 3);
});
