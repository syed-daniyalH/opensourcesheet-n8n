import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { normalizeRecord } from "../src/normalize.js";
import type { SourceRecord } from "../src/types.js";

const fixturePath = fileURLToPath(new URL("./fixtures/source-records.json", import.meta.url));

test("normalizes representative API payload fixtures without losing provenance", async () => {
  const records = JSON.parse(await readFile(fixturePath, "utf8")) as SourceRecord[];
  const normalized = records.map(normalizeRecord);

  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized.map((record) => record.canonicalKey), [
    "punchdeck-api:pd-1001",
    "punchdeck-api:pd-1002",
  ]);
  assert.equal(normalized[0]?.fields.SourceUrl, "https://api.example.test/items/pd-1001");
  assert.match(normalized[1]?.rawPayload ?? "", /Unicode ✓ payload/);
});

test("hashes equivalent JSON objects identically regardless of key order", () => {
  const first = normalizeRecord({
    source: "fixture",
    externalId: "same",
    fetchedAt: "2026-10-24T00:00:00.000Z",
    payload: { z: 3, nested: { b: 2, a: 1 }, a: 1 },
  });
  const second = normalizeRecord({
    source: "fixture",
    externalId: "same",
    fetchedAt: "2026-10-24T00:00:00.000Z",
    payload: { a: 1, nested: { a: 1, b: 2 }, z: 3 },
  });

  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.rawPayload, second.rawPayload);
});
