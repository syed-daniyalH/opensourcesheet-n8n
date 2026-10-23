export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface SourceRecord {
  source: string;
  externalId: string;
  fetchedAt: string;
  sourceUpdatedAt?: string;
  sourceUrl?: string;
  payload: JsonValue;
}

export interface NormalizedRecord {
  source: string;
  externalId: string;
  canonicalKey: string;
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  sourceUrl: string | null;
  contentHash: string;
  rawPayload: string;
  fields: Record<string, JsonValue>;
}

export interface SourceAdapter {
  readonly name: string;
  collect(): AsyncIterable<SourceRecord>;
}

export interface GristWriter {
  upsert(
    tableId: string,
    records: ReadonlyArray<Record<string, JsonValue>>,
    keyColumns: ReadonlyArray<string>,
  ): Promise<unknown>;
}

export interface PipelineOptions {
  tableId: string;
  keyColumns: ReadonlyArray<string>;
  batchSize: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  dryRun: boolean;
}

export interface PipelineSummary {
  source: string;
  seen: number;
  normalized: number;
  written: number;
  failed: number;
  dryRun: boolean;
}
