import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { literalCellText, SheetStore } from "../src/sheet-store.js";
import type { GristWriter, JsonValue } from "../src/types.js";
import { displayFields, extractItems, ingestWebhook, toSourceRecord, WEBHOOK_DOCUMENT_ID } from "../src/webhook.js";

async function withStore(run: (store: SheetStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sheet-store-"));
  try {
    await run(new SheetStore(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function headerRow(cells: Record<string, { v: string }>): string[] {
  const headers: string[] = [];
  for (let c = 0; cells[`0:${c}`]?.v; c++) headers.push(cells[`0:${c}`]!.v);
  return headers;
}

test("extracts records from n8n items, wrappers, and Meta lead notifications", () => {
  assert.deepEqual(extractItems([{ json: { id: 1 } }, { json: { id: 2 } }]), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(extractItems({ records: [{ id: "a" }] }), [{ id: "a" }]);
  assert.deepEqual(extractItems({ id: "single" }), [{ id: "single" }]);
  const meta = extractItems({
    object: "page",
    entry: [{ id: "page-1", changes: [{ field: "leadgen", value: { leadgen_id: "L1", form_id: "F1", created_time: 1700000000 } }] }],
  });
  assert.equal(meta.length, 1);
  assert.equal((meta[0] as { leadgen_id: string }).leadgen_id, "L1");
});

test("builds source records with stable ids and Meta timestamps", () => {
  const withId = toSourceRecord({ leadgen_id: "L1", created_time: 1700000000 }, "meta", "2026-01-01T00:00:00.000Z");
  assert.equal(withId.source, "meta");
  assert.equal(withId.externalId, "L1");
  assert.equal(withId.sourceUpdatedAt, "2023-11-14T22:13:20.000Z");
  const a = toSourceRecord({ name: "Ali", phone: "+92300" }, null, "2026-01-01T00:00:00.000Z");
  const b = toSourceRecord({ phone: "+92300", name: "Ali" }, null, "2026-01-02T00:00:00.000Z");
  assert.equal(a.source, "n8n");
  assert.equal(a.externalId, b.externalId, "content-hash ids ignore key order so retries deduplicate");
  assert.throws(() => toSourceRecord("not an object" as JsonValue, null, "2026-01-01T00:00:00.000Z"), /JSON object/);
});

test("flattens Meta field_data into one column per form field", () => {
  assert.deepEqual(displayFields({ leadgen_id: "L1", field_data: [{ name: "full_name", values: ["Sara"] }, { name: "phone_number", values: ["+923001234567"] }] }), {
    leadgen_id: "L1",
    full_name: "Sara",
    phone_number: "+923001234567",
  });
});

test("stores incoming text literally so it cannot run as a formula or lose digits", () => {
  assert.equal(literalCellText("=HYPERLINK(\"http://x\")"), "'=HYPERLINK(\"http://x\")");
  assert.equal(literalCellText("+923001234567"), "'+923001234567");
  assert.equal(literalCellText("00123"), "'00123");
  assert.equal(literalCellText("Sara"), "Sara");
  assert.equal(literalCellText(42), "42");
  assert.equal(literalCellText({ a: 1 }), "{\"a\":1}");
});

test("appends webhook records to the leads sheet and updates duplicates in place", async () => {
  await withStore(async (store) => {
    const options = { store, grist: null, now: () => new Date("2026-11-02T10:00:00Z") };
    const first = await ingestWebhook([{ json: { id: "1", name: "Ali", phone: "+923001112233" } }, { json: { id: "2", name: "Sara", city: "Lahore" } }], "n8n", options);
    assert.equal(first.accepted, 2);
    assert.deepEqual(first.sheet, { documentId: WEBHOOK_DOCUMENT_ID, added: 2, updated: 0 });
    assert.equal(first.grist.status, "skipped");

    const again = await ingestWebhook({ id: "1", name: "Ali Khan" }, "n8n", options);
    assert.deepEqual(again.sheet, { documentId: WEBHOOK_DOCUMENT_ID, added: 0, updated: 1 });

    const stored = await store.get(WEBHOOK_DOCUMENT_ID);
    assert.ok(stored);
    assert.equal(stored.version, 2);
    const cells = stored.doc.sheets[0]!.cells;
    const headers = headerRow(cells);
    assert.deepEqual(headers.slice(0, 4), ["Received at", "Source", "External ID", "Key"]);
    const nameCol = headers.indexOf("name");
    const phoneCol = headers.indexOf("phone");
    const cityCol = headers.indexOf("city");
    assert.ok(nameCol > 3 && phoneCol > 3 && cityCol > 3);
    assert.equal(cells[`1:${nameCol}`]!.v, "Ali Khan");
    assert.equal(cells[`1:${phoneCol}`]!.v, "'+923001112233");
    assert.equal(cells[`2:${cityCol}`]!.v, "Lahore");
    assert.equal(cells["3:3"], undefined, "the duplicate did not add a third row");
  });
});

test("forwards webhook records to Grist when configured and reports failures", async () => {
  await withStore(async (store) => {
    const calls: Array<ReadonlyArray<Record<string, JsonValue>>> = [];
    const writer: GristWriter = {
      async upsert(_tableId, records) {
        calls.push(records);
        return {};
      },
    };
    const grist = { writer, tableId: "Leads", batchSize: 100, maxRetries: 0, retryBaseDelayMs: 1 };
    const ok = await ingestWebhook([{ id: "9", name: "Hina" }], "meta", { store, grist });
    assert.equal(ok.grist.status, "written");
    assert.equal(ok.grist.written, 1);
    assert.equal(calls[0]![0]!.CanonicalKey, "meta:9");

    const failing: GristWriter = { async upsert() { throw new Error("Grist down"); } };
    const failed = await ingestWebhook([{ id: "10" }], "meta", { store, grist: { ...grist, writer: failing } });
    assert.equal(failed.grist.status, "failed");
    assert.equal(failed.sheet.added, 1, "the sheet still receives the record when Grist fails");
  });
});

test("keeps one column per field, protects the Key column, and never overwrites typed rows", async () => {
  await withStore(async (store) => {
    const options = { store, grist: null };
    await ingestWebhook({ id: "1", "123": "numeric header", Key: "spoof" }, "n8n", options);
    await store.update(WEBHOOK_DOCUMENT_ID, () => { throw new Error("exists"); }, (doc) => {
      doc.sheets[0]!.cells["5:0"] = { v: "typed by a person" };
    });
    await ingestWebhook({ id: "2", "123": "again", Key: "spoof 2" }, "n8n", options);

    const cells = (await store.get(WEBHOOK_DOCUMENT_ID))!.doc.sheets[0]!.cells;
    const headers = headerRow(cells);
    assert.equal(headers.filter((h) => h === "'123").length, 1, "a numeric-looking header is reused, not duplicated");
    assert.ok(headers.includes("field: Key"));
    const keyCol = headers.indexOf("Key");
    assert.equal(cells[`1:${keyCol}`]!.v, "n8n:1");
    assert.equal(cells["5:0"]!.v, "typed by a person");
    assert.equal(cells[`6:${keyCol}`]!.v, "n8n:2", "the new record goes below the typed row");
  });
});

test("starts a new Leads sheet when the current one is full and still de-duplicates across sheets", async () => {
  await withStore(async (store) => {
    const options = { store, grist: null, maxRowsPerSheet: 2 };
    await ingestWebhook([{ id: "a" }, { id: "b" }, { id: "c" }], "n8n", options);
    const again = await ingestWebhook([{ id: "a", note: "updated" }, { id: "d" }], "n8n", options);
    assert.deepEqual(again.sheet, { documentId: WEBHOOK_DOCUMENT_ID, added: 1, updated: 1 });
    const doc = (await store.get(WEBHOOK_DOCUMENT_ID))!.doc;
    assert.deepEqual(doc.sheets.map((s) => s.name), ["Leads", "Leads 2", "Sync runs"]);
    const keysIn = (name: string) => Object.entries(doc.sheets.find((s) => s.name === name)!.cells).filter(([k]) => k.endsWith(":3") && k !== "0:3").map(([, c]) => c.v);
    assert.deepEqual(keysIn("Leads"), ["n8n:a", "n8n:b"]);
    assert.deepEqual(keysIn("Leads 2"), ["n8n:c", "n8n:d"]);
  });
});

test("dry runs validate without writing", async () => {
  await withStore(async (store) => {
    const result = await ingestWebhook([{ id: "x", name: "Preview" }, "bad"], "n8n", { store, grist: null, dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.preview![0]!.key, "n8n:x");
    assert.equal(result.failed, 1);
    assert.equal(await store.get(WEBHOOK_DOCUMENT_ID), null);
  });
});

test("rejects invalid source names and counts bad records", async () => {
  await withStore(async (store) => {
    await assert.rejects(() => ingestWebhook({ id: "1" }, "../etc", { store, grist: null }), /Invalid source/);
    const result = await ingestWebhook([{ id: "1" }, "oops", 5], null, { store, grist: null });
    assert.equal(result.accepted, 1);
    assert.equal(result.failed, 2);
  });
});
