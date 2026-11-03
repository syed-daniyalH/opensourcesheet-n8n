import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// Runs the real editor script (src/assets/sheet/sheet.js) in jsdom against a fake gateway API.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "sheet");
const html = readFileSync(resolve(root, "editor.html"), "utf8").replace(/<script src="[^"]+"><\/script>/, "");
const script = readFileSync(resolve(root, "sheet.js"), "utf8");

type Api = { status: number; body?: unknown };
type Handler = (method: string, path: string, body: unknown) => Api | undefined;

// The editor polls the server on a timer; closing each window lets the test process exit.
const openWindows: Array<{ close(): void }> = [];
test.after(() => {
  for (const w of openWindows) w.close();
});

interface Editor {
  window: JSDOM["window"];
  sheet: any;
  puts: Array<{ path: string; body: any }>;
}

async function openEditor(url: string, handler: Handler = () => undefined): Promise<Editor> {
  const dom = new JSDOM(html, { url: `http://localhost${url}`, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  openWindows.push(window);
  const puts: Array<{ path: string; body: any }> = [];
  const w = window as any;
  w.HTMLElement.prototype.scrollTo = () => {};
  w.confirm = () => true;
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  w.Response = Response;
  w.fetch = async (path: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === "PUT") puts.push({ path, body });
    const result = handler(method, path, body) ?? { status: 404 };
    const json = result.body !== undefined;
    return {
      status: result.status,
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? (json ? "application/json" : "text/html") : null) },
      json: async () => result.body,
    };
  };
  window.eval(script);
  for (let i = 0; i < 200; i++) {
    const s = w.__sheet;
    if (s && s.doc && window.document.getElementById("save-state")!.textContent !== "Loading…") break;
    await new Promise((r) => setTimeout(r, 5));
  }
  return { window, sheet: w.__sheet, puts };
}

const value = (e: Editor, r: number, c: number) => {
  const v = e.sheet.cellValue(r, c);
  return v && typeof v === "object" && "code" in v ? v.code : v;
};
// Arrays made inside jsdom have another realm's prototype; compare plain JSON copies.
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const cells = (e: Editor) => e.sheet.doc.sheets[e.sheet.doc.active].cells;

test("evaluates formulas, cross-sheet references, errors, and the added functions", async () => {
  const e = await openEditor("/editor?new=annual-budget");
  const cases: Array<[string, unknown]> = [
    ["=SUM(B2:B7)", 1994], ["=VLOOKUP(\"Rent\",A2:N8,2,FALSE)", -1590], ["=Budget!B2*2", 10000],
    ["=IFERROR(1/0,\"x\")", "x"], ["=1/0", "#DIV/0!"], ["=NOPE(1)", "#NAME?"],
    ["=XLOOKUP(\"Travel\",A2:A7,B2:B7)", -275], ["=XLOOKUP(\"Zzz\",A2:A7,B2:B7,\"none\")", "none"],
    ["=SWITCH(2,1,\"a\",2,\"b\",\"c\")", "b"], ["=CHOOSE(3,\"x\",\"y\",\"z\")", "z"],
    ["=MINIFS(B2:B7,A2:A7,\"<>Income\")", -1590], ["=MAXIFS(B2:B7,A2:A7,\"*i*\")", 5000],
    ["=SUMPRODUCT(B2:B3,C2:C3)", 5000 * 5700 + -1590 * -1500], ["=COUNTUNIQUE(\"a\",\"A\",\"b\",1,1)", 3],
    ["=LARGE(B2:B7,2)", -187], ["=ISEVEN(4)", true], ["=TEXT(EOMONTH(DATE(2026,1,15),1),\"yyyy-mm-dd\")", "2026-02-28"],
    ["=NETWORKDAYS(DATE(2026,11,2),DATE(2026,11,8))", 5], ["=DATEDIF(DATE(2026,1,31),DATE(2026,3,1),\"M\")", 1],
  ];
  for (const [formula, expected] of cases) {
    e.sheet.writeCells([[60, 0, formula]]);
    assert.equal(value(e, 60, 0), expected, formula);
  }
  e.sheet.writeCells([[60, 0, "=A61"]]);
  assert.equal(value(e, 60, 0), "#REF!", "circular references are reported");
});

test("rewrites formulas and moves ranges, dropdowns, and hidden rows on row insert/delete", async () => {
  const e = await openEditor("/editor?new=annual-budget");
  e.sheet.setValidation({ r1: 1, c1: 15, r2: 6, c2: 15, list: ["Yes", "No"], strict: true });
  e.sheet.hideRows(4, 4);
  e.sheet.insertRows(2, 1);
  assert.equal(cells(e)["8:1"].v, "=SUM(B2:B8)");
  const sheet = e.sheet.doc.sheets[0];
  assert.deepEqual([sheet.validation[0].r1, sheet.validation[0].r2], [1, 7]);
  assert.deepEqual(plain(sheet.hiddenRowsList), [5]);
  assert.equal(e.sheet.rowHidden(5), true);
  e.sheet.deleteRows(2, 1);
  assert.equal(cells(e)["7:1"].v, "=SUM(B2:B7)");
  assert.deepEqual([sheet.validation[0].r1, sheet.validation[0].r2], [1, 6]);
  e.sheet.deleteRows(1, 1);
  assert.equal(cells(e)["6:1"].v, "=SUM(B2:B6)");
});

test("shifts relative references on paste and continues number series on fill", async () => {
  const e = await openEditor("/editor?new=blank");
  assert.equal(e.sheet.shiftFormula("=SUM(B2:B7)+$A$1+A$2+Sheet2!C3+\"B2\"", 1, 2), "=SUM(D3:D8)+$A$1+C$2+Sheet2!E4+\"B2\"");
  e.sheet.writeCells([[0, 0, "1"], [1, 0, "3"], [0, 1, "=A1*10"]]);
  e.sheet.fill({ r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 });
  assert.deepEqual([2, 3, 4].map((r) => value(e, r, 0)), [5, 7, 9]);
  e.sheet.fill({ r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 0, c1: 1, r2: 2, c2: 1 });
  assert.equal(cells(e)["2:1"].v, "=A3*10");
  assert.equal(value(e, 2, 1), 50);
});

test("detects typed numbers, percents, currency, and dates", async () => {
  const e = await openEditor("/editor?new=blank");
  e.sheet.writeCells([[0, 0, "12%"], [1, 0, "$1,200.50"], [2, 0, "2026-11-02"], [3, 0, "1,000"]]);
  assert.deepEqual([0, 1, 2, 3].map((r) => cells(e)[`${r}:0`].s.fmt), ["percent", "currency", "date", "number"]);
  assert.equal(value(e, 0, 0), 0.12);
  assert.equal(value(e, 1, 0), 1200.5);
});

test("merges concurrent edits cell by cell and reports same-cell conflicts", async () => {
  const e = await openEditor("/editor?new=blank");
  const base = { id: "d", title: "T", sheets: [{ id: "s", name: "S", rows: 10, cols: 5, cells: { "0:0": { v: "a" }, "1:0": { v: "b" } } }] };
  const local = JSON.parse(JSON.stringify(base));
  local.sheets[0].cells["0:0"] = { v: "mine" };
  local.sheets[0].cells["2:0"] = { v: "new local" };
  const remote = JSON.parse(JSON.stringify(base));
  remote.sheets[0].cells["0:0"] = { v: "theirs" };
  remote.sheets[0].cells["3:0"] = { v: "new remote" };
  const conflicts: string[] = [];
  const merged = e.sheet.mergeDocs(base, local, remote, conflicts);
  const c = merged.sheets[0].cells;
  assert.deepEqual([c["0:0"].v, c["1:0"].v, c["2:0"].v, c["3:0"].v], ["mine", "b", "new local", "new remote"]);
  assert.deepEqual(conflicts, ["S!A1"]);
});

test("enforces dropdown validation and applies conditional formatting", async () => {
  const e = await openEditor("/editor?new=blank");
  e.sheet.setValidation({ r1: 0, c1: 0, r2: 9, c2: 0, list: ["New", "Won"], strict: true });
  e.sheet.writeCells([[0, 0, "Maybe"]]);
  assert.equal(cells(e)["0:0"], undefined, "a value outside the list is rejected");
  e.sheet.writeCells([[0, 0, "won"]]);
  assert.equal(cells(e)["0:0"].v, "won", "matching is case-insensitive");
  assert.ok(e.window.document.querySelector("#grid tr[data-r='0'] .dv-btn"), "validated cells show a dropdown button");

  e.sheet.addCondFormat({ r1: 0, c1: 1, r2: 9, c2: 1, type: "gt", value: "100", bg: "#f4c7c3", color: "#a50e0e" });
  e.sheet.writeCells([[0, 1, "150"], [1, 1, "50"]]);
  assert.ok(e.sheet.condStyle(0, 1, 150));
  assert.equal(e.sheet.condStyle(1, 1, 50), null);
  const td = e.window.document.querySelector("#grid tr[data-r='0']")!.children[2] as HTMLElement;
  assert.match(td.style.cssText, /background-color/);
});

test("hides and unhides columns and skips them when moving", async () => {
  const e = await openEditor("/editor?new=blank");
  e.sheet.hideCols(1, 2);
  assert.equal(e.sheet.isColHidden(1), true);
  assert.match(e.window.document.getElementById("hidden-col-style")!.textContent!, /nth-child\(3\)/);
  e.sheet.insertCols(0, 1);
  assert.deepEqual(plain(e.sheet.doc.sheets[0].hiddenCols), [2, 3]);
});

test("round-trips a workbook through Excel (.xlsx) export and import", async () => {
  const e = await openEditor("/editor?new=annual-budget");
  const files = e.sheet.buildXlsxFiles() as Array<[string, string]>;
  assert.ok(files.some(([name]) => name === "xl/worksheets/sheet1.xml"));
  const sheetXml = files.find(([name]) => name === "xl/worksheets/sheet1.xml")![1];
  assert.match(sheetXml, /<f>SUM\(B2:M2\)<\/f>/);
  assert.match(sheetXml, /state="frozen"/);
  const bytes = e.sheet.zipBytes(files) as Uint8Array;
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50, "a zip local file header");
  await e.sheet.importXlsxBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "budget.xlsx");
  const imported = e.sheet.doc.sheets[e.sheet.doc.active];
  assert.notEqual(imported.name, "Budget");
  assert.equal(imported.cells["0:0"].v, "Category");
  assert.equal(imported.cells["1:13"].v, "=SUM(B2:M2)");
  assert.equal(value(e, 7, 1), 1994);
});

test("draws charts as SVG from the selected range", async () => {
  const e = await openEditor("/editor?new=annual-budget");
  e.sheet.select(0, 0, 6, 2);
  e.sheet.insertChart("bar");
  const chart = e.sheet.doc.sheets[0].charts[0];
  assert.deepEqual([chart.range.r1, chart.range.c2], [0, 2]);
  const svg = e.sheet.renderChartSvg(chart) as string;
  assert.equal((svg.match(/<rect /g) ?? []).length >= 12, true, "two series × six rows of bars plus legend");
  assert.match(svg, /Jan/);
  assert.ok(e.window.document.querySelector(".chart svg rect"));
  const pie = e.sheet.renderChartSvg({ ...chart, type: "pie" }) as string;
  assert.match(pie, /<path /);
});

test("viewers get a read-only editor and their edits are refused locally", async () => {
  const doc = { id: "doc-view", title: "Shared", sheets: [{ id: "s", name: "S", rows: 20, cols: 5, cells: { "0:0": { v: "keep" } } }], active: 0 };
  const e = await openEditor("/editor?id=doc-view", (method, path) => {
    if (path === "/api/me") return { status: 200, body: { username: "vic", role: "viewer" } };
    if (path === "/api/sheets/doc-view" && method === "GET") return { status: 200, body: { version: 3, updatedAt: "2026-11-03T00:00:00Z", doc } };
    return undefined;
  });
  assert.equal(e.sheet.me.role, "viewer");
  assert.ok(e.window.document.body.classList.contains("read-only"));
  e.sheet.writeCells([[0, 0, "changed"]]);
  assert.equal(cells(e)["0:0"].v, "keep");
  assert.equal(e.puts.length, 0, "nothing is sent to the server");
});

test("shared documents cannot inject markup, scripts, or external CSS", async () => {
  const doc = {
    id: "doc-evil", title: "<img src=x onerror=alert(1)>", active: 0,
    sheets: [{
      id: "s", name: "<b>tab</b>", rows: 20, cols: 5,
      colW: { 0: "100px\"><img src=x onerror=alert(1)>" }, rowH: { 1: "30\"><script>alert(1)</script>" },
      cells: {
        "0:0": { v: "<script>alert(1)</script>", s: { color: "red;background:url(https://tracker.example/x)", bg: "#fff;background-image:url(//x)", font: "x';background:url(//y)", ha: "left;position:fixed" } },
        "1:0": { v: "click", s: { link: "javascript:alert(1)" } },
      },
    }],
  };
  const e = await openEditor("/editor?id=doc-evil", (method, path) => {
    if (path === "/api/me") return { status: 200, body: { username: "a", role: "editor" } };
    if (path === "/api/sheets/doc-evil" && method === "GET") return { status: 200, body: { version: 1, updatedAt: "2026-11-03T00:00:00Z", doc } };
    if (method === "PUT") return { status: 200, body: { version: 2 } };
    return undefined;
  });
  const grid = e.window.document.getElementById("grid")!;
  assert.equal(grid.querySelector("img, script"), null);
  assert.equal(e.window.document.querySelector("#tabs b"), null);
  assert.equal(grid.innerHTML.includes("url("), false);
  assert.equal(grid.innerHTML.includes("position:fixed"), false);
  assert.equal(grid.querySelector("tr[data-r='0'] td")!.textContent, "<script>alert(1)</script>");
});

test("keeps working against the browser copy when there is no server", async () => {
  const e = await openEditor("/editor?new=todo");
  assert.equal(e.sheet.server.available, false);
  assert.equal(e.window.document.getElementById("save-state")!.textContent, "Saved to this browser");
  e.sheet.writeCells([[10, 1, "Offline task"]]);
  const saved = JSON.parse(e.window.localStorage.getItem("aureum-sheet:doc:" + e.sheet.doc.id)!);
  await new Promise((r) => setTimeout(r, 400));
  const later = JSON.parse(e.window.localStorage.getItem("aureum-sheet:doc:" + e.sheet.doc.id)!);
  assert.ok(saved && later.sheets[0].cells["10:1"].v === "Offline task");
});

test("array formulas spill into neighbouring cells and report blocked spills", async () => {
  const e = await openEditor("/editor?new=annual-budget");
  e.sheet.writeCells([[20, 0, "=FILTER(A2:B7,B2:B7<-500)"]]);
  assert.deepEqual([[20, 0], [20, 1], [21, 0], [21, 1], [22, 0]].map(([r, c]) => value(e, r, c)), ["Rent", -1590, "Marketing", -708, null]);
  assert.equal(e.window.document.querySelector("#grid tr[data-r='21']")!.children[1]!.textContent, "Marketing", "spilled values are drawn");
  e.sheet.writeCells([[21, 1, "blocker"]]);
  assert.equal(value(e, 20, 0), "#REF!", "a non-empty cell blocks the spill");
  e.sheet.writeCells([[21, 1, ""]]);
  assert.equal(value(e, 20, 0), "Rent");
  e.sheet.writeCells([[30, 0, "=SORT(B2:B7,1,FALSE)"], [30, 2, "=SEQUENCE(2,3,10,5)"], [40, 0, "=UNIQUE(TRANSPOSE(SEQUENCE(1,3)))"], [45, 0, "=SUM(B2:B7*C2:C7)"], [46, 0, "=B2:B4*2"]]);
  assert.deepEqual([30, 31, 35].map((r) => value(e, r, 0)), [5000, -187, -1590]);
  assert.deepEqual([value(e, 30, 2), value(e, 30, 4), value(e, 31, 2), value(e, 31, 4)], [10, 20, 25, 35]);
  assert.deepEqual([40, 41, 42].map((r) => value(e, r, 0)), [1, 2, 3]);
  const expected = [[5000, 5700], [-1590, -1500], [-246, -233], [-708, -672], [-187, -212], [-275, -260]].reduce((s, [b, c]) => s + b! * c!, 0);
  assert.equal(value(e, 45, 0), expected, "array maths inside SUM");
  assert.deepEqual([46, 47, 48].map((r) => value(e, r, 0)), [10000, -3180, -492]);
  e.sheet.writeCells([[46, 0, "=FILTER(A2:A7,B2:B7>99999)"]]);
  assert.equal(value(e, 46, 0), "#N/A");
});

test("PIVOT builds a live summary table", async () => {
  const e = await openEditor("/editor?new=blank");
  const rows = [["Region", "Rep", "Amount"], ["North", "Ali", "100"], ["South", "Sara", "50"], ["North", "Sara", "25"], ["South", "Ali", "75"], ["North", "Ali", "10"]];
  e.sheet.writeCells(rows.flatMap((row, r) => row.map((v, c) => [r, c, v])));
  e.sheet.writeCells([[0, 5, "=PIVOT(A1:C6,\"Region\",\"Amount\",\"SUM\")"]]);
  assert.deepEqual([[0, 5], [0, 6], [1, 5], [1, 6], [2, 5], [2, 6], [3, 5], [3, 6]].map(([r, c]) => value(e, r, c)), ["Region", "SUM of Amount", "North", 135, "South", 125, "Grand total", 260]);
  e.sheet.writeCells([[1, 2, "1000"]]);
  assert.equal(value(e, 1, 6), 1035, "the pivot recalculates when the data changes");
  e.sheet.writeCells([[10, 0, "=PIVOT(A1:C6,1,3,\"COUNT\",\"Rep\")"]]);
  assert.deepEqual([value(e, 10, 1), value(e, 10, 2), value(e, 11, 1), value(e, 11, 3), value(e, 13, 3)], ["Ali", "Sara", 2, 3, 5]);
  e.sheet.writeCells([[20, 0, "=PIVOT(A1:C6,\"Nope\",\"Amount\")"]]);
  assert.equal(value(e, 20, 0), "#VALUE!");
});

test("protected ranges block edits locally for people who are not allowed", async () => {
  const e = await openEditor("/editor?new=annual-budget");
  e.sheet.setMe({ username: "ali", role: "editor" });
  e.sheet.addProtection({ id: "p1", r1: 1, c1: 1, r2: 6, c2: 12, owner: "sara", editors: [] });
  e.sheet.writeCells([[1, 1, "1"]]);
  assert.equal(cells(e)["1:1"].v, "5000", "the protected cell kept its value");
  assert.equal(e.sheet.isLocked(1, 1), true);
  assert.ok(e.window.document.querySelector("#grid tr[data-r='1'] td.locked"));
  e.sheet.writeCells([[10, 0, "free"]]);
  assert.equal(cells(e)["10:0"].v, "free", "cells outside the range stay editable");
  e.sheet.insertRows(0, 1);
  assert.equal(cells(e)["2:1"].v, "5000", "inserting rows above moves the range instead of being refused");
  e.sheet.setMe({ username: "sara", role: "editor" });
  e.sheet.writeCells([[2, 1, "1"]]);
  assert.equal(cells(e)["2:1"].v, "1", "the owner can edit");
});

test("merging keeps comments others added while we edited", async () => {
  const e = await openEditor("/editor?new=blank");
  const t1 = { id: "t1", author: "vic", at: "x", text: "old", replies: [] };
  const base = { "1:0": [t1] };
  const local = { "2:0": [t1] };
  const remote = { "1:0": [{ ...t1, replies: [{ id: "r1", author: "sara", at: "y", text: "reply" }] }], "5:5": [{ id: "t2", author: "ali", at: "z", text: "new", replies: [] }] };
  const merged = plain(e.sheet.unionComments(base, local, remote));
  assert.deepEqual(Object.keys(merged).sort(), ["2:0", "5:5"]);
  assert.equal(merged["2:0"][0].replies[0].id, "r1");
});

test("QUERY selects, filters, groups, orders, limits, and labels", async () => {
  const e = await openEditor("/editor?new=blank");
  const rows = [["Region", "Rep", "Amount"], ["North", "Ali", "100"], ["South", "Sara", "50"], ["North", "Sara", "25"], ["South", "Ali", "75"], ["North", "Ali", "10"]];
  e.sheet.writeCells(rows.flatMap((row, r) => row.map((v, c) => [r, c + 1, v])));
  const q = (r: number, formula: string) => e.sheet.writeCells([[r, 6, formula]]);
  const block = (r: number, h: number, w: number) => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => value(e, r + i, 6 + j)));
  q(0, "=QUERY(B1:D6,\"select B, sum(D) group by B order by sum(D) desc label sum(D) 'Total'\")");
  assert.deepEqual(plain(block(0, 3, 2)), [["Region", "Total"], ["North", 135], ["South", 125]]);
  q(10, "=QUERY(B1:D6,\"select C, D where B = 'North' and D >= 25 order by D\")");
  assert.deepEqual(plain(block(10, 3, 2)), [["Rep", "Amount"], ["Sara", 25], ["Ali", 100]]);
  q(20, "=QUERY(B1:D6,\"select Col2, count(Col3) where Col2 contains 'i' group by Col2 limit 1\")"); // contains is case-sensitive, as in Sheets
  assert.deepEqual(plain(block(20, 2, 2)), [["Rep", "count Amount"], ["Ali", 3]]);
  q(30, "=QUERY(B2:D6,\"select * where D > 70\",0)");
  assert.deepEqual(plain(block(30, 2, 3)), [["North", "Ali", 100], ["South", "Ali", 75]]);
  q(40, "=QUERY(B1:D6,\"select B, D group by B\")");
  assert.equal(value(e, 40, 6), "#VALUE!", "a non-grouped column outside an aggregate is an error");
  q(41, "=QUERY(B1:D6,\"select B where D > 1000\")");
  assert.equal(value(e, 41, 6), "#N/A");
  q(42, "=QUERY(B1:D6,\"select Z\")");
  assert.equal(value(e, 42, 6), "#VALUE!");
});

test("touch: double-tap edits a cell and a long press opens the context menu", async () => {
  const e = await openEditor("/editor?new=blank");
  const doc = e.window.document;
  const td = () => doc.querySelector("#grid tr[data-r='2']")!.children[2] as HTMLElement;
  const fire = (type: string, x = 10, y = 10) => {
    const ev = new e.window.Event(type, { bubbles: true, cancelable: true }) as Event & { touches: unknown[] };
    const point = { clientX: x, clientY: y, target: td() };
    Object.defineProperty(ev, "touches", { value: type === "touchend" ? [] : [point] });
    td().dispatchEvent(ev);
  };
  fire("touchstart"); fire("touchend");
  fire("touchstart"); fire("touchend");
  const editor = doc.getElementById("cell-editor") as HTMLTextAreaElement;
  assert.equal(editor.style.display, "block", "double-tap opens the cell editor");
  assert.equal(e.sheet.range.r1, 2);
  editor.dispatchEvent(new e.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  fire("touchstart");
  await new Promise((r) => setTimeout(r, 750));
  assert.ok(doc.querySelector(".popup .item"), "a long press shows the context menu");
  fire("touchend");
});