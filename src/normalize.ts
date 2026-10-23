import { createHash } from "node:crypto";
import type { JsonValue, NormalizedRecord, SourceRecord } from "./types.js";

function stable(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = stable(value[key] as JsonValue);
    }
    return result;
  }
  return value;
}

export function normalizeRecord(record: SourceRecord): NormalizedRecord {
  const externalId = record.externalId.trim();
  const source = record.source.trim();
  if (!source) throw new Error("Source record is missing source");
  if (!externalId) throw new Error("Source record is missing externalId");
  if (!record.fetchedAt) throw new Error("Source record is missing fetchedAt");

  const rawPayload = JSON.stringify(stable(record.payload));
  const contentHash = createHash("sha256").update(rawPayload).digest("hex");
  const canonicalKey = `${source}:${externalId}`;

  return {
    source,
    externalId,
    canonicalKey,
    fetchedAt: record.fetchedAt,
    sourceUpdatedAt: record.sourceUpdatedAt ?? null,
    sourceUrl: record.sourceUrl ?? null,
    contentHash,
    rawPayload,
    fields: {
      Source: source,
      ExternalId: externalId,
      CanonicalKey: canonicalKey,
      FetchedAt: record.fetchedAt,
      SourceUpdatedAt: record.sourceUpdatedAt ?? null,
      SourceUrl: record.sourceUrl ?? null,
      ContentHash: contentHash,
      RawPayload: rawPayload,
      Status: "ready",
    },
  };
}
