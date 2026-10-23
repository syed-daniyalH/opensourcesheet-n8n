import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRecord } from "../src/normalize.js";

test("normalization creates a deterministic idempotency key and hash", () => {
  const record = normalizeRecord({
    source: "api",
    externalId: " 42 ",
    fetchedAt: "2026-10-24T00:00:00.000Z",
    payload: { b: 2, a: 1 },
  });

  assert.equal(record.canonicalKey, "api:42");
  assert.equal(record.fields.CanonicalKey, "api:42");
  assert.equal(record.fields.ExternalId, "42");
  assert.equal(record.contentHash.length, 64);
});

test("normalization rejects records without an external id", () => {
  assert.throws(() => normalizeRecord({
    source: "api",
    externalId: "",
    fetchedAt: "2026-10-24T00:00:00.000Z",
    payload: {},
  }), /externalId/);
});
