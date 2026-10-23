import { loadConfig } from "./config.js";
import { GristClient } from "./grist-client.js";
import { MockSourceAdapter } from "./mock-adapter.js";
import { runPipeline } from "./pipeline.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.mockSource) {
    throw new Error("No real source adapter is configured yet. Set MOCK_SOURCE=true for the foundation smoke test.");
  }

  const adapter = new MockSourceAdapter();
  const writer = new GristClient(config.baseUrl, config.docId, config.apiKey);
  const summary = await runPipeline(adapter, writer, {
    tableId: config.tableId,
    keyColumns: ["CanonicalKey"],
    batchSize: config.batchSize,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,
    dryRun: config.dryRun,
  });

  console.log(JSON.stringify({ event: "ingestion_complete", ...summary }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "fatal", error: String(error) }));
  process.exitCode = 1;
});
