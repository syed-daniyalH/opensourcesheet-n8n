import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  GRIST_BASE_URL: "https://grist.example.test/",
  GRIST_DOC_ID: "doc-123",
  GRIST_TABLE_ID: "RawRecords",
  GRIST_API_KEY: "test-only-key",
  SOURCE_NAME: "punchdeck-api",
};

test("loads defaults and removes a trailing base URL slash", () => {
  const config = loadConfig(baseEnv);

  assert.equal(config.baseUrl, "https://grist.example.test");
  assert.equal(config.dryRun, true);
  assert.equal(config.mockSource, false);
  assert.equal(config.batchSize, 100);
  assert.equal(config.maxRetries, 3);
});

test("parses explicit boolean and retry settings", () => {
  const config = loadConfig({
    ...baseEnv,
    DRY_RUN: "false",
    MOCK_SOURCE: "yes",
    BATCH_SIZE: "25",
    MAX_RETRIES: "5",
    RETRY_BASE_DELAY_MS: "250",
  });

  assert.equal(config.dryRun, false);
  assert.equal(config.mockSource, true);
  assert.equal(config.batchSize, 25);
  assert.equal(config.maxRetries, 5);
  assert.equal(config.retryBaseDelayMs, 250);
});

test("rejects missing, malformed, and unsupported configuration", () => {
  const missing = { ...baseEnv };
  delete missing.GRIST_API_KEY;
  assert.throws(() => loadConfig(missing), /GRIST_API_KEY/);

  assert.throws(() => loadConfig({ ...baseEnv, GRIST_BASE_URL: "not-a-url" }), /HTTP\(S\) URL/);
  assert.throws(() => loadConfig({ ...baseEnv, GRIST_BASE_URL: "ftp://grist.example.test" }), /HTTP\(S\) URL/);
  assert.throws(() => loadConfig({ ...baseEnv, BATCH_SIZE: "0" }), /positive integer/);
  assert.throws(() => loadConfig({ ...baseEnv, DRY_RUN: "maybe" }), /true or false/);
});
