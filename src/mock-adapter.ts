import type { SourceAdapter, SourceRecord } from "./types.js";

export class MockSourceAdapter implements SourceAdapter {
  public readonly name = "mock-source";

  public async *collect(): AsyncIterable<SourceRecord> {
    const fetchedAt = new Date().toISOString();
    yield {
      source: this.name,
      externalId: "demo-001",
      fetchedAt,
      payload: { title: "Demo record", value: 1 },
    };
    yield {
      source: this.name,
      externalId: "demo-002",
      fetchedAt,
      payload: { title: "Second demo record", value: 2 },
    };
  }
}
