import assert from "node:assert/strict";
import test from "node:test";
import { MockSourceAdapter } from "../src/mock-adapter.js";
import { runPipeline } from "../src/pipeline.js";
import type { GristWriter, JsonValue } from "../src/types.js";

class MemoryWriter implements GristWriter {
  public calls: Array<{ tableId: string; records: ReadonlyArray<Record<string, JsonValue>>; keys: ReadonlyArray<string> }> = [];

  public async upsert(
    tableId: string,
    records: ReadonlyArray<Record<string, JsonValue>>,
    keyColumns: ReadonlyArray<string>,
  ): Promise<unknown> {
    this.calls.push({ tableId, records, keys: keyColumns });
    return { addRecordIds: [1, 2], updateRecordIds: [] };
  }
}

class FailingSourceAdapter {
  public readonly name = "invalid-source";

  public async *collect() {
    yield {
      source: "invalid-source",
      externalId: "",
      fetchedAt: "2026-10-24T00:00:00.000Z",
      payload: {},
    };
  }
}

class FlakyWriter implements GristWriter {
  public attempts = 0;

  public async upsert(
    _tableId: string,
    _records: ReadonlyArray<Record<string, JsonValue>>,
    _keyColumns: ReadonlyArray<string>,
  ): Promise<unknown> {
    this.attempts += 1;
    if (this.attempts === 1) throw new Error("temporary Grist outage");
    return { addRecordIds: [], updateRecordIds: [1, 2] };
  }
}

test("dry-run collects and normalizes without writing", async () => {
  const writer = new MemoryWriter();
  const summary = await runPipeline(new MockSourceAdapter(), writer, {
    tableId: "RawRecords",
    keyColumns: ["CanonicalKey"],
    batchSize: 100,
    maxRetries: 1,
    retryBaseDelayMs: 1,
    dryRun: true,
  });

  assert.deepEqual(summary, {
    source: "mock-source",
    seen: 2,
    normalized: 2,
    written: 0,
    failed: 0,
    dryRun: true,
  });
  assert.equal(writer.calls.length, 0);
});

test("writes normalized records using the configured key", async () => {
  const writer = new MemoryWriter();
  const summary = await runPipeline(new MockSourceAdapter(), writer, {
    tableId: "RawRecords",
    keyColumns: ["CanonicalKey"],
    batchSize: 1,
    maxRetries: 1,
    retryBaseDelayMs: 1,
    dryRun: false,
  });

  assert.equal(summary.written, 2);
  assert.equal(writer.calls.length, 2);
  assert.deepEqual(writer.calls[0]?.keys, ["CanonicalKey"]);
});

test("counts invalid source records without writing them", async () => {
  const writer = new MemoryWriter();
  const summary = await runPipeline(new FailingSourceAdapter(), writer, {
    tableId: "RawRecords",
    keyColumns: ["CanonicalKey"],
    batchSize: 100,
    maxRetries: 1,
    retryBaseDelayMs: 1,
    dryRun: false,
  });

  assert.deepEqual(summary, {
    source: "invalid-source",
    seen: 1,
    normalized: 0,
    written: 0,
    failed: 1,
    dryRun: false,
  });
  assert.equal(writer.calls.length, 0);
});

test("retries a transient batch write and reports the successful batch", async () => {
  const writer = new FlakyWriter();
  const summary = await runPipeline(new MockSourceAdapter(), writer, {
    tableId: "RawRecords",
    keyColumns: ["CanonicalKey"],
    batchSize: 100,
    maxRetries: 1,
    retryBaseDelayMs: 1,
    dryRun: false,
  });

  assert.equal(writer.attempts, 2);
  assert.deepEqual(summary, {
    source: "mock-source",
    seen: 2,
    normalized: 2,
    written: 2,
    failed: 0,
    dryRun: false,
  });
});
