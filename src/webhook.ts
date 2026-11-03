import { createHash } from "node:crypto";
import { normalizeRecord } from "./normalize.js";
import { runPipeline } from "./pipeline.js";
import { literalCellText, type SheetDocument, type SheetStore, type SheetTab } from "./sheet-store.js";
import type { GristWriter, JsonObject, JsonValue, NormalizedRecord, SourceAdapter, SourceRecord } from "./types.js";

export const WEBHOOK_DOCUMENT_ID = "webhook-leads";
const WEBHOOK_SHEET_NAME = "Leads";
const MAX_RECORDS_PER_REQUEST = 1000;
const MAX_FIELD_COLUMNS = 200;
const DEFAULT_MAX_ROWS_PER_SHEET = 20_000;

const FIXED_COLUMNS = ["Received at", "Source", "External ID", "Key"] as const;
const ID_FIELDS = ["externalId", "external_id", "leadgen_id", "lead_id", "id", "uuid", "_id"];
const UPDATED_FIELDS = ["sourceUpdatedAt", "created_time", "createdAt", "created_at", "updatedAt", "updated_at", "timestamp"];
const URL_FIELDS = ["sourceUrl", "source_url", "url"];
const SOURCE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

export interface WebhookGristTarget {
  writer: GristWriter;
  tableId: string;
  batchSize: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

export interface WebhookIngestOptions {
  store: SheetStore;
  grist: WebhookGristTarget | null;
  now?: () => Date;
  // Validate and preview only; nothing is written.
  dryRun?: boolean;
  maxRowsPerSheet?: number;
  // Recorded as the document's "last changed by".
  user?: string;
}

export interface WebhookIngestResult {
  received: number;
  accepted: number;
  failed: number;
  errors: string[];
  sheet: { documentId: string; added: number; updated: number };
  grist: { status: "written" | "skipped" | "failed"; written: number; reason?: string };
  dryRun?: boolean;
  preview?: Array<{ key: string; fields: Record<string, JsonValue> }>;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key] as JsonValue)}`).join(",")}}`;
  return JSON.stringify(value);
}

// Accepts n8n item lists ({ json: {...} }), plain objects, arrays, { records | items | data | leads: [...] }
// and Meta Lead Ads webhook notifications ({ object, entry: [{ changes: [{ value }] }] }).
export function extractItems(body: JsonValue): JsonValue[] {
  let items: JsonValue[];
  if (Array.isArray(body)) items = body;
  else if (isObject(body)) {
    const wrapped = ["records", "items", "data", "leads", "entries"].map((key) => body[key]).find(Array.isArray);
    if (wrapped) items = wrapped;
    else if (Array.isArray(body.entry) && typeof body.object === "string") {
      items = [];
      for (const entry of body.entry) {
        if (!isObject(entry) || !Array.isArray(entry.changes)) continue;
        for (const change of entry.changes) {
          if (isObject(change) && isObject(change.value)) items.push({ ...change.value, field: change.field ?? null, object: body.object });
        }
      }
    } else items = [body];
  } else items = [body];
  return items.map((item) => (isObject(item) && isObject(item.json) ? item.json : item));
}

function firstScalar(item: JsonObject, keys: string[]): string | number | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function toIsoTime(value: string | number | null): string | undefined {
  if (value === null) return undefined;
  // Meta sends unix seconds; JavaScript timestamps are milliseconds.
  const date = typeof value === "number" ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function toSourceRecord(item: JsonValue, sourceHint: string | null, fetchedAt: string): SourceRecord {
  if (!isObject(item)) throw new Error("Each record must be a JSON object");
  const declaredSource = typeof item.source === "string" ? item.source.trim() : "";
  const source = sourceHint ?? (SOURCE_PATTERN.test(declaredSource) ? declaredSource : "n8n");
  const id = firstScalar(item, ID_FIELDS);
  // Without a source id, a content hash keeps n8n retries idempotent.
  const externalId = id !== null ? String(id) : `h-${createHash("sha256").update(stableJson(item)).digest("hex").slice(0, 20)}`;
  const record: SourceRecord = { source, externalId, fetchedAt, payload: item };
  const updated = toIsoTime(firstScalar(item, UPDATED_FIELDS));
  if (updated) record.sourceUpdatedAt = updated;
  const url = firstScalar(item, URL_FIELDS);
  if (typeof url === "string" && /^https?:\/\//i.test(url)) record.sourceUrl = url;
  return record;
}

// Columns shown in the sheet: Meta field_data is flattened to one column per form field.
export function displayFields(payload: JsonValue): Record<string, JsonValue> {
  const fields: Record<string, JsonValue> = {};
  if (!isObject(payload)) return fields;
  for (const [key, value] of Object.entries(payload)) {
    if (key === "field_data" && Array.isArray(value)) {
      for (const entry of value) {
        if (!isObject(entry) || typeof entry.name !== "string") continue;
        fields[entry.name] = Array.isArray(entry.values) ? entry.values.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ") : entry.values ?? null;
      }
      continue;
    }
    if (key === "source") continue;
    fields[key] = value;
  }
  return fields;
}

function columnName(r: number, c: number): string {
  return `${r}:${c}`;
}

function createWebhookDocument(): SheetDocument {
  const sheet: SheetTab = { id: "leads", name: WEBHOOK_SHEET_NAME, rows: 200, cols: 26, cells: {}, colW: { 0: 150, 3: 160 }, rowH: {}, freezeRows: 1, freezeCols: 0, merges: [], filter: null, gridlines: true };
  return { id: WEBHOOK_DOCUMENT_ID, title: "Webhook leads", starred: false, sheets: [sheet], active: 0 };
}

const HEADER_STYLE = { b: true, bg: "#0f9d58", color: "#ffffff" };

// Header lookup is by name in row 1, so people can reorder, sort, or add columns in the editor.
function headerIndex(sheet: SheetTab): Map<string, number> {
  const headers = new Map<string, number>();
  for (let c = 0; c < sheet.cols; c++) {
    const raw = sheet.cells[columnName(0, c)]?.v;
    // Headers are stored with the "'" text prefix when they look like numbers or formulas.
    const text = raw?.startsWith("'") ? raw.slice(1) : raw;
    if (text && !headers.has(text)) headers.set(text, c);
  }
  return headers;
}

// Payload fields named like a fixed column (e.g. "Key") get their own column instead of
// overwriting the de-duplication key.
function fieldColumnName(name: string): string {
  const reserved = (FIXED_COLUMNS as readonly string[]).some((fixed) => fixed.toLowerCase() === name.trim().toLowerCase());
  return reserved ? `field: ${name}` : name;
}

function ensureColumn(sheet: SheetTab, headers: Map<string, number>, name: string): number | null {
  const existing = headers.get(name);
  if (existing !== undefined) return existing;
  if (headers.size >= FIXED_COLUMNS.length + MAX_FIELD_COLUMNS) return null;
  let c = 0;
  while (sheet.cells[columnName(0, c)]?.v) c++;
  if (c >= sheet.cols) sheet.cols = c + 10;
  sheet.cells[columnName(0, c)] = { v: literalCellText(name), s: { ...HEADER_STYLE } };
  headers.set(name, c);
  return c;
}

function setCell(sheet: SheetTab, r: number, c: number, value: JsonValue): void {
  const key = columnName(r, c);
  const text = literalCellText(value);
  const existing = sheet.cells[key];
  if (text === "") {
    if (existing) existing.v = "";
    return;
  }
  sheet.cells[key] = existing ? { ...existing, v: text } : { v: text };
}

function appendRow(sheet: SheetTab, values: Record<string, JsonValue>, columns: readonly string[]): void {
  const headers = headerIndex(sheet);
  for (const name of columns) ensureColumn(sheet, headers, name);
  let lastRow = 0;
  for (const cellKey of Object.keys(sheet.cells)) {
    const r = Number(cellKey.slice(0, cellKey.indexOf(":")));
    if (r > lastRow && sheet.cells[cellKey]!.v !== "") lastRow = r;
  }
  const row = lastRow + 1;
  if (row >= sheet.rows) sheet.rows = row + 100;
  for (const [name, value] of Object.entries(values)) {
    const c = headers.get(name);
    if (c !== undefined) setCell(sheet, row, c, value);
  }
}

// Keeps a log sheet bounded: once it passes `max` rows, the oldest rows are dropped.
function trimLog(sheet: SheetTab, max: number): void {
  let lastRow = 0;
  for (const cellKey of Object.keys(sheet.cells)) {
    const r = Number(cellKey.slice(0, cellKey.indexOf(":")));
    if (r > lastRow) lastRow = r;
  }
  if (lastRow <= max) return;
  const drop = lastRow - max + Math.floor(max / 10);
  const cells: SheetTab["cells"] = {};
  for (const [cellKey, cell] of Object.entries(sheet.cells)) {
    const i = cellKey.indexOf(":");
    const r = Number(cellKey.slice(0, i));
    if (r === 0) cells[cellKey] = cell;
    else if (r > drop) cells[`${r - drop}:${cellKey.slice(i + 1)}`] = cell;
  }
  sheet.cells = cells;
}

function namedSheet(doc: SheetDocument, name: string, freezeRows = 1): SheetTab {
  let sheet = doc.sheets.find((s) => s.name === name);
  if (!sheet) {
    sheet = { id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`, name, rows: 200, cols: 26, cells: {}, colW: { 0: 150 }, rowH: {}, freezeRows, freezeCols: 0, merges: [], filter: null, gridlines: true };
    doc.sheets.push(sheet);
  }
  return sheet;
}

// Lead sheets are "Leads", "Leads 2", "Leads 3", ...; a new one starts when the last is full.
function leadSheets(doc: SheetDocument): SheetTab[] {
  const sheets = doc.sheets.filter((s) => /^Leads(?: (\d+))?$/.test(s.name));
  sheets.sort((a, b) => Number(a.name.slice(6) || 1) - Number(b.name.slice(6) || 1));
  if (!sheets.length) {
    const first = createWebhookDocument().sheets[0]!;
    first.id = `leads-${Date.now().toString(36)}`;
    doc.sheets.unshift(first);
    sheets.push(first);
  }
  return sheets;
}

function lastUsedRow(sheet: SheetTab): number {
  let lastRow = 0;
  for (const cellKey of Object.keys(sheet.cells)) {
    const r = Number(cellKey.slice(0, cellKey.indexOf(":")));
    if (r > lastRow && sheet.cells[cellKey]!.v !== "") lastRow = r;
  }
  return lastRow;
}

function appendLeads(doc: SheetDocument, records: Array<{ normalized: NormalizedRecord; payload: JsonValue }>, receivedAt: string, maxRows: number): { added: number; updated: number; sheet: string } {
  const sheets = leadSheets(doc);
  const rowByKey = new Map<string, { sheet: SheetTab; row: number }>();
  for (const sheet of sheets) {
    const headers = headerIndex(sheet);
    const keyCol = headers.get("Key");
    if (keyCol === undefined) continue;
    for (const cellKey of Object.keys(sheet.cells)) {
      const i = cellKey.indexOf(":");
      if (Number(cellKey.slice(i + 1)) !== keyCol) continue;
      const r = Number(cellKey.slice(0, i));
      const value = sheet.cells[cellKey]!.v;
      if (r > 0 && value) rowByKey.set(value.replace(/^'/, ""), { sheet, row: r });
    }
  }
  let target = sheets[sheets.length - 1]!;
  // New rows go below the last non-empty row, so rows people typed are never overwritten.
  let lastRow = lastUsedRow(target);
  let added = 0;
  let updated = 0;
  for (const { normalized: record, payload } of records) {
    let place = rowByKey.get(record.canonicalKey);
    if (!place) {
      if (lastRow >= maxRows) {
        target = namedSheet(doc, `Leads ${sheets.length + 1}`);
        target.colW = { 0: 150, 3: 160 };
        sheets.push(target);
        lastRow = 0;
      }
      place = { sheet: target, row: ++lastRow };
      rowByKey.set(record.canonicalKey, place);
      added++;
    } else updated++;
    const { sheet, row } = place;
    const headers = headerIndex(sheet);
    for (const name of FIXED_COLUMNS) ensureColumn(sheet, headers, name);
    if (row >= sheet.rows) sheet.rows = row + 100;
    setCell(sheet, row, headers.get("Received at")!, receivedAt);
    setCell(sheet, row, headers.get("Source")!, record.source);
    setCell(sheet, row, headers.get("External ID")!, record.externalId);
    setCell(sheet, row, headers.get("Key")!, record.canonicalKey);
    // The original payload (not the key-sorted rawPayload) keeps columns in the order the sender used.
    for (const [name, value] of Object.entries(displayFields(payload))) {
      const c = ensureColumn(sheet, headers, fieldColumnName(name));
      if (c !== null) setCell(sheet, row, c, value);
    }
  }
  return { added, updated, sheet: target.name };
}

const RUN_COLUMNS = ["Time", "Source", "Received", "Accepted", "Failed", "Added", "Updated", "Grist"] as const;
const ERROR_COLUMNS = ["Time", "Source", "Record", "Error"] as const;
const LOG_MAX_ROWS = 5000;

class ArrayAdapter implements SourceAdapter {
  public constructor(public readonly name: string, private readonly records: SourceRecord[]) {}
  public async *collect(): AsyncIterable<SourceRecord> {
    yield* this.records;
  }
}

export async function ingestWebhook(body: JsonValue, sourceHint: string | null, options: WebhookIngestOptions): Promise<WebhookIngestResult> {
  if (sourceHint !== null && !SOURCE_PATTERN.test(sourceHint)) throw new Error("Invalid source name in the webhook URL");
  const now = (options.now ?? (() => new Date()))();
  const fetchedAt = now.toISOString();
  const items = extractItems(body);
  if (items.length > MAX_RECORDS_PER_REQUEST) throw new Error(`At most ${MAX_RECORDS_PER_REQUEST} records per request`);

  const sourceRecords: SourceRecord[] = [];
  const normalized: Array<{ normalized: NormalizedRecord; payload: JsonValue }> = [];
  const errors: Array<{ index: number; message: string }> = [];
  items.forEach((item, index) => {
    try {
      const record = toSourceRecord(item, sourceHint, fetchedAt);
      normalized.push({ normalized: normalizeRecord(record), payload: record.payload });
      sourceRecords.push(record);
    } catch (error) {
      errors.push({ index, message: error instanceof Error ? error.message : String(error) });
    }
  });
  const errorTexts = errors.map((e) => `record ${e.index}: ${e.message}`);

  if (options.dryRun) {
    return {
      received: items.length,
      accepted: normalized.length,
      failed: errors.length,
      errors: errorTexts.slice(0, 20),
      sheet: { documentId: WEBHOOK_DOCUMENT_ID, added: 0, updated: 0 },
      grist: { status: "skipped", written: 0, reason: "Dry run" },
      dryRun: true,
      preview: normalized.slice(0, 20).map(({ normalized: n, payload }) => ({ key: n.canonicalKey, fields: displayFields(payload) })),
    };
  }

  let grist: WebhookIngestResult["grist"];
  if (!options.grist) grist = { status: "skipped", written: 0, reason: "Grist forwarding is not configured" };
  else if (!sourceRecords.length) grist = { status: "skipped", written: 0, reason: "No valid records" };
  else {
    const summary = await runPipeline(new ArrayAdapter(sourceHint ?? "webhook", sourceRecords), options.grist.writer, {
      tableId: options.grist.tableId,
      keyColumns: ["CanonicalKey"],
      batchSize: options.grist.batchSize,
      maxRetries: options.grist.maxRetries,
      retryBaseDelayMs: options.grist.retryBaseDelayMs,
      dryRun: false,
    });
    grist = summary.written === summary.normalized
      ? { status: "written", written: summary.written }
      : { status: "failed", written: summary.written, reason: "Grist rejected or did not answer for some records; see gateway logs" };
  }

  const receivedAt = fetchedAt.replace("T", " ").slice(0, 19);
  const source = sourceHint ?? (normalized[0]?.normalized.source ?? "n8n");
  let sheet = { added: 0, updated: 0 };
  // Every call is recorded in "Sync runs" (and failures in "Sync errors"), even when nothing was accepted.
  await options.store.update(WEBHOOK_DOCUMENT_ID, createWebhookDocument, (doc) => {
    if (normalized.length) {
      const result = appendLeads(doc, normalized, receivedAt, options.maxRowsPerSheet ?? DEFAULT_MAX_ROWS_PER_SHEET);
      sheet = { added: result.added, updated: result.updated };
    }
    const runs = namedSheet(doc, "Sync runs");
    appendRow(runs, { Time: receivedAt, Source: source, Received: items.length, Accepted: normalized.length, Failed: errors.length, Added: sheet.added, Updated: sheet.updated, Grist: grist.status }, RUN_COLUMNS);
    trimLog(runs, LOG_MAX_ROWS);
    if (errors.length || grist.status === "failed") {
      const errorSheet = namedSheet(doc, "Sync errors");
      for (const e of errors.slice(0, 100)) appendRow(errorSheet, { Time: receivedAt, Source: source, Record: e.index, Error: e.message }, ERROR_COLUMNS);
      if (grist.status === "failed") appendRow(errorSheet, { Time: receivedAt, Source: source, Record: "all", Error: grist.reason ?? "Grist forwarding failed" }, ERROR_COLUMNS);
      trimLog(errorSheet, LOG_MAX_ROWS);
    }
  }, options.user);

  return {
    received: items.length,
    accepted: normalized.length,
    failed: errors.length,
    errors: errorTexts.slice(0, 20),
    sheet: { documentId: WEBHOOK_DOCUMENT_ID, ...sheet },
    grist,
  };
}
