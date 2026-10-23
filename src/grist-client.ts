import type { GristWriter, JsonValue } from "./types.js";

export class GristClient implements GristWriter {
  public constructor(
    private readonly baseUrl: string,
    private readonly docId: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public async upsert(
    tableId: string,
    records: ReadonlyArray<Record<string, JsonValue>>,
    keyColumns: ReadonlyArray<string>,
  ): Promise<unknown> {
    if (records.length === 0) return { addRecordIds: [], updateRecordIds: [] };
    if (keyColumns.length === 0) throw new Error("At least one key column is required for an upsert");

    const body = {
      records: records.map((fields) => ({
        require: Object.fromEntries(keyColumns.map((key) => {
          if (!(key in fields)) throw new Error(`Missing upsert key column: ${key}`);
          return [key, fields[key]];
        })),
        fields,
      })),
    };

    const endpoint = new URL(
      `/api/docs/${encodeURIComponent(this.docId)}/tables/${encodeURIComponent(tableId)}/records`,
      `${this.baseUrl}/`,
    );
    const response = await this.fetchImpl(endpoint, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Grist upsert failed (${response.status}): ${responseText.slice(0, 500)}`);
    }

    return response.json();
  }
}
