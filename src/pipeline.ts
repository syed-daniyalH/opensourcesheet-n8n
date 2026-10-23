import { normalizeRecord } from "./normalize.js";
import { withRetry } from "./retry.js";
import type { GristWriter, PipelineOptions, PipelineSummary, SourceAdapter } from "./types.js";

export async function runPipeline(
  adapter: SourceAdapter,
  writer: GristWriter,
  options: PipelineOptions,
): Promise<PipelineSummary> {
  const normalized: Array<Record<string, any>> = [];
  let seen = 0;
  let failed = 0;

  for await (const sourceRecord of adapter.collect()) {
    seen += 1;
    try {
      normalized.push(normalizeRecord(sourceRecord).fields);
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ event: "record_normalization_failed", source: adapter.name, error: String(error) }));
    }
  }

  let written = 0;
  if (!options.dryRun) {
    for (let offset = 0; offset < normalized.length; offset += options.batchSize) {
      const batch = normalized.slice(offset, offset + options.batchSize);
      try {
        await withRetry(
          () => writer.upsert(options.tableId, batch, options.keyColumns),
          { maxRetries: options.maxRetries, baseDelayMs: options.retryBaseDelayMs },
        );
        written += batch.length;
      } catch (error) {
        failed += batch.length;
        console.error(JSON.stringify({ event: "grist_upsert_failed", source: adapter.name, batchSize: batch.length, error: String(error) }));
      }
    }
  }

  return {
    source: adapter.name,
    seen,
    normalized: normalized.length,
    written,
    failed,
    dryRun: options.dryRun,
  };
}
