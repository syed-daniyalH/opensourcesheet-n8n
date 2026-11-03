import { createHmac, timingSafeEqual } from "node:crypto";
import type { JsonObject, JsonValue } from "./types.js";

export const META_GRAPH_VERSION = "v21.0";

// Meta subscribes a webhook by calling GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
export function metaChallenge(query: URLSearchParams, verifyToken: string): string | null {
  if (query.get("hub.mode") !== "subscribe") return null;
  const supplied = query.get("hub.verify_token") ?? "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return query.get("hub.challenge");
}

// Meta signs each POST body with HMAC-SHA256 using the app secret: "X-Hub-Signature-256: sha256=<hex>".
export function verifyHmacSignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(header.slice(7), "hex");
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

// Lead notifications only carry ids; the form answers are fetched from the Graph API.
export async function enrichMetaLeads(
  items: JsonValue[],
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<JsonValue[]> {
  return Promise.all(items.map(async (item) => {
    if (!isObject(item) || typeof item.leadgen_id !== "string" && typeof item.leadgen_id !== "number") return item;
    const id = encodeURIComponent(String(item.leadgen_id));
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${id}?fields=created_time,field_data,ad_id,ad_name,adset_name,campaign_name,form_id,platform`;
    try {
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.json() as JsonValue;
      if (!response.ok || !isObject(body)) {
        const message = isObject(body) && isObject(body.error) && typeof body.error.message === "string" ? body.error.message : `HTTP ${response.status}`;
        return { ...item, enrichment_error: message };
      }
      return { ...item, ...body, leadgen_id: item.leadgen_id };
    } catch (error) {
      return { ...item, enrichment_error: error instanceof Error ? error.message : String(error) };
    }
  }));
}
