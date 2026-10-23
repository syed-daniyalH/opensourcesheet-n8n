import assert from "node:assert/strict";
import test from "node:test";
import { GristClient } from "../src/grist-client.js";

test("builds an authenticated idempotent Grist upsert request", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetchMock: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ addRecordIds: [], updateRecordIds: [7] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const client = new GristClient("https://grist.example.test", "doc/123", "secret", fetchMock);
  const result = await client.upsert("Raw Records", [
    { CanonicalKey: "api:42", ExternalId: "42", Status: "ready" },
  ], ["CanonicalKey"]);

  assert.deepEqual(result, { addRecordIds: [], updateRecordIds: [7] });
  assert.equal(requestUrl, "https://grist.example.test/api/docs/doc%2F123/tables/Raw%20Records/records");
  assert.equal(requestInit?.method, "PUT");
  assert.equal((requestInit?.headers as Record<string, string>).Authorization, "Bearer secret");

  const body = JSON.parse(String(requestInit?.body)) as {
    records: Array<{ require: Record<string, unknown>; fields: Record<string, unknown> }>;
  };
  assert.deepEqual(body.records[0]?.require, { CanonicalKey: "api:42" });
  assert.equal(body.records[0]?.fields.Status, "ready");
});

test("rejects an unsuccessful Grist response with bounded response text", async () => {
  const fetchMock: typeof fetch = async () => new Response("authorization failed", { status: 401 });
  const client = new GristClient("https://grist.example.test", "doc", "bad-key", fetchMock);

  await assert.rejects(
    () => client.upsert("RawRecords", [{ CanonicalKey: "api:42" }], ["CanonicalKey"]),
    /Grist upsert failed \(401\): authorization failed/,
  );
});

test("rejects records missing the configured upsert key", async () => {
  const fetchMock: typeof fetch = async () => new Response("{}", { status: 200 });
  const client = new GristClient("https://grist.example.test", "doc", "secret", fetchMock);

  await assert.rejects(
    () => client.upsert("RawRecords", [{ ExternalId: "42" }], ["CanonicalKey"]),
    /Missing upsert key column: CanonicalKey/,
  );
});
