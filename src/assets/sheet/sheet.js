/* Aureum Data Sheet: a self-contained spreadsheet editor (grid, formulas, formatting, sheets). */
(function () {
  "use strict";

  // ---------------------------------------------------------------- helpers
  const $ = (id) => document.getElementById(id);
  const DEFAULT_COL_W = 100;
  const DEFAULT_ROW_H = 21;
  const ROW_HEADER_W = 46;

  function colName(c) {
    let s = "";
    let n = c + 1;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  function colIndex(name) {
    let n = 0;
    for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  const key = (r, c) => r + ":" + c;
  const addr = (r, c) => colName(c) + (r + 1);
  function parseAddr(s) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(s).trim());
    return m ? { r: +m[2] - 1, c: colIndex(m[1]) } : null;
  }
  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }
  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  }
  const isFormula = (v) => typeof v === "string" && v.length > 1 && v[0] === "=";

  // ---------------------------------------------------------------- storage
  const DOC_PREFIX = "aureum-sheet:doc:";
  const INDEX_KEY = "aureum-sheet:index";
  function storageGet(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  }
  function storageSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch { return false; }
  }
  function readIndex() {
    try { return JSON.parse(storageGet(INDEX_KEY) || "[]"); } catch { return []; }
  }
  function writeIndexEntry(d) {
    const idx = readIndex().filter((e) => e.id !== d.id);
    idx.unshift({ id: d.id, title: d.title, starred: !!d.starred, updated: Date.now() });
    storageSet(INDEX_KEY, JSON.stringify(idx.slice(0, 300)));
  }
  function loadDoc(id) {
    try {
      const raw = storageGet(DOC_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  // ---------------------------------------------------------------- model
  function newSheet(name, rows, cols) {
    return { id: uid(), name, rows: rows || 100, cols: cols || 26, cells: {}, colW: {}, rowH: {}, freezeRows: 0, freezeCols: 0, merges: [], filter: null, gridlines: true };
  }
  function newDoc(title) {
    return { id: uid(), title: title || "Untitled spreadsheet", starred: false, sheets: [newSheet("Sheet1")], active: 0 };
  }
  function putRow(sh, r, values, style) {
    values.forEach((v, c) => {
      if (v === null || v === undefined) return;
      const cell = { v: String(v) };
      if (style) cell.s = Object.assign({}, style);
      sh.cells[key(r, c)] = cell;
    });
  }
  function styleRange(sh, r1, c1, r2, c2, style) {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const k = key(r, c);
      const cell = sh.cells[k] || (sh.cells[k] = { v: "" });
      cell.s = Object.assign(cell.s || {}, style);
    }
  }
  const HEADER_STYLE = { b: true, bg: "#0f9d58", color: "#ffffff" };
  const TEMPLATES = {
    blank() { return newDoc("Untitled spreadsheet"); },
    todo() {
      const d = newDoc("To-do list");
      const sh = d.sheets[0];
      sh.name = "Tasks";
      putRow(sh, 0, ["Done", "Task", "Owner", "Due date", "Status", "Notes"], HEADER_STYLE);
      const today = dateToSerial(new Date());
      const rows = [
        ["FALSE", "Review incoming Meta leads", "Ali", today + 1, "In progress", "Check duplicates"],
        ["FALSE", "Update ingestion field mapping", "Sara", today + 3, "Not started", ""],
        ["TRUE", "Set up staging Grist", "Daniyal", today - 2, "Done", "Deployed"],
        ["FALSE", "Weekly report to team", "Ali", today + 5, "Not started", ""],
      ];
      rows.forEach((row, i) => putRow(sh, i + 1, row));
      styleRange(sh, 1, 3, 20, 3, { fmt: "date" });
      styleRange(sh, 1, 0, 20, 0, { ha: "center" });
      Object.assign(sh.colW, { 0: 60, 1: 260, 2: 110, 3: 110, 4: 120, 5: 220 });
      sh.freezeRows = 1;
      return d;
    },
    "annual-budget"() {
      const d = newDoc("Annual budget");
      const sh = d.sheets[0];
      sh.name = "Budget";
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      putRow(sh, 0, ["Category"].concat(months, ["Total"]), HEADER_STYLE);
      const cats = [["Income", 5000], ["Rent", -1500], ["Utilities", -220], ["Marketing", -600], ["Software", -180], ["Travel", -250]];
      cats.forEach(([name, base], i) => {
        const r = i + 1;
        const vals = months.map((_, m) => Math.round(base * (1 + ((m * 7 + i * 3) % 10) / 50)));
        putRow(sh, r, [name].concat(vals, ["=SUM(B" + (r + 1) + ":M" + (r + 1) + ")"]));
      });
      const tr = cats.length + 1;
      putRow(sh, tr, ["Net"].concat(months.map((_, m) => "=SUM(" + colName(m + 1) + "2:" + colName(m + 1) + (tr) + ")"), ["=SUM(N2:N" + tr + ")"]), { b: true, bt: true });
      styleRange(sh, 1, 1, tr, 13, { fmt: "currency", dec: 0 });
      styleRange(sh, 1, 13, tr, 13, { b: true, bg: "#e6f4ea" });
      sh.colW[0] = 130;
      sh.freezeRows = 1;
      sh.freezeCols = 1;
      return d;
    },
    "monthly-budget"() {
      const d = newDoc("Monthly budget");
      const sh = d.sheets[0];
      sh.name = "Summary";
      putRow(sh, 0, ["Item", "Planned", "Actual", "Difference"], HEADER_STYLE);
      const items = [["Salary", 4800, 4800], ["Rent", 1500, 1500], ["Groceries", 450, 512], ["Transport", 160, 140], ["Utilities", 210, 236], ["Savings", 900, 800]];
      items.forEach(([n, p, a], i) => putRow(sh, i + 1, [n, p, a, "=C" + (i + 2) + "-B" + (i + 2)]));
      const tr = items.length + 1;
      putRow(sh, tr, ["Total spending", "=SUM(B3:B" + tr + ")", "=SUM(C3:C" + tr + ")", "=C" + (tr + 1) + "-B" + (tr + 1)], { b: true, bt: true });
      putRow(sh, tr + 2, ["Left over", "=B2-B" + (tr + 1), "=C2-C" + (tr + 1)], { b: true });
      styleRange(sh, 1, 1, tr + 2, 3, { fmt: "currency" });
      sh.colW[0] = 150;
      sh.freezeRows = 1;
      return d;
    },
    "team-tracker"() {
      const d = newDoc("Team tracker");
      const sh = d.sheets[0];
      sh.name = "Team";
      putRow(sh, 0, ["Name", "Role", "Project", "Status", "Progress", "Start", "Due"], { b: true, bg: "#4285f4", color: "#ffffff" });
      const t = dateToSerial(new Date());
      const rows = [
        ["Ali Khan", "Data analyst", "Lead scoring", "On track", 0.6, t - 20, t + 10],
        ["Sara Ahmed", "Engineer", "Meta adapter", "At risk", 0.35, t - 14, t + 4],
        ["Daniyal", "Lead", "Grist rollout", "On track", 0.8, t - 30, t + 2],
        ["Hina", "Designer", "Reporting UI", "Blocked", 0.2, t - 7, t + 21],
      ];
      rows.forEach((row, i) => putRow(sh, i + 1, row));
      styleRange(sh, 1, 4, 20, 4, { fmt: "percent", dec: 0 });
      styleRange(sh, 1, 5, 20, 6, { fmt: "date" });
      putRow(sh, 6, ["Average progress", null, null, null, "=AVERAGE(E2:E5)"], { b: true });
      sh.cells[key(6, 4)].s = { b: true, fmt: "percent", dec: 0 };
      Object.assign(sh.colW, { 0: 140, 1: 120, 2: 140 });
      sh.freezeRows = 1;
      return d;
    },
  };

  // ---------------------------------------------------------------- dates
  const EPOCH = Date.UTC(1899, 11, 30);
  function dateToSerial(d) {
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000);
  }
  function serialToDate(n) {
    return new Date(EPOCH + Math.round(n * 86400000));
  }
  function fmtDate(n) {
    const d = serialToDate(n);
    return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "/" + d.getUTCFullYear();
  }
  function fmtDateTime(n) {
    const d = serialToDate(n);
    const p = (x) => String(x).padStart(2, "0");
    return fmtDate(n) + " " + d.getUTCHours() + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
  }

  // ---------------------------------------------------------------- formula engine
  class FErr {
    constructor(code, msg) { this.code = code; this.msg = msg || ""; }
    toString() { return this.code; }
  }
  const E = {
    div0: () => new FErr("#DIV/0!", "Division by zero."),
    value: (m) => new FErr("#VALUE!", m || "Wrong type of value."),
    ref: (m) => new FErr("#REF!", m || "Reference does not exist."),
    name: (n) => new FErr("#NAME?", "Unknown function: '" + n + "'."),
    na: (m) => new FErr("#N/A", m || "Value not available."),
    num: (m) => new FErr("#NUM!", m || "Invalid number."),
    parse: (m) => new FErr("#ERROR!", m || "Formula parse error."),
  };

  const TOKEN_RES = [
    ["ws", /^\s+/],
    ["err", /^#REF!/],
    ["num", /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/],
    ["str", /^"((?:[^"]|"")*)"/],
    ["ref", /^(?:('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+)(?![A-Za-z0-9_(])/],
    ["cols", /^(?:('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Za-z]{1,3}):(\$?[A-Za-z]{1,3})(?![A-Za-z0-9_(])/],
    ["ident", /^[A-Za-z_][A-Za-z0-9_.]*/],
    ["op", /^(?:<>|<=|>=|[-+*/^&=<>%:,();])/],
  ];
  function unquoteSheet(s) {
    return s && s[0] === "'" ? s.slice(1, -1).replace(/''/g, "'") : s;
  }
  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const rest = src.slice(i);
      let matched = false;
      for (const [type, re] of TOKEN_RES) {
        const m = re.exec(rest);
        if (!m) continue;
        matched = true;
        i += m[0].length;
        if (type === "ws") break;
        if (type === "str") out.push({ t: "str", v: m[1].replace(/""/g, '"') });
        else if (type === "num") out.push({ t: "num", v: parseFloat(m[0]) });
        else if (type === "ref") out.push({ t: "ref", sheet: unquoteSheet(m[1] || null), a: parseAddr(m[2]) });
        else if (type === "cols") out.push({ t: "cols", sheet: unquoteSheet(m[1] || null), c1: colIndex(m[2].replace("$", "")), c2: colIndex(m[3].replace("$", "")) });
        else if (type === "op") out.push({ t: "op", v: m[0] === ";" ? "," : m[0] });
        else out.push({ t: type, v: m[0] });
        break;
      }
      if (!matched) throw E.parse("Unexpected character '" + src[i] + "'.");
    }
    return out;
  }

  function parseFormula(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => toks[p] && toks[p].t === "op" && toks[p].v === v;
    const expect = (v) => {
      if (!isOp(v)) throw E.parse("Expected '" + v + "'.");
      p++;
    };
    function binary(next, ops) {
      return function () {
        let a = next();
        while (toks[p] && toks[p].t === "op" && ops.includes(toks[p].v)) {
          const op = toks[p++].v;
          a = { t: "bin", op, a, b: next() };
        }
        return a;
      };
    }
    function unary() {
      if (isOp("-")) { p++; return { t: "neg", a: unary() }; }
      if (isOp("+")) { p++; return unary(); }
      return postfix();
    }
    function postfix() {
      let a = primary();
      while (isOp("%")) { p++; a = { t: "pct", a }; }
      return a;
    }
    function primary() {
      const tk = peek();
      if (!tk) throw E.parse("Unexpected end of formula.");
      p++;
      if (tk.t === "num") return { t: "lit", v: tk.v };
      if (tk.t === "str") return { t: "lit", v: tk.v };
      if (tk.t === "err") return { t: "err" };
      if (tk.t === "cols") return { t: "range", sheet: tk.sheet, r1: 0, c1: Math.min(tk.c1, tk.c2), r2: -1, c2: Math.max(tk.c1, tk.c2) };
      if (tk.t === "ref") {
        if (isOp(":") && toks[p + 1] && toks[p + 1].t === "ref") {
          p++;
          const b = toks[p++].a;
          return { t: "range", sheet: tk.sheet, r1: Math.min(tk.a.r, b.r), c1: Math.min(tk.a.c, b.c), r2: Math.max(tk.a.r, b.r), c2: Math.max(tk.a.c, b.c) };
        }
        return { t: "ref", sheet: tk.sheet, r: tk.a.r, c: tk.a.c };
      }
      if (tk.t === "ident") {
        const name = tk.v.toUpperCase();
        if (isOp("(")) {
          p++;
          const args = [];
          if (!isOp(")")) {
            for (;;) {
              if (isOp(",") || isOp(")")) args.push({ t: "lit", v: null });
              else args.push(expr());
              if (isOp(",")) { p++; continue; }
              break;
            }
          }
          expect(")");
          return { t: "fn", name, args };
        }
        if (name === "TRUE") return { t: "lit", v: true };
        if (name === "FALSE") return { t: "lit", v: false };
        return { t: "name", v: tk.v };
      }
      if (tk.t === "op" && tk.v === "(") {
        const e = expr();
        expect(")");
        return e;
      }
      throw E.parse("Unexpected '" + (tk.v === undefined ? tk.t : tk.v) + "'.");
    }
    const power = binary(unary, ["^"]);
    const term = binary(power, ["*", "/"]);
    const additive = binary(term, ["+", "-"]);
    const concat = binary(additive, ["&"]);
    const expr = binary(concat, ["=", "<>", "<", ">", "<=", ">="]);
    const tree = expr();
    if (p < toks.length) throw E.parse("Unexpected '" + (toks[p].v === undefined ? toks[p].t : toks[p].v) + "'.");
    return tree;
  }

  const astCache = new Map();
  let valueCache = new Map();
  const evaluating = new Set();
  // Array results (FILTER, SORT, A1:A5*2, PIVOT…) "spill" into the empty cells below/right of the formula.
  let spillValues = new Map(); // "sheetId|r|c" → value shown in a spilled cell
  let spillOwner = new Map(); // same key → key of the formula cell that produced it
  let spillsReady = new Set(); // sheet ids whose array formulas were evaluated in this round
  function invalidate() {
    valueCache = new Map();
    spillValues = new Map();
    spillOwner = new Map();
    spillsReady = new Set();
  }
  const ARRAY_FNS = new Set(["FILTER", "UNIQUE", "SORT", "SEQUENCE", "TRANSPOSE", "ARRAYFORMULA", "PIVOT", "QUERY"]);
  const mayArrayCache = new Map();
  function mayReturnArray(node) {
    switch (node.t) {
      case "range": return true;
      case "fn": return ARRAY_FNS.has(node.name);
      case "bin": return mayReturnArray(node.a) || mayReturnArray(node.b);
      case "neg": case "pct": return mayReturnArray(node.a);
      default: return false;
    }
  }
  // Evaluates every formula on the sheet that can return an array, so empty cells know whether
  // something spills into them.
  function ensureSpills(sh) {
    if (spillsReady.has(sh.id)) return;
    spillsReady.add(sh.id);
    for (const k in sh.cells) {
      const raw = sh.cells[k].v;
      if (!isFormula(raw)) continue;
      let candidate = mayArrayCache.get(raw);
      if (candidate === undefined) {
        try { candidate = mayReturnArray(parseFormula(raw.slice(1))); } catch { candidate = false; }
        mayArrayCache.set(raw, candidate);
      }
      if (!candidate) continue;
      const i = k.indexOf(":");
      const r = +k.slice(0, i), c = +k.slice(i + 1);
      if (evaluating.has(sh.id + "|" + r + "|" + c)) continue;
      safeCellValue(sh, r, c);
    }
  }
  function spillArray(sh, r, c, k, arr) {
    const rows = arr.rows;
    if (!rows.length || !rows[0].length) return null;
    if (rows.length === 1 && rows[0].length === 1) return rows[0][0];
    const h = rows.length, w = Math.max.apply(null, rows.map((row) => row.length));
    if (r + h > sh.rows || c + w > sh.cols) return new FErr("#REF!", "Array result needs " + h + "×" + w + " cells and would extend past the sheet. Add rows or columns.");
    for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
      if (!i && !j) continue;
      const target = sh.cells[key(r + i, c + j)];
      const owner = spillOwner.get(sh.id + "|" + (r + i) + "|" + (c + j));
      if ((target && target.v !== "") || (owner && owner !== k)) return new FErr("#REF!", "Array result was not expanded because it would overwrite data in " + addr(r + i, c + j) + ".");
    }
    for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
      if (!i && !j) continue;
      const kk = sh.id + "|" + (r + i) + "|" + (c + j);
      spillValues.set(kk, rows[i][j] === undefined ? null : rows[i][j]);
      spillOwner.set(kk, k);
    }
    return rows[0][0];
  }

  function sheetByName(name) {
    const n = name.toLowerCase();
    return doc.sheets.find((s) => s.name.toLowerCase() === n);
  }
  function literalValue(raw, s) {
    if (raw === undefined || raw === null || raw === "") return null;
    if (s && s.fmt === "text") return raw;
    if (raw[0] === "'") return raw.slice(1);
    const t = raw.trim();
    if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(t)) return parseFloat(t);
    const up = t.toUpperCase();
    if (up === "TRUE") return true;
    if (up === "FALSE") return false;
    return raw;
  }
  function cellValue(sh, r, c) {
    const k = sh.id + "|" + r + "|" + c;
    if (valueCache.has(k)) return valueCache.get(k);
    const cell = sh.cells[key(r, c)];
    let v;
    if (!cell || cell.v === "" || cell.v == null) {
      ensureSpills(sh);
      v = spillValues.has(k) ? spillValues.get(k) : null;
    } else if (isFormula(cell.v)) {
      if (evaluating.has(k)) throw new FErr("#REF!", "Circular dependency detected.");
      evaluating.add(k);
      try {
        let ast = astCache.get(cell.v);
        if (!ast) {
          ast = parseFormula(cell.v.slice(1));
          astCache.set(cell.v, ast);
        }
        v = evalNode(ast, sh);
        if (v && v.range) v = spillArray(sh, r, c, k, v);
      } catch (e) {
        v = e instanceof FErr ? e : E.parse(e && e.message);
      } finally {
        evaluating.delete(k);
      }
    } else v = literalValue(cell.v, cell.s);
    valueCache.set(k, v);
    return v;
  }
  function safeCellValue(sh, r, c) {
    try { return cellValue(sh, r, c); } catch (e) { return e instanceof FErr ? e : E.parse(); }
  }

  function resolveSheet(name, sh) {
    if (!name) return sh;
    const t = sheetByName(name);
    if (!t) throw E.ref("Unresolved sheet name '" + name + "'.");
    return t;
  }
  function evalNode(n, sh) {
    switch (n.t) {
      case "lit": return n.v;
      case "err": throw E.ref();
      case "name": throw new FErr("#NAME?", "Unknown range name: '" + n.v + "'.");
      case "ref": {
        const t = resolveSheet(n.sheet, sh);
        const v = cellValue(t, n.r, n.c);
        return v;
      }
      case "range": {
        const t = resolveSheet(n.sheet, sh);
        const r2 = n.r2 < 0 ? t.rows - 1 : n.r2;
        const rows = [];
        for (let r = n.r1; r <= r2; r++) {
          const row = [];
          for (let c = n.c1; c <= n.c2; c++) row.push(cellValue(t, r, c));
          rows.push(row);
        }
        // c1 lets QUERY name columns by their sheet letters.
        return { range: true, rows, c1: n.c1 };
      }
      case "neg": {
        const a = evalNode(n.a, sh);
        return a && a.range ? elementwise(a, null, (x) => -num(x)) : -num(scalar(a));
      }
      case "pct": {
        const a = evalNode(n.a, sh);
        return a && a.range ? elementwise(a, null, (x) => num(x) / 100) : num(scalar(a)) / 100;
      }
      case "bin": {
        const av = evalNode(n.a, sh);
        const bv = evalNode(n.b, sh);
        if ((av && av.range) || (bv && bv.range)) return elementwise(av, bv, (x, y) => binary(n.op, x, y));
        return binary(n.op, scalar(av), scalar(bv));
      }
      case "fn": return callFn(n, sh);
    }
    throw E.parse();
  }
  // Array maths with broadcasting: a single row/column (or a plain value) is repeated to fit.
  function elementwise(a, b, fn) {
    const dims = (v) => (v && v.range ? [v.rows.length, v.rows[0] ? v.rows[0].length : 0] : [1, 1]);
    const [ah, aw] = dims(a), [bh, bw] = b === null ? [1, 1] : dims(b);
    const h = Math.max(ah, bh), w = Math.max(aw, bw);
    if (h * w > 1000000) throw E.value("Array result is too large.");
    const at = (v, vh, vw, i, j) => {
      if (!(v && v.range)) return v;
      const ii = vh === 1 ? 0 : i, jj = vw === 1 ? 0 : j;
      if (ii >= vh || jj >= vw) return E.na("Array arguments are of different size.");
      return v.rows[ii][jj];
    };
    const rows = [];
    for (let i = 0; i < h; i++) {
      const row = [];
      for (let j = 0; j < w; j++) {
        try {
          const x = at(a, ah, aw, i, j), y = b === null ? null : at(b, bh, bw, i, j);
          if (x instanceof FErr) throw x;
          if (y instanceof FErr) throw y;
          row.push(fn(x, y));
        } catch (e) {
          row.push(e instanceof FErr ? e : E.value());
        }
      }
      rows.push(row);
    }
    return { range: true, rows };
  }
  function binary(op, a, b) {
    switch (op) {
      case "+": return num(a) + num(b);
      case "-": return num(a) - num(b);
      case "*": return num(a) * num(b);
      case "/": { const d = num(b); if (d === 0) throw E.div0(); return num(a) / d; }
      case "^": return Math.pow(num(a), num(b));
      case "&": return str(a) + str(b);
      default: return compare(a, b, op);
    }
  }
  function scalar(v) {
    if (v && v.range) v = v.rows.length === 1 && v.rows[0].length === 1 ? v.rows[0][0] : (v.rows[0] ? v.rows[0][0] : null);
    if (v instanceof FErr) throw v;
    return v;
  }
  function num(v) {
    if (v instanceof FErr) throw v;
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    const t = String(v).trim().replace(/^\$/, "").replace(/,/g, "");
    if (/%$/.test(t) && !isNaN(parseFloat(t))) return parseFloat(t) / 100;
    if (t !== "" && !isNaN(Number(t))) return Number(t);
    throw E.value("Expected a number but '" + v + "' is text.");
  }
  function str(v) {
    if (v instanceof FErr) throw v;
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number") return autoNum(v);
    return String(v);
  }
  function bool(v) {
    if (v instanceof FErr) throw v;
    if (typeof v === "boolean") return v;
    if (v === null || v === "") return false;
    if (typeof v === "number") return v !== 0;
    const u = String(v).toUpperCase();
    if (u === "TRUE") return true;
    if (u === "FALSE") return false;
    throw E.value("Expected TRUE/FALSE but got '" + v + "'.");
  }
  function typeRank(v) {
    return typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2;
  }
  function compare(a, b, op) {
    if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
    if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
    let d;
    if (typeof a === typeof b) {
      if (typeof a === "string") { const x = a.toLowerCase(), y = b.toLowerCase(); d = x < y ? -1 : x > y ? 1 : 0; }
      else d = Number(a) - Number(b);
    } else d = typeRank(a) - typeRank(b);
    switch (op) {
      case "=": return d === 0;
      case "<>": return d !== 0;
      case "<": return d < 0;
      case ">": return d > 0;
      case "<=": return d <= 0;
      case ">=": return d >= 0;
    }
    return false;
  }
  function each(args, fn) {
    for (const a of args) {
      if (a && a.range) {
        for (const row of a.rows) for (const v of row) fn(v, true);
      } else fn(a, false);
    }
  }
  function nums(args) {
    const out = [];
    each(args, (v, inRange) => {
      if (v instanceof FErr) throw v;
      if (inRange) { if (typeof v === "number") out.push(v); }
      else if (v !== null) out.push(num(v));
    });
    return out;
  }
  function flatRange(a) {
    if (a && a.range) return a.rows.reduce((acc, row) => acc.concat(row), []);
    return [a];
  }
  function makeCriteria(crit) {
    if (typeof crit === "number" || typeof crit === "boolean") return (v) => v === crit || (typeof v === "string" && v.trim() !== "" && Number(v) === crit);
    let s = crit === null ? "" : String(crit);
    let op = "=";
    const m = /^(<>|>=|<=|=|>|<)([\s\S]*)$/.exec(s);
    if (m) { op = m[1]; s = m[2]; }
    const n = s.trim() !== "" && !isNaN(Number(s)) ? Number(s) : null;
    const re = /[*?]/.test(s) ? new RegExp("^" + s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i") : null;
    return (v) => {
      if (v instanceof FErr) return false;
      if (n !== null && typeof v === "number") {
        switch (op) {
          case "=": return v === n;
          case "<>": return v !== n;
          case ">": return v > n;
          case "<": return v < n;
          case ">=": return v >= n;
          case "<=": return v <= n;
        }
      }
      if (op === "=" || op === "<>") {
        const sv = v === null ? "" : str(v);
        const eq = re ? re.test(sv) : sv.toLowerCase() === s.toLowerCase();
        return op === "=" ? eq : !eq;
      }
      if (n === null && typeof v === "string") {
        const a = v.toLowerCase(), b = s.toLowerCase();
        return op === ">" ? a > b : op === "<" ? a < b : op === ">=" ? a >= b : a <= b;
      }
      return false;
    };
  }
  function ifsAggregate(args, mode) {
    const target = mode === "count" ? null : flatRange(args[0]);
    const pairs = mode === "count" ? args : args.slice(1);
    if (pairs.length % 2) throw E.value("Wrong number of arguments.");
    const len = flatRange(pairs[0]).length;
    const matches = [];
    for (let i = 0; i < len; i++) matches.push(true);
    for (let j = 0; j < pairs.length; j += 2) {
      const range = flatRange(pairs[j]);
      const test = makeCriteria(scalar(pairs[j + 1]));
      for (let i = 0; i < len; i++) if (!test(range[i] === undefined ? null : range[i])) matches[i] = false;
    }
    if (mode === "count") return matches.filter(Boolean).length;
    const vals = target.filter((v, i) => matches[i] && typeof v === "number");
    if (mode === "sum") return vals.reduce((a, b) => a + b, 0);
    if (mode === "min") return vals.length ? Math.min.apply(null, vals) : 0;
    if (mode === "max") return vals.length ? Math.max.apply(null, vals) : 0;
    if (!vals.length) throw E.div0();
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  function roundTo(x, d, mode) {
    const f = Math.pow(10, d);
    const v = x * f;
    const r = mode === "up" ? Math.sign(v) * Math.ceil(Math.abs(v) - 1e-9) : mode === "down" ? Math.trunc(v) : Math.sign(v) * Math.round(Math.abs(v) + 1e-9);
    return r / f;
  }
  function lookupExact(list, key) {
    for (let i = 0; i < list.length; i++) if (compare(list[i], key, "=") && list[i] !== null) return i;
    return -1;
  }
  function lookupSorted(list, key) {
    let found = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i] === null) continue;
      if (compare(list[i], key, "<=")) found = i;
      else break;
    }
    return found;
  }
  function textFormat(v, pattern) {
    const p = String(pattern);
    if (typeof v !== "number") return str(v);
    if (/[dmy]/i.test(p) && !/[0#]/.test(p)) {
      const d = serialToDate(v);
      const pad = (x) => String(x).padStart(2, "0");
      const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      return p
        .replace(/yyyy/gi, String(d.getUTCFullYear()))
        .replace(/yy/gi, String(d.getUTCFullYear()).slice(-2))
        .replace(/mmmm/gi, months[d.getUTCMonth()])
        .replace(/mmm/gi, months[d.getUTCMonth()].slice(0, 3))
        .replace(/mm/gi, pad(d.getUTCMonth() + 1))
        .replace(/dd/gi, pad(d.getUTCDate()));
    }
    const decMatch = /\.([0#]+)/.exec(p);
    const dec = decMatch ? decMatch[1].length : 0;
    const pct = p.includes("%");
    const val = pct ? v * 100 : v;
    const body = p.includes(",") ? Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : Math.abs(val).toFixed(dec);
    return (val < 0 ? "-" : "") + (p.includes("$") ? "$" : "") + body + (pct ? "%" : "");
  }

  const LAZY = {
    IF(n, sh) {
      if (n.args.length < 2) throw E.value("IF needs at least 2 arguments.");
      const c = bool(scalar(evalNode(n.args[0], sh)));
      if (c) return evalNode(n.args[1], sh);
      return n.args[2] ? evalNode(n.args[2], sh) : false;
    },
    IFS(n, sh) {
      for (let i = 0; i + 1 < n.args.length; i += 2) if (bool(scalar(evalNode(n.args[i], sh)))) return evalNode(n.args[i + 1], sh);
      throw E.na("No match in IFS.");
    },
    IFERROR(n, sh) {
      try {
        const v = scalar(evalNode(n.args[0], sh));
        return v;
      } catch (e) {
        if (!(e instanceof FErr)) throw e;
        return n.args[1] ? evalNode(n.args[1], sh) : "";
      }
    },
    ISERROR(n, sh) {
      try { scalar(evalNode(n.args[0], sh)); return false; } catch (e) { if (e instanceof FErr) return true; throw e; }
    },
    ISBLANK(n, sh) {
      const v = evalNode(n.args[0], sh);
      return (v && v.range ? v.rows[0][0] : v) === null;
    },
  };
  LAZY.IFNA = LAZY.IFERROR;

  const FN = {
    SUM: (a) => nums(a).reduce((x, y) => x + y, 0),
    AVERAGE: (a) => { const v = nums(a); if (!v.length) throw E.div0(); return v.reduce((x, y) => x + y, 0) / v.length; },
    MIN: (a) => { const v = nums(a); return v.length ? Math.min.apply(null, v) : 0; },
    MAX: (a) => { const v = nums(a); return v.length ? Math.max.apply(null, v) : 0; },
    COUNT: (a) => { let n = 0; each(a, (v) => { if (typeof v === "number") n++; }); return n; },
    COUNTA: (a) => { let n = 0; each(a, (v) => { if (v !== null && v !== "") n++; }); return n; },
    COUNTBLANK: (a) => { let n = 0; each(a, (v) => { if (v === null || v === "") n++; }); return n; },
    PRODUCT: (a) => nums(a).reduce((x, y) => x * y, 1),
    MEDIAN: (a) => { const v = nums(a).sort((x, y) => x - y); if (!v.length) throw E.num(); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; },
    ROUND: (a) => roundTo(num(scalar(a[0])), a[1] === undefined ? 0 : num(scalar(a[1])), "half"),
    ROUNDUP: (a) => roundTo(num(scalar(a[0])), a[1] === undefined ? 0 : num(scalar(a[1])), "up"),
    ROUNDDOWN: (a) => roundTo(num(scalar(a[0])), a[1] === undefined ? 0 : num(scalar(a[1])), "down"),
    INT: (a) => Math.floor(num(scalar(a[0]))),
    ABS: (a) => Math.abs(num(scalar(a[0]))),
    SQRT: (a) => { const v = num(scalar(a[0])); if (v < 0) throw E.num(); return Math.sqrt(v); },
    POWER: (a) => Math.pow(num(scalar(a[0])), num(scalar(a[1]))),
    MOD: (a) => { const d = num(scalar(a[1])); if (d === 0) throw E.div0(); const x = num(scalar(a[0])); return x - d * Math.floor(x / d); },
    PI: () => Math.PI,
    RAND: () => Math.random(),
    RANDBETWEEN: (a) => { const lo = Math.ceil(num(scalar(a[0]))), hi = Math.floor(num(scalar(a[1]))); return lo + Math.floor(Math.random() * (hi - lo + 1)); },
    CEILING: (a) => { const s = a[1] === undefined ? 1 : num(scalar(a[1])); return s === 0 ? 0 : Math.ceil(num(scalar(a[0])) / s) * s; },
    FLOOR: (a) => { const s = a[1] === undefined ? 1 : num(scalar(a[1])); return s === 0 ? 0 : Math.floor(num(scalar(a[0])) / s) * s; },
    LN: (a) => Math.log(num(scalar(a[0]))),
    LOG10: (a) => Math.log10(num(scalar(a[0]))),
    EXP: (a) => Math.exp(num(scalar(a[0]))),
    SIGN: (a) => Math.sign(num(scalar(a[0]))),
    AND: (a) => { let r = true; each(a, (v) => { if (v instanceof FErr) throw v; if (v !== null) r = r && bool(v); }); return r; },
    OR: (a) => { let r = false; each(a, (v) => { if (v instanceof FErr) throw v; if (v !== null) r = r || bool(v); }); return r; },
    NOT: (a) => !bool(scalar(a[0])),
    TRUE: () => true,
    FALSE: () => false,
    CONCATENATE: (a) => { let s = ""; each(a, (v) => { s += str(v); }); return s; },
    CONCAT: (a) => str(scalar(a[0])) + str(scalar(a[1])),
    TEXTJOIN: (a) => { const d = str(scalar(a[0])), skip = bool(scalar(a[1])); const parts = []; each(a.slice(2), (v) => { if (skip && (v === null || v === "")) return; parts.push(str(v)); }); return parts.join(d); },
    LEN: (a) => str(scalar(a[0])).length,
    UPPER: (a) => str(scalar(a[0])).toUpperCase(),
    LOWER: (a) => str(scalar(a[0])).toLowerCase(),
    PROPER: (a) => str(scalar(a[0])).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, p, ch) => p + ch.toUpperCase()),
    TRIM: (a) => str(scalar(a[0])).trim().replace(/\s+/g, " "),
    LEFT: (a) => str(scalar(a[0])).slice(0, a[1] === undefined ? 1 : num(scalar(a[1]))),
    RIGHT: (a) => { const s = str(scalar(a[0])); const n = a[1] === undefined ? 1 : num(scalar(a[1])); return n <= 0 ? "" : s.slice(-n); },
    MID: (a) => { const s = str(scalar(a[0])); const st = num(scalar(a[1])); if (st < 1) throw E.value(); return s.substr(st - 1, num(scalar(a[2]))); },
    SUBSTITUTE: (a) => {
      const s = str(scalar(a[0])), f = str(scalar(a[1])), t = str(scalar(a[2]));
      if (!f) return s;
      if (a[3] === undefined) return s.split(f).join(t);
      const nth = num(scalar(a[3]));
      let idx = -1;
      for (let i = 0; i < nth; i++) { idx = s.indexOf(f, idx + 1); if (idx < 0) return s; }
      return s.slice(0, idx) + t + s.slice(idx + f.length);
    },
    FIND: (a) => { const i = str(scalar(a[1])).indexOf(str(scalar(a[0])), (a[2] === undefined ? 1 : num(scalar(a[2]))) - 1); if (i < 0) throw E.value("Text not found."); return i + 1; },
    SEARCH: (a) => { const i = str(scalar(a[1])).toLowerCase().indexOf(str(scalar(a[0])).toLowerCase(), (a[2] === undefined ? 1 : num(scalar(a[2]))) - 1); if (i < 0) throw E.value("Text not found."); return i + 1; },
    REPT: (a) => str(scalar(a[0])).repeat(Math.max(0, num(scalar(a[1])))),
    EXACT: (a) => str(scalar(a[0])) === str(scalar(a[1])),
    VALUE: (a) => num(scalar(a[0])),
    TEXT: (a) => textFormat(scalar(a[0]), str(scalar(a[1]))),
    TODAY: () => dateToSerial(new Date()),
    NOW: () => { const d = new Date(); return dateToSerial(d) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; },
    DATE: (a) => (Date.UTC(num(scalar(a[0])), num(scalar(a[1])) - 1, num(scalar(a[2]))) - EPOCH) / 86400000,
    YEAR: (a) => serialToDate(num(scalar(a[0]))).getUTCFullYear(),
    MONTH: (a) => serialToDate(num(scalar(a[0]))).getUTCMonth() + 1,
    DAY: (a) => serialToDate(num(scalar(a[0]))).getUTCDate(),
    WEEKDAY: (a) => serialToDate(num(scalar(a[0]))).getUTCDay() + 1,
    DAYS: (a) => Math.round(num(scalar(a[0])) - num(scalar(a[1]))),
    SUMIF: (a) => ifsAggregate([a[2] === undefined ? a[0] : a[2], a[0], a[1]], "sum"),
    SUMIFS: (a) => ifsAggregate(a, "sum"),
    COUNTIF: (a) => ifsAggregate([a[0], a[1]], "count"),
    COUNTIFS: (a) => ifsAggregate(a, "count"),
    AVERAGEIF: (a) => ifsAggregate([a[2] === undefined ? a[0] : a[2], a[0], a[1]], "avg"),
    VLOOKUP: (a) => {
      const k = scalar(a[0]); const range = a[1];
      if (!range || !range.range) throw E.value("VLOOKUP needs a range.");
      const idx = num(scalar(a[2]));
      const sorted = a[3] === undefined ? true : bool(scalar(a[3]));
      const col = range.rows.map((row) => row[0]);
      const i = sorted ? lookupSorted(col, k) : lookupExact(col, k);
      if (i < 0) throw E.na("Did not find value '" + str(k) + "' in VLOOKUP evaluation.");
      if (idx < 1 || idx > range.rows[0].length) throw E.ref("VLOOKUP index out of range.");
      return range.rows[i][idx - 1];
    },
    HLOOKUP: (a) => {
      const k = scalar(a[0]); const range = a[1];
      if (!range || !range.range) throw E.value("HLOOKUP needs a range.");
      const idx = num(scalar(a[2]));
      const sorted = a[3] === undefined ? true : bool(scalar(a[3]));
      const row = range.rows[0];
      const i = sorted ? lookupSorted(row, k) : lookupExact(row, k);
      if (i < 0) throw E.na("Did not find value '" + str(k) + "' in HLOOKUP evaluation.");
      if (idx < 1 || idx > range.rows.length) throw E.ref("HLOOKUP index out of range.");
      return range.rows[idx - 1][i];
    },
    INDEX: (a) => {
      const range = a[0];
      if (!range || !range.range) return scalar(range);
      let r = a[1] === undefined ? 1 : num(scalar(a[1]));
      let c = a[2] === undefined ? 1 : num(scalar(a[2]));
      if (range.rows.length === 1 && a[2] === undefined) { c = r; r = 1; }
      const row = range.rows[r - 1];
      if (!row || c < 1 || c > row.length) throw E.ref("INDEX out of range.");
      return row[c - 1];
    },
    MATCH: (a) => {
      const k = scalar(a[0]);
      const list = flatRange(a[1]);
      const type = a[2] === undefined ? 1 : num(scalar(a[2]));
      const i = type === 0 ? lookupExact(list, k) : lookupSorted(list, k);
      if (i < 0) throw E.na("Did not find value '" + str(k) + "' in MATCH evaluation.");
      return i + 1;
    },
    ISNUMBER: (a) => typeof scalarSafe(a[0]) === "number",
    ISTEXT: (a) => typeof scalarSafe(a[0]) === "string",
    NA: () => { throw E.na(); },
    HYPERLINK: (a) => str(scalar(a[1] === undefined ? a[0] : a[1])),
    MINIFS: (a) => ifsAggregate(a, "min"),
    MAXIFS: (a) => ifsAggregate(a, "max"),
    AVERAGEIFS: (a) => ifsAggregate(a, "avg"),
    XLOOKUP: (a) => {
      const k = scalar(a[0]);
      const keys = flatRange(a[1]), results = flatRange(a[2]);
      const i = lookupExact(keys, k);
      if (i < 0) {
        if (a[3] !== undefined) return scalar(a[3]);
        throw E.na("Did not find value '" + str(k) + "' in XLOOKUP evaluation.");
      }
      return results[i] === undefined ? null : results[i];
    },
    SWITCH: (a) => {
      const v = scalar(a[0]);
      for (let i = 1; i + 1 < a.length; i += 2) if (compare(v, scalar(a[i]), "=")) return scalar(a[i + 1]);
      if (a.length % 2 === 0) return scalar(a[a.length - 1]);
      throw E.na("No match in SWITCH.");
    },
    CHOOSE: (a) => {
      const i = Math.trunc(num(scalar(a[0])));
      if (i < 1 || i >= a.length) throw E.value("CHOOSE index out of range.");
      return scalar(a[i]);
    },
    COUNTUNIQUE: (a) => { const seen = new Set(); each(a, (v) => { if (v !== null && v !== "" && !(v instanceof FErr)) seen.add(typeof v === "string" ? "s:" + v.toLowerCase() : typeof v + ":" + v); }); return seen.size; },
    LARGE: (a) => { const v = nums([a[0]]).sort((x, y) => y - x); const k = num(scalar(a[1])); if (k < 1 || k > v.length) throw E.num(); return v[k - 1]; },
    SMALL: (a) => { const v = nums([a[0]]).sort((x, y) => x - y); const k = num(scalar(a[1])); if (k < 1 || k > v.length) throw E.num(); return v[k - 1]; },
    SUMPRODUCT: (a) => {
      const lists = a.map(flatRange);
      const n = lists[0] ? lists[0].length : 0;
      if (lists.some((l) => l.length !== n)) throw E.value("SUMPRODUCT ranges must be the same size.");
      let total = 0;
      for (let i = 0; i < n; i++) total += lists.reduce((p, l) => p * (typeof l[i] === "number" ? l[i] : 0), 1);
      return total;
    },
    STDEV: (a) => { const v = nums(a); if (v.length < 2) throw E.div0(); const m = v.reduce((x, y) => x + y, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1)); },
    VAR: (a) => { const v = nums(a); if (v.length < 2) throw E.div0(); const m = v.reduce((x, y) => x + y, 0) / v.length; return v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1); },
    ISEVEN: (a) => Math.trunc(num(scalar(a[0]))) % 2 === 0,
    ISODD: (a) => Math.abs(Math.trunc(num(scalar(a[0])))) % 2 === 1,
    EDATE: (a) => { const d = serialToDate(num(scalar(a[0]))); return (Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.trunc(num(scalar(a[1]))), d.getUTCDate()) - EPOCH) / 86400000; },
    EOMONTH: (a) => { const d = serialToDate(num(scalar(a[0]))); return (Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.trunc(num(scalar(a[1]))) + 1, 0) - EPOCH) / 86400000; },
    DATEDIF: (a) => {
      const s = serialToDate(num(scalar(a[0]))), e = serialToDate(num(scalar(a[1])));
      if (e < s) throw E.num("End date is before start date.");
      const unit = str(scalar(a[2])).toUpperCase();
      const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() - (e.getUTCDate() < s.getUTCDate() ? 1 : 0);
      if (unit === "D") return Math.round((e - s) / 86400000);
      if (unit === "M") return months;
      if (unit === "Y") return Math.floor(months / 12);
      throw E.num("DATEDIF unit must be D, M, or Y.");
    },
    NETWORKDAYS: (a) => {
      let s = Math.trunc(num(scalar(a[0]))), e = Math.trunc(num(scalar(a[1])));
      const sign = e < s ? -1 : 1;
      if (sign < 0) [s, e] = [e, s];
      let n = 0;
      for (let d = s; d <= e && d - s < 100000; d++) { const w = serialToDate(d).getUTCDay(); if (w !== 0 && w !== 6) n++; }
      return n * sign;
    },
    // ---- array functions: their results spill into neighbouring cells
    ARRAYFORMULA: (a) => a[0],
    QUERY: (a) => runQuery(a[0], str(scalar(a[1])), a[2]),
    FILTER: (a) => {
      const data = asRows(a[0]);
      if (a.length < 2) throw E.value("FILTER needs a range and at least one condition.");
      const conds = a.slice(1).map(asRows);
      for (const cond of conds) if (cond.length !== data.length) throw E.value("FILTER has mismatched range sizes. Each condition must have as many rows as the range.");
      const out = data.filter((_, i) => conds.every((cond) => { const v = cond[i][0]; if (v instanceof FErr) throw v; return bool(v === null ? false : v); }));
      if (!out.length) throw E.na("No matches are found in FILTER evaluation.");
      return { range: true, rows: out };
    },
    UNIQUE: (a) => {
      const seen = new Set();
      const out = asRows(a[0]).filter((row) => {
        const sig = JSON.stringify(row.map((v) => (v instanceof FErr ? v.code : v)));
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      });
      return { range: true, rows: out };
    },
    SORT: (a) => {
      const rows = asRows(a[0]).slice();
      const keys = [];
      for (let i = 1; i < a.length || i === 1; i += 2) {
        const col = a[i] === undefined ? 1 : Math.trunc(num(scalar(a[i])));
        if (col < 1 || col > (rows[0] ? rows[0].length : 0)) throw E.value("SORT column is out of range.");
        keys.push({ col: col - 1, asc: a[i + 1] === undefined ? true : bool(scalar(a[i + 1])) });
        if (a[i] === undefined) break;
      }
      rows.sort((x, y) => {
        for (const k of keys) {
          const p = x[k.col], q = y[k.col];
          if (p === null && q === null) continue;
          if (p === null) return 1;
          if (q === null) return -1;
          const d = compare(p, q, "<") ? -1 : compare(p, q, ">") ? 1 : 0;
          if (d) return k.asc ? d : -d;
        }
        return 0;
      });
      return { range: true, rows };
    },
    SEQUENCE: (a) => {
      const h = Math.trunc(num(scalar(a[0]))), w = a[1] === undefined ? 1 : Math.trunc(num(scalar(a[1])));
      const start = a[2] === undefined ? 1 : num(scalar(a[2])), step = a[3] === undefined ? 1 : num(scalar(a[3]));
      if (h < 1 || w < 1 || h * w > 100000) throw E.value("SEQUENCE size must be between 1 and 100,000 cells.");
      const rows = [];
      for (let i = 0; i < h; i++) { const row = []; for (let j = 0; j < w; j++) row.push(start + step * (i * w + j)); rows.push(row); }
      return { range: true, rows };
    },
    TRANSPOSE: (a) => {
      const rows = asRows(a[0]);
      const w = rows[0] ? rows[0].length : 0;
      const out = [];
      for (let j = 0; j < w; j++) out.push(rows.map((row) => (row[j] === undefined ? null : row[j])));
      return { range: true, rows: out };
    },
    // PIVOT(range_with_headers, row_field, value_field, [aggregation], [column_field])
    PIVOT: (a) => {
      const rows = asRows(a[0]);
      if (rows.length < 2) throw E.value("PIVOT needs a header row and at least one data row.");
      const header = rows[0].map((v) => (v === null ? "" : str(v)));
      const field = (arg, label) => {
        const v = scalar(arg);
        const i = typeof v === "number" ? Math.trunc(v) - 1 : header.findIndex((h) => h.toLowerCase() === str(v).trim().toLowerCase());
        if (i < 0 || i >= header.length) throw E.value("PIVOT " + label + " field \"" + str(v) + "\" is not a column of the range.");
        return i;
      };
      const rf = field(a[1], "row"), vf = field(a[2], "value");
      const agg = a[3] === undefined || a[3] === null ? "SUM" : str(scalar(a[3])).toUpperCase();
      if (!PIVOT_AGGS[agg]) throw E.value("PIVOT aggregation must be one of " + Object.keys(PIVOT_AGGS).join(", ") + ".");
      const cf = a[4] === undefined || a[4] === null ? -1 : field(a[4], "column");
      const label = (v) => (v === null || v === "" ? "(blank)" : v);
      const sortKeys = (list) => list.sort((x, y) => (compare(x, y, "<") ? -1 : compare(x, y, ">") ? 1 : 0));
      const data = rows.slice(1).filter((row) => row.some((v) => v !== null && v !== ""));
      const rowKeys = sortKeys([...new Set(data.map((row) => label(row[rf])))]);
      const colKeys = cf < 0 ? [] : sortKeys([...new Set(data.map((row) => label(row[cf])))]);
      const pick = (pr, pc) => data.filter((row) => (pr === undefined || label(row[rf]) === pr) && (pc === undefined || label(row[cf]) === pc)).map((row) => row[vf]);
      const fnAgg = PIVOT_AGGS[agg];
      const title = agg + " of " + (header[vf] || colName(vf));
      const out = [];
      if (cf < 0) {
        out.push([header[rf] || colName(rf), title]);
        for (const k of rowKeys) out.push([k, fnAgg(pick(k))]);
        out.push(["Grand total", fnAgg(pick())]);
      } else {
        out.push([(header[rf] || colName(rf)) + " \\ " + (header[cf] || colName(cf))].concat(colKeys, ["Grand total"]));
        for (const k of rowKeys) out.push([k].concat(colKeys.map((c) => { const vals = pick(k, c); return vals.length ? fnAgg(vals) : null; }), [fnAgg(pick(k))]));
        out.push(["Grand total"].concat(colKeys.map((c) => fnAgg(pick(undefined, c))), [fnAgg(pick())]));
      }
      return { range: true, rows: out };
    },
  };
  // ---------------------------------------------------------------- QUERY (subset of the Google Visualization query language)
  // QUERY(data, "select A, sum(C) where B > 5 group by A order by sum(C) desc limit 10 label sum(C) 'Total'", [headers])
  // Columns are the sheet letters of the data range (or Col1, Col2, …).
  const QUERY_AGGS = ["sum", "avg", "count", "min", "max"];
  function queryTokens(q) {
    const out = [];
    const re = /\s*(?:(\d+(?:\.\d+)?)|'((?:[^']|'')*)'|"((?:[^"]|"")*)"|(<=|>=|!=|<>|[=<>(),*])|([A-Za-z_][A-Za-z0-9_]*))/y;
    let m;
    re.lastIndex = 0;
    while (re.lastIndex < q.length) {
      const start = re.lastIndex;
      if (!(m = re.exec(q))) {
        if (q.slice(start).trim() === "") break;
        throw E.value("QUERY: can't parse near \"" + q.slice(start, start + 12) + "\"");
      }
      if (m[1] !== undefined) out.push({ t: "num", v: parseFloat(m[1]) });
      else if (m[2] !== undefined) out.push({ t: "str", v: m[2].replace(/''/g, "'") });
      else if (m[3] !== undefined) out.push({ t: "str", v: m[3].replace(/""/g, '"') });
      else if (m[4] !== undefined) out.push({ t: "op", v: m[4] });
      else out.push({ t: "word", v: m[5], up: m[5].toLowerCase() });
    }
    return out;
  }
  function runQuery(dataArg, text, headersArg) {
    const rows = asRows(dataArg);
    const firstCol = dataArg && dataArg.range && Number.isInteger(dataArg.c1) ? dataArg.c1 : 0;
    const width = rows[0] ? rows[0].length : 0;
    let headerRows = headersArg === undefined || headersArg === null ? -1 : Math.max(0, Math.trunc(num(scalar(headersArg))));
    if (headerRows < 0) headerRows = rows.length > 1 && rows[0].every((v) => typeof v === "string" || v === null) && rows[0].some((v) => typeof v === "string") ? 1 : 0;
    const headerNames = [];
    for (let j = 0; j < width; j++) headerNames.push(rows.slice(0, headerRows).map((row) => (row[j] === null ? "" : str(row[j]))).join(" ").trim());
    let data = rows.slice(headerRows);
    const toks = queryTokens(text);
    let p = 0;
    const peek = () => toks[p];
    const isWord = (...words) => toks[p] && toks[p].t === "word" && words.includes(toks[p].up);
    const isOp = (v) => toks[p] && toks[p].t === "op" && toks[p].v === v;
    const expectOp = (v) => { if (!isOp(v)) throw E.value("QUERY: expected \"" + v + "\""); p++; };
    const expectWord = (w) => { if (!isWord(w)) throw E.value("QUERY: expected \"" + w + "\""); p++; };
    const column = (tok) => {
      const m = /^col(\d+)$/i.exec(tok.v);
      const j = m ? +m[1] - 1 : colIndex(tok.v) - firstCol;
      if (!/^(?:[A-Za-z]{1,3}|col\d+)$/i.test(tok.v) || j < 0 || j >= width) throw E.value("QUERY: unknown column " + tok.v);
      return j;
    };
    // A select/order/label item: a column, or an aggregate of a column.
    function item() {
      const tk = peek();
      if (!tk || tk.t !== "word") throw E.value("QUERY: expected a column");
      p++;
      if (QUERY_AGGS.includes(tk.up) && isOp("(")) {
        p++;
        const ct = peek();
        p++;
        const col = ct && ct.t === "op" && ct.v === "*" ? -1 : column(ct || {});
        expectOp(")");
        return { agg: tk.up, col };
      }
      return { col: column(tk) };
    }
    const keyOf = (it) => (it.agg ? it.agg + "(" + it.col + ")" : String(it.col));
    function value() {
      const tk = peek();
      if (!tk) throw E.value("QUERY: expected a value");
      p++;
      if (tk.t === "num" || tk.t === "str") return { lit: tk.v };
      if (tk.t === "word" && (tk.up === "true" || tk.up === "false")) return { lit: tk.up === "true" };
      if (tk.t === "word" && tk.up === "date" && peek() && peek().t === "str") {
        const d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(peek().v);
        p++;
        if (!d) throw E.value("QUERY: dates are written date 'yyyy-mm-dd'");
        return { lit: (Date.UTC(+d[1], +d[2] - 1, +d[3]) - EPOCH) / 86400000 };
      }
      if (tk.t === "word") return { col: column(tk) };
      throw E.value("QUERY: unexpected \"" + tk.v + "\"");
    }
    function condition() {
      if (isWord("not")) { p++; const c = condition(); return (row) => !c(row); }
      if (isOp("(")) { p++; const c = orExpr(); expectOp(")"); return c; }
      const left = value();
      const get = (side, row) => (side.lit !== undefined ? side.lit : row[side.col] === undefined ? null : row[side.col]);
      if (isWord("is")) {
        p++;
        const negate = isWord("not") ? (p++, true) : false;
        expectWord("null");
        return (row) => { const v = get(left, row); return negate ? v !== null && v !== "" : v === null || v === ""; };
      }
      let op;
      if (isWord("contains")) { p++; op = "contains"; }
      else if (isWord("starts")) { p++; expectWord("with"); op = "starts"; }
      else if (isWord("ends")) { p++; expectWord("with"); op = "ends"; }
      else if (isWord("like")) { p++; op = "like"; }
      else if (peek() && peek().t === "op" && ["=", "!=", "<>", "<", ">", "<=", ">="].includes(peek().v)) op = toks[p++].v;
      else throw E.value("QUERY: expected a comparison");
      const right = value();
      return (row) => {
        const a = get(left, row), b = get(right, row);
        if (a instanceof FErr || b instanceof FErr) return false;
        const sa = a === null ? "" : str(a), sb = b === null ? "" : str(b);
        switch (op) {
          case "contains": return sa.includes(sb);
          case "starts": return sa.startsWith(sb);
          case "ends": return sa.endsWith(sb);
          case "like": return new RegExp("^" + sb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$").test(sa);
          case "!=": return !compare(a, b, "=");
          default: return compare(a, b, op);
        }
      };
    }
    function andExpr() {
      let c = condition();
      while (isWord("and")) { p++; const l = c, r = condition(); c = (row) => l(row) && r(row); }
      return c;
    }
    function orExpr() {
      let c = andExpr();
      while (isWord("or")) { p++; const l = c, r = andExpr(); c = (row) => l(row) || r(row); }
      return c;
    }

    let select = null, where = null, groupBy = [], order = [], limit = -1, offset = 0;
    const labels = new Map();
    if (isWord("select")) {
      p++;
      if (isOp("*")) { p++; } else {
        select = [item()];
        while (isOp(",")) { p++; select.push(item()); }
      }
    }
    if (isWord("where")) { p++; where = orExpr(); }
    if (isWord("group")) {
      p++; expectWord("by");
      groupBy = [item().col];
      while (isOp(",")) { p++; groupBy.push(item().col); }
    }
    if (isWord("order")) {
      p++; expectWord("by");
      do {
        if (isOp(",")) p++;
        const it = item();
        let asc = true;
        if (isWord("asc")) p++;
        else if (isWord("desc")) { p++; asc = false; }
        order.push({ it, asc });
      } while (isOp(","));
    }
    if (isWord("limit")) { p++; const tk = toks[p++]; if (!tk || tk.t !== "num") throw E.value("QUERY: limit needs a number"); limit = Math.trunc(tk.v); }
    if (isWord("offset")) { p++; const tk = toks[p++]; if (!tk || tk.t !== "num") throw E.value("QUERY: offset needs a number"); offset = Math.trunc(tk.v); }
    if (isWord("label")) {
      p++;
      do {
        if (isOp(",")) p++;
        const it = item();
        const tk = toks[p++];
        if (!tk || tk.t !== "str") throw E.value("QUERY: label needs a quoted name");
        labels.set(keyOf(it), tk.v);
      } while (isOp(","));
    }
    if (p < toks.length) throw E.value("QUERY: unexpected \"" + toks[p].v + "\"");

    if (where) data = data.filter((row) => where(row));
    const items = select || headerNames.map((_, j) => ({ col: j }));
    const hasAgg = items.some((it) => it.agg);
    if (hasAgg || groupBy.length) {
      for (const it of items) if (!it.agg && !groupBy.includes(it.col)) throw E.value("QUERY: column " + colName(firstCol + it.col) + " must be in group by or inside an aggregate");
    }
    const aggregate = (it, group) => {
      const vals = it.col < 0 ? group.map(() => 1) : group.map((row) => row[it.col]);
      const n = vals.filter((v) => typeof v === "number");
      switch (it.agg) {
        case "count": return vals.filter((v) => v !== null && v !== "").length;
        case "sum": return n.reduce((x, y) => x + y, 0);
        case "avg": return n.length ? n.reduce((x, y) => x + y, 0) / n.length : null;
        case "min": return n.length ? Math.min.apply(null, n) : null;
        case "max": return n.length ? Math.max.apply(null, n) : null;
      }
      return null;
    };
    // Each output row keeps a map from item key to value so order by can use aggregates.
    let out;
    if (hasAgg || groupBy.length) {
      const groups = new Map();
      for (const row of data) {
        const k = JSON.stringify(groupBy.map((j) => row[j]));
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(row);
      }
      if (!groupBy.length && !groups.size) groups.set("[]", []);
      out = [...groups.values()].map((group) => {
        const vals = new Map();
        for (const j of groupBy) vals.set(String(j), group[0] ? group[0][j] : null);
        for (const it of items.concat(order.map((o) => o.it))) if (it.agg) vals.set(keyOf(it), aggregate(it, group));
        return vals;
      });
      if (!order.length) order = groupBy.map((j) => ({ it: { col: j }, asc: true }));
    } else {
      out = data.map((row) => { const vals = new Map(); row.forEach((v, j) => vals.set(String(j), v)); return vals; });
    }
    if (order.length) {
      out.sort((x, y) => {
        for (const o of order) {
          const a = x.get(keyOf(o.it)), b = y.get(keyOf(o.it));
          if (a === b) continue;
          if (a === null || a === undefined) return 1;
          if (b === null || b === undefined) return -1;
          const d = compare(a, b, "<") ? -1 : compare(a, b, ">") ? 1 : 0;
          if (d) return o.asc ? d : -d;
        }
        return 0;
      });
    }
    out = out.slice(offset, limit < 0 ? undefined : offset + limit);
    const title = (it) => labels.get(keyOf(it)) ?? (it.agg ? it.agg + " " + (it.col < 0 ? "" : headerNames[it.col] || colName(firstCol + it.col)) : headerNames[it.col] || "");
    // Like Sheets, an empty result is #N/A even when there would be a header row.
    if (!out.length) throw E.na("Query completed with an empty output.");
    const result = out.map((vals) => items.map((it) => { const v = vals.get(keyOf(it)); return v === undefined ? null : v; }));
    const showHeader = headerRows > 0 || hasAgg || labels.size > 0;
    if (showHeader) result.unshift(items.map(title));
    return { range: true, rows: result };
  }

  function asRows(v) {    if (v && v.range) return v.rows;
    if (v instanceof FErr) throw v;
    return [[v]];
  }
  const PIVOT_AGGS = {
    SUM: (vals) => vals.filter((v) => typeof v === "number").reduce((x, y) => x + y, 0),
    COUNT: (vals) => vals.filter((v) => typeof v === "number").length,
    COUNTA: (vals) => vals.filter((v) => v !== null && v !== "").length,
    AVERAGE: (vals) => { const n = vals.filter((v) => typeof v === "number"); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : null; },
    MIN: (vals) => { const n = vals.filter((v) => typeof v === "number"); return n.length ? Math.min.apply(null, n) : null; },
    MAX: (vals) => { const n = vals.filter((v) => typeof v === "number"); return n.length ? Math.max.apply(null, n) : null; },
  };
  function scalarSafe(v) {
    try { return scalar(v); } catch { return null; }
  }
  const FN_HELP = {
    SUM: "SUM(value1, [value2, ...])", AVERAGE: "AVERAGE(value1, [value2, ...])", MIN: "MIN(value1, ...)", MAX: "MAX(value1, ...)",
    COUNT: "COUNT(value1, ...)", COUNTA: "COUNTA(value1, ...)", IF: "IF(condition, value_if_true, value_if_false)", IFERROR: "IFERROR(value, value_if_error)",
    SUMIF: "SUMIF(range, criterion, [sum_range])", COUNTIF: "COUNTIF(range, criterion)", AVERAGEIF: "AVERAGEIF(range, criterion, [average_range])",
    SUMIFS: "SUMIFS(sum_range, range1, criterion1, ...)", COUNTIFS: "COUNTIFS(range1, criterion1, ...)", VLOOKUP: "VLOOKUP(key, range, index, [is_sorted])",
    HLOOKUP: "HLOOKUP(key, range, index, [is_sorted])", INDEX: "INDEX(range, row, [column])", MATCH: "MATCH(key, range, [type])",
    ROUND: "ROUND(value, [places])", CONCATENATE: "CONCATENATE(text1, ...)", TEXTJOIN: "TEXTJOIN(delimiter, ignore_empty, text1, ...)",
    LEFT: "LEFT(text, [n])", RIGHT: "RIGHT(text, [n])", MID: "MID(text, start, length)", LEN: "LEN(text)", TODAY: "TODAY()", NOW: "NOW()",
    DATE: "DATE(year, month, day)", TEXT: "TEXT(number, format)", AND: "AND(logical1, ...)", OR: "OR(logical1, ...)",
    FILTER: "FILTER(range, condition1, [condition2, ...]) — spills", UNIQUE: "UNIQUE(range) — spills", SORT: "SORT(range, [column], [ascending], ...) — spills",
    SEQUENCE: "SEQUENCE(rows, [columns], [start], [step]) — spills", TRANSPOSE: "TRANSPOSE(range) — spills",
    QUERY: "QUERY(data, \"select A, sum(C) where B > 5 group by A order by sum(C) desc limit 10\", [headers]) — spills",
    PIVOT: "PIVOT(range, row_field, value_field, [SUM|COUNT|COUNTA|AVERAGE|MIN|MAX], [column_field]) — spills",
    XLOOKUP: "XLOOKUP(key, lookup_range, result_range, [if_not_found])", SWITCH: "SWITCH(expression, case1, value1, ..., [default])",
  };
  function callFn(n, sh) {
    if (LAZY[n.name]) return LAZY[n.name](n, sh);
    const f = FN[n.name];
    if (!f) throw E.name(n.name);
    const args = n.args.map((a) => {
      const v = evalNode(a, sh);
      return v;
    });
    return f(args);
  }

  // ---------------------------------------------------------------- formula reference rewriting
  const REF_RE = /("(?:[^"]|"")*")|(?<![A-Za-z0-9_.$])((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(!])/g;
  function fmtRef(x) {
    return (x.ca ? "$" : "") + colName(x.c) + (x.ra ? "$" : "") + (x.r + 1);
  }
  function transformFormula(f, fn) {
    return f.replace(REF_RE, (m, quoted, sh, ca, cn, ra, rn, ca2, cn2, ra2, rn2) => {
      if (quoted) return m;
      const sheetName = sh ? unquoteSheet(sh.slice(0, -1)) : null;
      const a = { c: colIndex(cn), r: +rn - 1, ca: !!ca, ra: !!ra };
      const b = cn2 ? { c: colIndex(cn2), r: +rn2 - 1, ca: !!ca2, ra: !!ra2 } : null;
      const res = fn(sheetName, a, b);
      if (!res) return "#REF!";
      return (sh || "") + fmtRef(res[0]) + (res[1] ? ":" + fmtRef(res[1]) : "");
    });
  }
  function shiftFormula(f, dr, dc) {
    return transformFormula(f, (s, a, b) => {
      const mv = (x) => ({ c: x.ca ? x.c : x.c + dc, r: x.ra ? x.r : x.r + dr, ca: x.ca, ra: x.ra });
      const na = mv(a), nb = b ? mv(b) : null;
      if (na.r < 0 || na.c < 0 || (nb && (nb.r < 0 || nb.c < 0))) return null;
      return [na, nb];
    });
  }
  // Rewrites every formula in the document after rows/columns of `target` move.
  // Moves range-based sheet features (dropdowns, conditional formats, charts, hidden rows/columns)
  // when rows or columns are inserted (count > 0) or deleted (count < 0).
  function shiftSheetRanges(target, axis, at, count) {
    const lo = axis === "row" ? "r1" : "c1", hi = axis === "row" ? "r2" : "c2";
    const del = -count;
    const shiftRange = (rg) => {
      if (count > 0) {
        if (rg[lo] >= at) rg[lo] += count;
        if (rg[hi] >= at) rg[hi] += count;
        return true;
      }
      const map = (v, end) => (v < at ? v : v >= at + del ? v - del : end ? at - 1 : at);
      const a = map(rg[lo], false), b = map(rg[hi], true);
      if (b < a) return false;
      rg[lo] = a;
      rg[hi] = b;
      return true;
    };
    if (target.validation) target.validation = target.validation.filter(shiftRange);
    if (target.condFormats) target.condFormats = target.condFormats.filter(shiftRange);
    if (target.charts) target.charts = target.charts.filter((ch) => shiftRange(ch.range));
    if (target.protected) target.protected = target.protected.filter(shiftRange);
    if (target.comments) {
      // Comments follow their cell; comments on deleted cells go with them.
      const moved = {};
      for (const [k, list] of Object.entries(target.comments)) {
        const [r, c] = k.split(":").map(Number);
        let v = axis === "row" ? r : c;
        if (count < 0 && v >= at && v < at + del) continue;
        if (v >= at) v += count;
        moved[axis === "row" ? key(v, c) : key(r, v)] = list;
      }
      target.comments = moved;
    }
    const listProp = axis === "row" ? "hiddenRowsList" : "hiddenCols";
    if (target[listProp]) {
      target[listProp] = target[listProp]
        .filter((v) => count > 0 || v < at || v >= at + del)
        .map((v) => (v >= at ? v + count : v));
    }
  }
  function rewriteForStructure(target, axis, at, count) {
    shiftSheetRanges(target, axis, at, count);
    const prop = axis === "row" ? "r" : "c";
    const map = (x, isEnd) => {
      const v = x[prop];
      if (count > 0) return v >= at ? v + count : v;
      const del = -count;
      if (v < at) return v;
      if (v >= at + del) return v - del;
      return isEnd === undefined ? null : isEnd ? at - 1 : at;
    };
    for (const sh of doc.sheets) {
      for (const k in sh.cells) {
        const cell = sh.cells[k];
        if (!isFormula(cell.v)) continue;
        cell.v = transformFormula(cell.v, (sheetName, a, b) => {
          const refersToTarget = sheetName ? sheetByName(sheetName) === target : sh === target;
          if (!refersToTarget) return [a, b];
          if (!b) {
            const v = map(a);
            return v === null ? null : [Object.assign({}, a, { [prop]: v }), null];
          }
          const s = map(a, false), e = map(b, true);
          if (s === null || e === null || e < s) return null;
          return [Object.assign({}, a, { [prop]: s }), Object.assign({}, b, { [prop]: e })];
        });
      }
    }
  }
  function renameSheetRefs(oldName, newName) {
    const q = /^[A-Za-z_][A-Za-z0-9_]*$/.test(newName) ? newName : "'" + newName.replace(/'/g, "''") + "'";
    for (const sh of doc.sheets) for (const k in sh.cells) {
      const cell = sh.cells[k];
      if (!isFormula(cell.v)) continue;
      cell.v = cell.v.replace(REF_RE, (m, quoted, s) => {
        if (quoted || !s) return m;
        return unquoteSheet(s.slice(0, -1)).toLowerCase() === oldName.toLowerCase() ? q + "!" + m.slice(s.length) : m;
      });
    }
  }

  // ---------------------------------------------------------------- display formatting
  function autoNum(v) {
    if (!isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    const a = Math.abs(v);
    if (a >= 1e15 || (a < 1e-9 && a > 0)) return v.toExponential(2).toUpperCase();
    return String(parseFloat(v.toPrecision(10)));
  }
  function effectiveFmt(cell) {
    const s = (cell && cell.s) || {};
    if (s.fmt && s.fmt !== "auto") return s.fmt;
    if (cell && isFormula(cell.v)) {
      const m = /^=\s*(TODAY|NOW|DATE)\s*\(/i.exec(cell.v);
      if (m) return m[1].toUpperCase() === "NOW" ? "datetime" : "date";
    }
    return "auto";
  }
  function formatValue(v, fmt, dec) {
    if (v === null || v === undefined) return "";
    if (v instanceof FErr) return v.code;
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number") {
      const d = dec === undefined || dec === null ? 2 : dec;
      const loc = (x) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
      switch (fmt) {
        case "number": return loc(v);
        case "percent": return loc(v * 100) + "%";
        case "currency": return (v < 0 ? "-$" : "$") + loc(Math.abs(v));
        case "sci": return v.toExponential(d).toUpperCase();
        case "date": return fmtDate(v);
        case "datetime": return fmtDateTime(v);
        default: return dec === undefined || dec === null ? autoNum(v) : v.toFixed(dec);
      }
    }
    return String(v);
  }
  // Recognizes typed input like "12%", "$1,200", "3/14/2026" and stores a number + format.
  function detectInput(raw) {
    if (isFormula(raw) || raw === "") return { v: raw };
    const t = raw.trim();
    let m;
    if ((m = /^(-?)\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/.exec(t))) return { v: String(parseFloat(m[1] + m[2].replace(/,/g, "") + (m[3] || ""))), fmt: "currency" };
    if ((m = /^(-?\d+(?:\.\d+)?)\s?%$/.exec(t))) return { v: String(parseFloat(m[1]) / 100), fmt: "percent" };
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return { v: t.replace(/,/g, ""), fmt: "number" };
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)) || (m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) {
      const iso = t.includes("-");
      const y = +(iso ? m[1] : m[3]), mo = +(iso ? m[2] : m[1]), d = +(iso ? m[3] : m[2]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { v: String((Date.UTC(y, mo - 1, d) - EPOCH) / 86400000), fmt: "date" };
    }
    return { v: raw };
  }

  // ---------------------------------------------------------------- state
  let doc = null;
  let sheet = null;
  let active = { r: 0, c: 0 };
  let extent = { r: 0, c: 0 };
  let range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  let zoom = 1;
  let aggMode = 0;
  let paintFormat = null;
  let showGridlines = true;
  const undoStack = [];
  const redoStack = [];
  let clipboard = null;

  const grid = $("grid");
  const scroller = $("grid-scroll");
  const editor = $("cell-editor");
  const sink = $("key-sink");
  const formulaInput = $("formula-input");
  const nameBox = $("name-box");

  // ---------------------------------------------------------------- persistence
  // Documents are saved to the gateway (/api/sheets) and cached in localStorage. When the API is
  // not reachable (static preview, offline) the editor keeps working against the browser copy.
  let saveTimer = null;
  let unloading = false;
  // available: null until known; version: server version our copy is based on;
  // synced: JSON of the document as last agreed with the server (the merge base).
  const server = { available: null, version: 0, synced: null, inflight: false, again: false };
  function setSaveState(text) {
    $("save-state").textContent = text;
  }
  function scheduleSave() {
    setSaveState("Saving…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 350);
  }
  // While local edits have not reached the server, remember what they were based on so they can be
  // merged after a lost session, a network outage, or a closed tab.
  const PENDING_PREFIX = "aureum-sheet:pending:";
  function markPending() {
    if (storageGet(PENDING_PREFIX + doc.id)) return;
    storageSet(PENDING_PREFIX + doc.id, JSON.stringify({ baseVersion: server.version, base: server.synced }));
  }
  function clearPending() {
    try { localStorage.removeItem(PENDING_PREFIX + doc.id); } catch { /* ignore */ }
  }
  function readPending(id) {
    try { return JSON.parse(storageGet(PENDING_PREFIX + id) || "null"); } catch { return null; }
  }
  // Viewers get a read-only editor; the server also refuses their writes.
  let me = { username: "", role: "editor" };
  const readOnly = () => me.role === "viewer";
  function refuseReadOnly() {
    toast("View only: ask an admin for edit access");
  }
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (readOnly()) {
      setSaveState("View only");
      return true;
    }
    const json = JSON.stringify(doc);
    const ok = storageSet(DOC_PREFIX + doc.id, json);
    if (ok) writeIndexEntry(doc);
    if (server.available !== false && json !== server.synced) markPending();
    if (server.available === false) {
      setSaveState(ok ? "Saved to this browser" : "Couldn't save (browser storage full or blocked)");
      return ok;
    }
    syncToServer();
    return ok;
  }
  window.addEventListener("beforeunload", () => {
    unloading = true;
    if (saveTimer) saveNow();
  });
  async function api(method, path, body) {
    const init = { method, credentials: "same-origin", headers: {} };
    if (method !== "GET") init.headers["X-Requested-With"] = "aureum-sheet";
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
      if (unloading && init.body.length < 60000) init.keepalive = true;
    }
    const res = await fetch(path, init);
    const type = res.headers.get("content-type") || "";
    return { status: res.status, data: type.includes("application/json") ? await res.json() : null };
  }
  const docPath = () => "/api/sheets/" + encodeURIComponent(doc.id);
  async function syncToServer() {
    if (server.inflight) { server.again = true; return; }
    server.inflight = true;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        server.again = false;
        const body = JSON.stringify(doc);
        if (body === server.synced) { clearPending(); setSaveState("All changes saved"); return; }
        let res;
        try {
          res = await api("PUT", docPath(), { baseVersion: server.version, doc: JSON.parse(body) });
        } catch {
          setSaveState("Saved to this browser · server unreachable, will retry");
          setTimeout(() => { if (hasUnsyncedChanges()) syncToServer(); }, 10000);
          return;
        }
        if (res.status === 200 && res.data) {
          server.available = true;
          server.version = res.data.version;
          server.synced = body;
          if (server.again || JSON.stringify(doc) !== body) continue;
          clearPending();
          setSaveState("All changes saved");
          return;
        }
        if (res.status === 409 && res.data) {
          // Someone else (or a webhook) saved first: re-apply our edits on top of their version.
          const remoteJson = JSON.stringify(res.data.doc);
          const conflicts = [];
          applyRemote(mergeDocs(server.synced ? JSON.parse(server.synced) : null, JSON.parse(body), res.data.doc, conflicts), res.data.version, remoteJson);
          toast(conflicts.length
            ? conflicts.length + " cell" + (conflicts.length === 1 ? " was" : "s were") + " also changed by someone else; your version was kept: " + conflicts.slice(0, 5).join(", ") + (conflicts.length > 5 ? "…" : "")
            : "Merged your changes with newer changes from the server");
          continue;
        }
        if (res.status === 401) { setSaveState("Not saved to the server · sign in again"); return; }
        if (!res.data) { server.available = false; setSaveState("Saved to this browser"); return; }
        setSaveState("Couldn't save to the server: " + (res.data.error || res.status));
        return;
      }
    } finally {
      server.inflight = false;
    }
  }
  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  // Three-way merge: every cell or sheet setting we changed since `base` wins; everything else
  // comes from `remote`.
  // Cells changed on both sides are reported in `conflicts` (as "Sheet!A1"); the local edit wins.
  function mergeDocs(base, local, remote, conflicts) {
    if (!base) return local;
    const out = clone(remote);
    for (const p of ["title", "starred"]) if (!same(base[p], local[p])) out[p] = local[p];
    const baseSheets = new Map(base.sheets.map((s) => [s.id, s]));
    const localIds = new Set(local.sheets.map((s) => s.id));
    out.sheets = out.sheets.filter((s) => !(baseSheets.has(s.id) && !localIds.has(s.id)));
    for (const ls of local.sheets) {
      const bs = baseSheets.get(ls.id);
      const rs = out.sheets.find((s) => s.id === ls.id);
      if (!bs) { if (!rs) out.sheets.push(clone(ls)); continue; }
      if (!rs) continue;
      for (const p of Object.keys(ls)) {
        if (p === "cells" || p === "id" || same(bs[p], ls[p])) continue;
        if (p === "comments") rs.comments = unionComments(bs.comments, ls.comments, rs.comments);
        else if (p === "protected") rs.protected = unionById(bs.protected, ls.protected, rs.protected);
        else rs[p] = p === "rows" || p === "cols" ? Math.max(rs[p], ls[p]) : clone(ls[p]);
      }
      const keys = new Set(Object.keys(bs.cells).concat(Object.keys(ls.cells)));
      for (const k of keys) {
        if (same(bs.cells[k], ls.cells[k])) continue;
        if (conflicts && !same(bs.cells[k], rs.cells[k]) && !same(ls.cells[k], rs.cells[k])) {
          const [r, c] = k.split(":").map(Number);
          conflicts.push(ls.name + "!" + addr(r, c));
        }
        if (ls.cells[k]) rs.cells[k] = clone(ls.cells[k]);
        else delete rs.cells[k];
      }
    }
    out.active = Math.max(0, Math.min(local.active || 0, out.sheets.length - 1));
    return out;
  }
  // Documents can come from other clients, the API, or old versions of this editor: make every
  // optional field present and well-typed before rendering.
  function normalizeDoc(d) {
    const int = (v, lo, hi, dflt) => (Number.isInteger(v) && v >= lo && v <= hi ? v : dflt);
    const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
    const rect = (m) => m && typeof m === "object" && [m.r1, m.c1, m.r2, m.c2].every((n) => Number.isInteger(n) && n >= 0) && m.r2 >= m.r1 && m.c2 >= m.c1;
    d.title = typeof d.title === "string" ? d.title : "Untitled spreadsheet";
    if (!Array.isArray(d.sheets) || !d.sheets.length) d.sheets = [newSheet("Sheet1")];
    d.sheets.forEach((sh, i) => {
      sh.id = typeof sh.id === "string" && sh.id ? sh.id : uid();
      sh.name = typeof sh.name === "string" && sh.name ? sh.name : "Sheet" + (i + 1);
      sh.rows = int(sh.rows, 1, 1000000, 100);
      sh.cols = int(sh.cols, 1, 18278, 26);
      sh.cells = obj(sh.cells);
      for (const k in sh.cells) {
        const cell = sh.cells[k];
        if (!/^\d+:\d+$/.test(k) || !cell || typeof cell !== "object") { delete sh.cells[k]; continue; }
        if (typeof cell.v !== "string") cell.v = cell.v === null || cell.v === undefined ? "" : String(cell.v);
        if (cell.s !== undefined && (typeof cell.s !== "object" || Array.isArray(cell.s))) delete cell.s;
        if (cell.note !== undefined && typeof cell.note !== "string") delete cell.note;
      }
      sh.colW = obj(sh.colW);
      sh.rowH = obj(sh.rowH);
      sh.freezeRows = int(sh.freezeRows, 0, sh.rows, 0);
      sh.freezeCols = int(sh.freezeCols, 0, sh.cols, 0);
      sh.merges = Array.isArray(sh.merges) ? sh.merges.filter(rect) : [];
      if (sh.filter && !(Number.isInteger(sh.filter.r) && Number.isInteger(sh.filter.c1) && Number.isInteger(sh.filter.c2))) sh.filter = null;
      if (sh.filter) { sh.filter.r2 = int(sh.filter.r2, 0, sh.rows, sh.filter.r); sh.filter.hide = obj(sh.filter.hide); }
      if (sh.filter === undefined) sh.filter = null;
      if (sh.gridlines !== false) sh.gridlines = true;
      if (sh.validation !== undefined) sh.validation = Array.isArray(sh.validation) ? sh.validation.filter((x) => rect(x) && Array.isArray(x.list)).map((x) => Object.assign(x, { list: x.list.map(String) })) : [];
      if (sh.condFormats !== undefined) sh.condFormats = Array.isArray(sh.condFormats) ? sh.condFormats.filter((x) => rect(x) && typeof x.type === "string") : [];
      if (sh.charts !== undefined) sh.charts = Array.isArray(sh.charts) ? sh.charts.filter((x) => x && typeof x.id === "string" && rect(x.range)) : [];
      if (sh.protected !== undefined) sh.protected = Array.isArray(sh.protected) ? sh.protected.filter((x) => rect(x) && typeof x.id === "string" && typeof x.owner === "string").map((x) => Object.assign(x, { editors: Array.isArray(x.editors) ? x.editors.map(String) : [] })) : [];
      if (sh.comments !== undefined) {
        const clean = {};
        for (const [k, list] of Object.entries(obj(sh.comments))) {
          if (!/^\d+:\d+$/.test(k) || !Array.isArray(list)) continue;
          const threads = list.filter((th) => th && typeof th.id === "string" && typeof th.text === "string" && typeof th.author === "string").map((th) => Object.assign(th, { replies: Array.isArray(th.replies) ? th.replies.filter((x) => x && typeof x.text === "string" && typeof x.author === "string") : [] }));
          if (threads.length) clean[k] = threads;
        }
        sh.comments = clean;
      }
      for (const p of ["hiddenRowsList", "hiddenCols"]) if (sh[p] !== undefined) sh[p] = Array.isArray(sh[p]) ? sh[p].filter((n) => Number.isInteger(n) && n >= 0) : [];
    });
    d.active = int(d.active, 0, d.sheets.length - 1, 0);
    return d;
  }
  // Our version of a list wins, but items someone else added meanwhile are kept.
  function unionById(base, local, remote) {
    const out = clone(local || []);
    const seen = new Set(out.map((x) => x.id).concat((base || []).map((x) => x.id)));
    for (const item of remote || []) if (!seen.has(item.id)) out.push(clone(item));
    return out;
  }
  function unionComments(base, local, remote) {
    const out = clone(local || {});
    const ids = (m) => new Set(Object.values(m || {}).flatMap((list) => (Array.isArray(list) ? list.flatMap((t) => [t.id].concat((t.replies || []).map((x) => x.id))) : [])));
    const known = new Set([...ids(base), ...ids(local)]);
    const localThreads = new Map();
    for (const list of Object.values(out)) for (const th of list) localThreads.set(th.id, th);
    for (const [k, list] of Object.entries(remote || {})) {
      for (const th of list) {
        if (!known.has(th.id)) { (out[k] = out[k] || []).push(clone(th)); continue; }
        const mine = localThreads.get(th.id);
        if (mine) for (const reply of th.replies || []) if (!known.has(reply.id)) mine.replies.push(clone(reply));
      }
    }
    return out;
  }
  function applyRemote(newDoc, version, syncedJson) {
    normalizeDoc(newDoc);
    const keep = { active: Object.assign({}, active), extent: Object.assign({}, extent), sheetId: sheet && sheet.id };
    doc = newDoc;
    server.version = version;
    server.synced = syncedJson;
    const idx = doc.sheets.findIndex((s) => s.id === keep.sheetId);
    doc.active = idx >= 0 ? idx : Math.max(0, Math.min(doc.active || 0, doc.sheets.length - 1));
    sheet = doc.sheets[doc.active];
    // Undo snapshots predate the remote change; replaying them would drop other people's data.
    undoStack.length = 0;
    redoStack.length = 0;
    invalidate();
    buildGrid();
    active = keep.active;
    extent = keep.extent;
    painted = { r1: 0, c1: 0, r2: -1, c2: -1 };
    clampSelection();
    paintSelection();
    renderTabs();
    showDocMeta();
    storageSet(DOC_PREFIX + doc.id, JSON.stringify(doc));
  }
  function hasUnsyncedChanges() {
    return saveTimer !== null || server.inflight || JSON.stringify(doc) !== server.synced;
  }
  // Picks up rows added by webhooks or edits made in another tab.
  async function pollServer(force) {
    if (server.available !== true || (document.hidden && !force) || editing || drag || hasUnsyncedChanges()) return;
    try {
      const v = await api("GET", docPath() + "/version");
      if (v.status !== 200 || !v.data || v.data.version <= server.version) return;
      const res = await api("GET", docPath());
      if (res.status !== 200 || !res.data || editing || drag || hasUnsyncedChanges()) return;
      applyRemote(res.data.doc, res.data.version, JSON.stringify(res.data.doc));
      setSaveState("All changes saved");
      toast("Sheet updated with the latest data");
    } catch {
      // Network hiccup: try again on the next tick.
    }
  }
  setInterval(pollServer, 4000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollServer(); });
  window.addEventListener("online", () => { if (server.available !== false && hasUnsyncedChanges()) syncToServer(); });

  // ---------------------------------------------------------------- undo
  function snapshot() {
    return JSON.stringify({ sheets: doc.sheets, active: doc.active });
  }
  function mutate(fn, opts) {
    if (readOnly()) return refuseReadOnly();
    // One serialisation per edit (for undo). Comparing a second copy to skip no-op edits cost more
    // than the rare empty undo step it avoids on large sheets.
    const before = snapshot();
    const sheetBefore = sheet;
    const lockedBefore = lockedSignature(sheet);
    fn();
    if (lockedBefore !== null && (!doc.sheets.includes(sheetBefore) || lockedSignature(sheetBefore) !== lockedBefore)) {
      restore(before);
      toast("That range is protected. Ask its owner or an admin to change it.");
      return;
    }
    undoStack.push(before);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    afterChange(opts);
  }
  function afterChange(opts) {
    invalidate();
    if (opts && opts.rebuild) buildGrid();
    else {
      renderAll();
      renderCharts();
    }
    paintSelection();
    if (opts && opts.tabs) renderTabs();
    scheduleSave();
  }
  function restore(json) {
    const o = JSON.parse(json);
    doc.sheets = o.sheets;
    doc.active = Math.min(o.active, doc.sheets.length - 1);
    sheet = doc.sheets[doc.active];
    invalidate();
    buildGrid();
    clampSelection();
    paintSelection();
    renderTabs();
    scheduleSave();
  }
  function undo() {
    if (editing) cancelEdit();
    if (!undoStack.length) return toast("Nothing to undo");
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }
  function redo() {
    if (editing) cancelEdit();
    if (!redoStack.length) return toast("Nothing to redo");
    undoStack.push(snapshot());
    restore(redoStack.pop());
  }

  // ---------------------------------------------------------------- grid DOM
  let tbodyRows = [];
  let theadCells = [];
  let lastRendered = new Set();

  function cellEl(r, c) {
    const tr = tbodyRows[r];
    return tr ? tr.cells[c + 1] : null;
  }
  // Sizes are built into HTML strings, so anything that is not a sane number falls back to the default.
  function sizeOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 4 && n <= 2000 ? n : fallback;
  }
  function colWidth(c) { return sizeOr(sheet.colW[c], DEFAULT_COL_W); }
  function rowHeight(r) { return sizeOr(sheet.rowH[r], DEFAULT_ROW_H); }

  // Only the rows near the viewport (plus frozen rows) exist in the DOM; spacer rows stand in for
  // the rest, so a sheet with thousands of rows stays as fast as a small one.
  const OVERSCAN = 30;
  let win = { r0: 0, r1: 0 };
  let rowTops = new Float64Array(1);
  let rowExtra = 1;
  let hiddenRows = new Set();
  let printing = false;

  function computeRowTops() {
    const n = sheet.rows;
    rowTops = new Float64Array(n + 1);
    for (let r = 0; r < n; r++) rowTops[r + 1] = rowTops[r] + (hiddenRows.has(r) ? 0 : rowHeight(r) + rowExtra);
  }
  function rowAt(y) {
    let lo = 0, hi = sheet.rows - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rowTops[mid + 1] <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  function rowHtml(r, emptyCells) {
    const h = sheet.rowH[r] ? rowHeight(r) : 0;
    return '<tr data-r="' + r + '"' + (hiddenRows.has(r) ? ' class="filtered"' : "") + (h ? ' style="height:' + h + 'px"' : "") + "><th>" + (r + 1) + '<span class="row-resize"></span></th>' + emptyCells + "</tr>";
  }
  function spacerHtml(height) {
    return height > 0 ? '<tr class="spacer" aria-hidden="true"><td colspan="' + (sheet.cols + 1) + '" style="height:' + height + 'px"></td></tr>' : "";
  }
  function renderWindow(force) {
    if (!sheet || !grid.tBodies[0]) return;
    const F = Math.min(sheet.freezeRows || 0, sheet.rows);
    let first, last;
    if (printing) {
      first = F;
      last = sheet.rows - 1;
    } else {
      const top = scroller.scrollTop / zoom;
      first = Math.max(F, rowAt(top + rowTops[F]));
      last = Math.max(first, rowAt(Math.min(rowTops[sheet.rows] - 0.5, top + scroller.clientHeight / zoom)));
    }
    const covered = first >= win.r0 && last < win.r1 && (first - win.r0 >= 10 || win.r0 <= F) && (win.r1 - last > 10 || win.r1 >= sheet.rows);
    if (!force && covered) return;
    const r0 = printing ? F : Math.max(F, first - OVERSCAN);
    const r1 = printing ? sheet.rows : Math.min(sheet.rows, last + OVERSCAN + 1);
    win = { r0, r1 };
    const emptyCells = "<td></td>".repeat(sheet.cols);
    const parts = [];
    for (let r = 0; r < F; r++) parts.push(rowHtml(r, emptyCells));
    parts.push(spacerHtml(rowTops[r0] - rowTops[F]));
    for (let r = r0; r < r1; r++) parts.push(rowHtml(r, emptyCells));
    parts.push(spacerHtml(rowTops[sheet.rows] - rowTops[r1]));
    const tbody = grid.tBodies[0];
    tbody.innerHTML = parts.join("");
    tbodyRows = [];
    for (const tr of tbody.rows) if (tr.dataset.r !== undefined) tbodyRows[+tr.dataset.r] = tr;
    lastRendered = new Set();
    applyMerges();
    renderCells();
    applyFreeze();
    painted = { r1: 0, c1: 0, r2: -1, c2: -1 };
    paintSelection();
    if (editing) positionEditor();
  }
  // Row height used for spacer maths = CSS height + the collapsed border; measured once per build.
  function calibrateRowExtra() {
    const tr = tbodyRows.find((row, r) => row && !sheet.rowH[r] && !hiddenRows.has(r));
    if (!tr) return false;
    const measured = Math.round((tr.getBoundingClientRect().height / zoom - DEFAULT_ROW_H) * 100) / 100;
    if (!(measured >= 0 && measured < 5) || Math.abs(measured - rowExtra) < 0.05) return false;
    rowExtra = measured;
    return true;
  }
  let windowFrame = 0;
  scroller.addEventListener("scroll", () => {
    if (windowFrame) return;
    windowFrame = requestAnimationFrame(() => {
      windowFrame = 0;
      renderWindow(false);
    });
  });
  window.addEventListener("resize", () => renderWindow(false));
  window.addEventListener("beforeprint", () => { printing = true; renderWindow(true); });
  window.addEventListener("afterprint", () => { printing = false; renderWindow(true); });

  function buildGrid() {
    frozenTop = [];
    frozenLeft = [];
    const cols = [];
    cols.push('<col style="width:' + ROW_HEADER_W + 'px">');
    for (let c = 0; c < sheet.cols; c++) cols.push('<col style="width:' + (isColHidden(c) ? 0 : colWidth(c)) + 'px">');
    const head = ['<thead><tr><th class="corner" title="Select all"></th>'];
    for (let c = 0; c < sheet.cols; c++) head.push("<th>" + colName(c) + '<span class="col-resize"></span></th>');
    head.push("</tr></thead>");
    grid.innerHTML = "<colgroup>" + cols.join("") + "</colgroup>" + head.join("") + "<tbody></tbody>";
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", sheet.name);
    grid.setAttribute("aria-rowcount", String(sheet.rows + 1));
    grid.setAttribute("aria-colcount", String(sheet.cols + 1));
    // Hidden columns keep a zero-width slot; their cells lose padding so nothing shows through.
    $("hidden-col-style").textContent = (sheet.hiddenCols || []).filter((c) => c < sheet.cols).map((c) => "#grid tr > :nth-child(" + (c + 2) + "){padding:0;font-size:0;border-left-color:#9aa0a6}").join("");
    setTableWidth();
    grid.classList.toggle("nogrid", sheet.gridlines === false);
    grid.style.zoom = zoom;
    theadCells = Array.from(grid.tHead.rows[0].cells);
    hiddenRows = computeHidden();
    computeRowTops();
    win = { r0: 0, r1: 0 };
    renderWindow(true);
    if (calibrateRowExtra()) {
      computeRowTops();
      renderWindow(true);
    }
    renderCharts();
  }
  // table-layout:fixed only honours <col> widths when the table itself has a width.
  function setTableWidth(override) {
    let w = ROW_HEADER_W;
    for (let c = 0; c < sheet.cols; c++) w += override && override.c === c ? override.w : isColHidden(c) ? 0 : colWidth(c);
    grid.style.width = w + "px";
  }
  function applyMerges() {
    for (const m of sheet.merges) {
      const anchor = cellEl(m.r1, m.c1);
      // A merge whose top row is scrolled out of the DOM is drawn as plain cells until it returns.
      if (!anchor) continue;
      // Never span into spacer rows: stop at the last row present in the DOM.
      let lastRow = m.r1;
      while (lastRow < m.r2 && tbodyRows[lastRow + 1]) lastRow++;
      anchor.rowSpan = lastRow - m.r1 + 1;
      anchor.colSpan = m.c2 - m.c1 + 1;
      for (let r = m.r1; r <= lastRow; r++) for (let c = m.c1; c <= m.c2; c++) {
        if (r === m.r1 && c === m.c1) continue;
        const td = cellEl(r, c);
        if (td) {
          td.dataset.covered = "1";
          td.className = "covered";
        }
      }
    }
  }
  function mergeAt(r, c) {
    return sheet.merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) || null;
  }
  let frozenTop = [];
  let frozenLeft = [];
  function applyFreeze() {
    frozenTop = [];
    frozenLeft = [];
    const headH = grid.tHead.rows[0].getBoundingClientRect().height / zoom;
    let top = headH;
    for (let r = 0; r < Math.min(sheet.freezeRows, sheet.rows); r++) {
      frozenTop[r] = top;
      top += tbodyRows[r] ? tbodyRows[r].getBoundingClientRect().height / zoom : 0;
    }
    let left = ROW_HEADER_W;
    for (let c = 0; c < Math.min(sheet.freezeCols, sheet.cols); c++) {
      frozenLeft[c] = left;
      left += isColHidden(c) ? 0 : colWidth(c);
    }
    for (let c = 0; c < sheet.cols; c++) {
      const th = theadCells[c + 1];
      th.classList.toggle("frozen-col", frozenLeft[c] !== undefined);
      th.style.left = frozenLeft[c] !== undefined ? frozenLeft[c] + "px" : "";
      if (frozenLeft[c] !== undefined && c === sheet.freezeCols - 1) th.style.borderRight = "3px solid #c4c7c5";
      else th.style.borderRight = "";
    }
    tbodyRows.forEach((tr, r) => {
      const th = tr.cells[0];
      th.style.top = frozenTop[r] !== undefined ? frozenTop[r] + "px" : "";
      th.style.zIndex = frozenTop[r] !== undefined ? "4" : "";
      th.style.borderBottom = frozenTop[r] !== undefined && r === sheet.freezeRows - 1 ? "3px solid #c4c7c5" : "";
      if (r >= sheet.freezeRows && sheet.freezeCols === 0) return;
      for (let c = 0; c < sheet.cols; c++) {
        if (r >= sheet.freezeRows && c >= sheet.freezeCols) break;
        renderCell(r, c);
      }
    });
  }

  function borderSide(r, c, side) {
    const own = sheet.cells[key(r, c)];
    const os = own && own.s;
    if (os && os[side]) return true;
    const nb = side === "bt" ? [r - 1, c, "bb"] : side === "bb" ? [r + 1, c, "bt"] : side === "bl" ? [r, c - 1, "br"] : [r, c + 1, "bl"];
    const n = sheet.cells[key(nb[0], nb[1])];
    return !!(n && n.s && n.s[nb[2]]);
  }

  function renderCell(r, c) {
    const td = cellEl(r, c);
    if (!td) return;
    const k = key(r, c);
    const cell = sheet.cells[k];
    const s = (cell && cell.s) || {};
    const covered = td.dataset.covered === "1";
    const v = safeCellValue(sheet, r, c);
    const fmt = effectiveFmt(cell);
    const text = formatValue(v, fmt, s.dec);
    const cls = [];
    if (covered) cls.push("covered");
    if (v instanceof FErr) cls.push("err");
    else if (typeof v === "number" && !s.ha) cls.push("num");
    else if (typeof v === "boolean" && !s.ha) cls.push("bool");
    if (s.wrap) cls.push("wrap");
    if (frozenTop[r] !== undefined) cls.push("frozen-row");
    if (frozenLeft[c] !== undefined) cls.push("frozen-col");
    if (sheet.filter && r === sheet.filter.r && c >= sheet.filter.c1 && c <= sheet.filter.c2) cls.push("filter-head");
    td.className = cls.join(" ");
    let css = "";
    if (s.b) css += "font-weight:700;";
    if (s.i) css += "font-style:italic;";
    const deco = (s.u ? "underline " : "") + (s.st ? "line-through" : "");
    const isLink = typeof v === "string" && (s.link || /^https?:\/\/\S+$/.test(v));
    if (deco || isLink) css += "text-decoration:" + (deco || "underline") + ";";
    if (safeColor(s.color)) css += "color:" + s.color + ";";
    else if (isLink) css += "color:#1155cc;";
    if (safeColor(s.bg)) css += "background-color:" + s.bg + ";";
    if (typeof s.font === "string" && /^[A-Za-z0-9 -]{1,40}$/.test(s.font)) css += "font-family:'" + s.font + "',Arial,sans-serif;";
    if (typeof s.size === "number" && s.size > 0 && s.size <= 400) css += "font-size:" + (s.size * 4 / 3).toFixed(2) + "px;";
    if (s.ha === "left" || s.ha === "center" || s.ha === "right") css += "text-align:" + s.ha + ";";
    if (s.va === "top" || s.va === "middle" || s.va === "bottom") css += "vertical-align:" + s.va + ";";
    for (const [side, prop] of [["bt", "top"], ["bb", "bottom"], ["bl", "left"], ["br", "right"]]) {
      if (borderSide(r, c, side)) css += "border-" + prop + "-color:#000;";
    }
    if (frozenTop[r] !== undefined) css += "top:" + frozenTop[r] + "px;";
    if (frozenLeft[c] !== undefined) css += "left:" + frozenLeft[c] + "px;";
    if (frozenTop[r] !== undefined && frozenLeft[c] !== undefined) css += "z-index:3;";
    if (sheet.freezeRows && r === sheet.freezeRows - 1) css += "border-bottom:3px solid #c4c7c5;";
    if (sheet.freezeCols && c === sheet.freezeCols - 1) css += "border-right:3px solid #c4c7c5;";
    const cf = condStyle(r, c, v);
    if (cf) {
      if (safeColor(cf.bg)) css += "background-color:" + cf.bg + ";";
      if (safeColor(cf.color)) css += "color:" + cf.color + ";";
    }
    td.style.cssText = css;
    // Left-aligned text spills into empty cells on its right, like Sheets.
    const spill = typeof v === "string" && text && !s.wrap && (!s.ha || s.ha === "left") && !covered && !td.classList.contains("filter-head") ? spillWidth(r, c) : 0;
    if (spill) {
      td.classList.add("spill");
      td.textContent = "";
      const span = document.createElement("span");
      span.className = "spill-text";
      span.style.width = colWidth(c) + spill - 6 + "px";
      span.textContent = text;
      td.appendChild(span);
    } else td.textContent = text;
    const rule = validationAt(r, c);
    const invalid = rule && text !== "" && !rule.list.some((item) => item.toLowerCase() === text.toLowerCase());
    const notes = [];
    if (v instanceof FErr) notes.push(v.code + " " + v.msg);
    if (invalid) notes.push("Invalid: must be one of " + rule.list.join(", "));
    if (cell && cell.note) notes.push(cell.note);
    td.title = notes.join("\n\n");
    if (v instanceof FErr || invalid) td.insertAdjacentHTML("beforeend", '<span class="err-flag"></span>');
    if (cell && cell.note) td.insertAdjacentHTML("beforeend", '<span class="note-flag"></span>');
    const threads = threadsAt(r, c);
    if (threads.length) {
      const open = threads.filter((th) => !th.resolved).length;
      td.insertAdjacentHTML("beforeend", '<span class="comment-flag' + (open ? "" : " resolved") + '"></span>');
      td.title = (td.title ? td.title + "\n\n" : "") + threads.length + " comment thread" + (threads.length === 1 ? "" : "s") + " (Ctrl+Alt+M to open)";
    }
    if (isLocked(r, c)) td.classList.add("locked");
    if (rule && !covered) td.insertAdjacentHTML("beforeend", '<button class="dv-btn" tabindex="-1" data-dv="1" aria-label="Choose a value">&#9662;</button>');
    if (td.classList.contains("filter-head")) {
      const on = sheet.filter.hide && sheet.filter.hide[c] && sheet.filter.hide[c].length;
      td.insertAdjacentHTML("beforeend", '<button class="filter-btn' + (on ? " on" : "") + '" data-filter-col="' + c + '" title="Filter">&#9660;</button>');
    }
    if (inRange(r, c)) applySelClass(td, r, c);
    if (cell || v !== null) lastRendered.add(k);
    else lastRendered.delete(k);
  }
  // Style values come from shared documents, so only plain hex colours reach the inline CSS.
  function safeColor(c) {
    return typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c);
  }
  // Width of the empty, visible cells to the right of (r, c) that its text may spill into.
  function spillWidth(r, c) {
    let w = 0;
    for (let n = c + 1; n < Math.min(sheet.cols, c + 20); n++) {
      // Hidden columns have no width: text flows across them, as in Sheets.
      if (isColHidden(n)) continue;
      const cell = sheet.cells[key(r, n)];
      if ((cell && cell.v !== "") || spillValues.has(sheet.id + "|" + r + "|" + n) || mergeAt(r, n) || validationAt(r, n) || (sheet.filter && r === sheet.filter.r)) break;
      w += colWidth(n);
    }
    return w;
  }
  // Re-renders cells that have content (or had it last time) and are currently in the DOM,
  // plus empty cells covered by dropdowns or conditional formats.
  function renderCells() {
    const keys = new Set(lastRendered);
    for (const k in sheet.cells) keys.add(k);
    ensureSpills(sheet);
    const prefix = sheet.id + "|";
    for (const sk of spillValues.keys()) {
      if (!sk.startsWith(prefix)) continue;
      const [r, c] = sk.slice(prefix.length).split("|");
      keys.add(r + ":" + c);
    }
    for (const k in sheet.comments || {}) keys.add(k);
    for (const rg of (sheet.validation || []).concat((sheet.condFormats || []).filter((x) => x.type === "empty"), lockedRules())) {
      tbodyRows.forEach((tr, r) => {
        if (r < rg.r1 || r > rg.r2) return;
        for (let c = rg.c1; c <= Math.min(rg.c2, sheet.cols - 1); c++) keys.add(key(r, c));
      });
    }
    for (const k of keys) {
      const i = k.indexOf(":");
      const r = +k.slice(0, i), c = +k.slice(i + 1);
      if (r < sheet.rows && c < sheet.cols && tbodyRows[r]) renderCell(r, c);
      else lastRendered.delete(k);
    }
  }
  function renderAll() {
    renderCells();
    applyFilter();
  }

  // ---------------------------------------------------------------- selection
  let painted = { r1: 0, c1: 0, r2: -1, c2: -1 };
  let fillHandle = null;
  function inRange(r, c) {
    return r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
  }
  function applySelClass(td, r, c) {
    const multi = range.r1 !== range.r2 || range.c1 !== range.c2;
    td.classList.toggle("sel", multi && !(r === active.r && c === active.c));
    td.classList.toggle("active", r === active.r && c === active.c);
    if (multi) {
      const blue = "#1a73e8";
      const sh = [];
      if (r === range.r1) sh.push("inset 0 1px 0 0 " + blue);
      if (r === range.r2 || (td.rowSpan > 1 && r + td.rowSpan - 1 >= range.r2)) sh.push("inset 0 -1px 0 0 " + blue);
      if (c === range.c1) sh.push("inset 1px 0 0 0 " + blue);
      if (c === range.c2 || (td.colSpan > 1 && c + td.colSpan - 1 >= range.c2)) sh.push("inset -1px 0 0 0 " + blue);
      td.style.boxShadow = sh.join(",");
    } else td.style.boxShadow = "";
  }
  function clampSelection() {
    const clampR = (r) => Math.max(0, Math.min(sheet.rows - 1, r));
    const clampC = (c) => Math.max(0, Math.min(sheet.cols - 1, c));
    active = { r: clampR(active.r), c: clampC(active.c) };
    extent = { r: clampR(extent.r), c: clampC(extent.c) };
    computeRange();
  }
  function computeRange() {
    let r1 = Math.min(active.r, extent.r), r2 = Math.max(active.r, extent.r);
    let c1 = Math.min(active.c, extent.c), c2 = Math.max(active.c, extent.c);
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of sheet.merges) {
        if (m.r2 < r1 || m.r1 > r2 || m.c2 < c1 || m.c1 > c2) continue;
        if (m.r1 < r1) { r1 = m.r1; changed = true; }
        if (m.r2 > r2) { r2 = m.r2; changed = true; }
        if (m.c1 < c1) { c1 = m.c1; changed = true; }
        if (m.c2 > c2) { c2 = m.c2; changed = true; }
      }
    }
    range = { r1, c1, r2, c2 };
  }
  function select(r, c, er, ec) {
    const m = mergeAt(r, c);
    if (m) { r = m.r1; c = m.c1; }
    active = { r, c };
    extent = er === undefined ? { r, c } : { r: er, c: ec };
    clampSelection();
    paintSelection();
  }
  function extendTo(r, c) {
    extent = { r, c };
    clampSelection();
    paintSelection();
  }
  function paintSelection() {
    tbodyRows.forEach((tr, r) => {
      if (r >= painted.r1 && r <= painted.r2) for (let c = painted.c1; c <= painted.c2; c++) {
        const td = tr.cells[c + 1];
        if (td && !inRange(r, c)) {
          td.classList.remove("sel", "active");
          td.style.boxShadow = "";
        }
      }
      if (r >= range.r1 && r <= range.r2) for (let c = range.c1; c <= range.c2; c++) {
        const td = tr.cells[c + 1];
        if (td) applySelClass(td, r, c);
      }
    });
    painted = Object.assign({}, range);
    // Headers
    const allRows = range.r1 === 0 && range.r2 === sheet.rows - 1;
    const allCols = range.c1 === 0 && range.c2 === sheet.cols - 1;
    for (let c = 0; c < sheet.cols; c++) {
      const th = theadCells[c + 1];
      th.classList.toggle("hsel", c >= range.c1 && c <= range.c2);
      th.classList.toggle("hall", allRows && c >= range.c1 && c <= range.c2);
    }
    tbodyRows.forEach((tr, r) => {
      const th = tr.cells[0];
      th.classList.toggle("hsel", r >= range.r1 && r <= range.r2);
      th.classList.toggle("hall", allCols && r >= range.r1 && r <= range.r2);
    });
    // Fill handle
    if (fillHandle) fillHandle.remove();
    const br = mergeAt(range.r2, range.c2);
    const corner = cellEl(br ? br.r1 : range.r2, br ? br.c1 : range.c2);
    if (corner) {
      fillHandle = document.createElement("div");
      fillHandle.className = "fill-handle";
      corner.appendChild(fillHandle);
    }
    nameBox.value = range.r1 === range.r2 && range.c1 === range.c2 ? addr(active.r, active.c) : addr(range.r1, range.c1) + ":" + addr(range.r2, range.c2);
    if (document.activeElement !== formulaInput) {
      const cell = sheet.cells[key(active.r, active.c)];
      formulaInput.value = cell ? displayRaw(cell) : "";
    }
    updateToolbarState();
    updateAggregate();
    announceSelection();
  }
  function displayRaw(cell) {
    const v = cell.v;
    if (isFormula(v) || v === "") return v;
    const s = cell.s || {};
    if (s.fmt === "date" || s.fmt === "datetime") {
      const n = parseFloat(v);
      if (!isNaN(n)) return s.fmt === "date" ? fmtDate(n) : fmtDateTime(n);
    }
    if (s.fmt === "percent") {
      const n = parseFloat(v);
      if (!isNaN(n) && String(n) === v.trim()) return parseFloat((n * 100).toPrecision(12)) + "%";
    }
    return v;
  }
  function ensureVisible(r, c) {
    if (!cellEl(r, c) && r >= (sheet.freezeRows || 0)) {
      // Row is not in the DOM yet: scroll by the row model, render that window, then fine-tune below.
      const F = Math.min(sheet.freezeRows || 0, sheet.rows);
      const top = rowTops[r] - rowTops[F];
      const viewH = scroller.clientHeight / zoom - grid.tHead.getBoundingClientRect().height / zoom - (rowTops[F]);
      const current = scroller.scrollTop / zoom;
      if (top < current) scroller.scrollTop = top * zoom;
      else if (top + rowHeight(r) > current + viewH) scroller.scrollTop = (top + rowHeight(r) + rowExtra - viewH) * zoom;
      renderWindow(false);
    }
    const td = cellEl(r, c);
    if (!td) return;
    const rect = td.getBoundingClientRect();
    const sc = scroller.getBoundingClientRect();
    let headH = grid.tHead.getBoundingClientRect().height;
    if (sheet.freezeRows && r >= sheet.freezeRows) headH = tbodyRows[sheet.freezeRows - 1].getBoundingClientRect().bottom - sc.top;
    let headW = theadCells[0].getBoundingClientRect().width;
    if (sheet.freezeCols && c >= sheet.freezeCols) headW = cellEl(0, sheet.freezeCols - 1).getBoundingClientRect().right - sc.left;
    const viewBottom = sc.top + scroller.clientHeight;
    const viewRight = sc.left + scroller.clientWidth;
    if (r >= sheet.freezeRows) {
      if (rect.top < sc.top + headH) scroller.scrollTop -= sc.top + headH - rect.top;
      else if (rect.bottom > viewBottom) scroller.scrollTop += rect.bottom - viewBottom;
    }
    if (c >= sheet.freezeCols) {
      if (rect.left < sc.left + headW) scroller.scrollLeft -= sc.left + headW - rect.left;
      else if (rect.right > viewRight) scroller.scrollLeft += Math.min(rect.right - viewRight, rect.left - sc.left - headW);
    }
  }
  function rowHidden(r) {
    return hiddenRows.has(r);
  }
  function moveFrom(pos, dr, dc) {
    let { r, c } = pos;
    const m = mergeAt(r, c);
    if (m) {
      if (dr > 0) r = m.r2;
      if (dc > 0) c = m.c2;
      if (dr < 0) r = m.r1;
      if (dc < 0) c = m.c1;
    }
    r += dr;
    c += dc;
    while (dr && r > 0 && r < sheet.rows - 1 && rowHidden(r)) r += dr;
    while (dc && c > 0 && c < sheet.cols - 1 && isColHidden(c)) c += dc;
    return { r: Math.max(0, Math.min(sheet.rows - 1, r)), c: Math.max(0, Math.min(sheet.cols - 1, c)) };
  }
  function hasValue(r, c) {
    const cell = sheet.cells[key(r, c)];
    return !!(cell && cell.v !== "");
  }
  function jumpFrom(pos, dr, dc) {
    let { r, c } = pos;
    const inside = (rr, cc) => rr >= 0 && rr < sheet.rows && cc >= 0 && cc < sheet.cols;
    if (!inside(r + dr, c + dc)) return pos;
    if (hasValue(r, c) && hasValue(r + dr, c + dc)) {
      while (inside(r + dr, c + dc) && hasValue(r + dr, c + dc)) { r += dr; c += dc; }
    } else {
      r += dr; c += dc;
      while (inside(r + dr, c + dc) && !hasValue(r, c)) { r += dr; c += dc; }
    }
    return { r, c };
  }
  function usedBounds() {
    let r2 = -1, c2 = -1;
    for (const k in sheet.cells) {
      if (sheet.cells[k].v === "") continue;
      const [r, c] = k.split(":").map(Number);
      if (r > r2) r2 = r;
      if (c > c2) c2 = c;
    }
    return { r2, c2 };
  }

  // ---------------------------------------------------------------- editing
  let editing = false;
  let editMode = "quick";
  let editAt = null;
  let refInsert = null;
  function startEdit(initial, mode) {
    if (readOnly()) return refuseReadOnly();
    if (editing) return;
    const m = mergeAt(active.r, active.c);
    const td = cellEl(active.r, active.c);
    if (!td) return;
    editing = true;
    editMode = mode || (initial === undefined ? "full" : "quick");
    editAt = { r: active.r, c: active.c };
    const cell = sheet.cells[key(active.r, active.c)];
    editor.value = initial !== undefined ? initial : cell ? displayRaw(cell) : "";
    const s = (cell && cell.s) || {};
    editor.style.fontWeight = s.b ? "700" : "";
    editor.style.fontStyle = s.i ? "italic" : "";
    editor.style.fontFamily = s.font ? "'" + s.font + "',Arial,sans-serif" : "";
    editor.style.fontSize = ((s.size || 10) * 4 / 3 * zoom).toFixed(2) + "px";
    editor.style.textAlign = s.ha || "left";
    editor.style.color = s.color || "";
    editor.style.backgroundColor = s.bg || "#fff";
    positionEditor(m ? m : null);
    editor.style.display = "block";
    editor.focus({ preventScroll: true });
    const len = editor.value.length;
    editor.setSelectionRange(len, len);
    formulaInput.value = editor.value;
    refInsert = null;
  }
  function positionEditor() {
    const td = cellEl(editAt.r, editAt.c);
    // Scrolled out of the rendered rows: the editor lives in the scrolled content and stays put.
    if (!td) return;
    const rect = td.getBoundingClientRect();
    const sc = scroller.getBoundingClientRect();
    editor.style.left = rect.left - sc.left + scroller.scrollLeft - 1 + "px";
    editor.style.top = rect.top - sc.top + scroller.scrollTop - 1 + "px";
    editor.style.minWidth = rect.width + 2 + "px";
    editor.style.minHeight = rect.height + 2 + "px";
    editor.style.width = rect.width + 2 + "px";
    editor.style.height = rect.height + 2 + "px";
    autosizeEditor();
  }
  function autosizeEditor() {
    editor.style.width = "0px";
    editor.style.width = Math.min(Math.max(parseFloat(editor.style.minWidth), editor.scrollWidth + 8), scroller.clientWidth - 20) + "px";
    editor.style.height = "0px";
    editor.style.height = Math.max(parseFloat(editor.style.minHeight), editor.scrollHeight + 4) + "px";
  }
  function commitEdit(dr, dc) {
    if (!editing) return;
    const raw = editor.value;
    const at = editAt;
    endEdit();
    writeCells([[at.r, at.c, raw]]);
    if (dr || dc) {
      const next = moveFrom(at, dr || 0, dc || 0);
      select(next.r, next.c);
      ensureVisible(next.r, next.c);
    }
  }
  function cancelEdit() {
    if (!editing) return;
    endEdit();
    paintSelection();
  }
  function endEdit() {
    editing = false;
    refInsert = null;
    editor.style.display = "none";
    editor.value = "";
    focusGrid();
  }
  function setRaw(r, c, raw) {
    const k = key(r, c);
    let cell = sheet.cells[k];
    if (raw === "" || raw === null || raw === undefined) {
      if (cell) {
        cell.v = "";
        if (!cell.s || !Object.keys(cell.s).length) delete sheet.cells[k];
      }
      return;
    }
    const det = detectInput(String(raw));
    if (!cell) cell = sheet.cells[k] = { v: "" };
    cell.v = det.v;
    if (det.fmt) {
      cell.s = cell.s || {};
      if (!cell.s.fmt || cell.s.fmt === "auto") cell.s.fmt = det.fmt;
    }
  }
  function writeCells(list) {
    const rejected = validationError(list);
    if (rejected) return toast(rejected);
    mutate(() => {
      for (const [r, c, raw] of list) {
        if (r >= sheet.rows) growRows(r + 1 - sheet.rows);
        setRaw(r, c, raw);
      }
    }, { rebuild: list.some(([r]) => r >= sheet.rows) });
  }
  function growRows(n) {
    sheet.rows += n;
  }
  function editorIsFormulaRefPoint() {
    if (!editing || editor.value[0] !== "=") return false;
    if (refInsert && editor.selectionStart === refInsert.end) return true;
    const before = editor.value.slice(0, editor.selectionStart);
    return /[=(,+\-*/&<>^:;]\s*$/.test(before);
  }
  function insertRef(r1, c1, r2, c2) {
    const text = r1 === r2 && c1 === c2 ? addr(r1, c1) : addr(Math.min(r1, r2), Math.min(c1, c2)) + ":" + addr(Math.max(r1, r2), Math.max(c1, c2));
    let start = editor.selectionStart;
    let end = editor.selectionEnd;
    if (refInsert && refInsert.end === start) start = refInsert.start;
    editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
    refInsert = { start, end: start + text.length, r: r1, c: c1 };
    editor.setSelectionRange(refInsert.end, refInsert.end);
    formulaInput.value = editor.value;
    autosizeEditor();
  }

  editor.addEventListener("input", () => {
    formulaInput.value = editor.value;
    refInsert = refInsert && editor.selectionStart === refInsert.end ? refInsert : null;
    autosizeEditor();
  });
  editor.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "Enter" && (e.altKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const p = editor.selectionStart;
      editor.value = editor.value.slice(0, p) + "\n" + editor.value.slice(editor.selectionEnd);
      editor.setSelectionRange(p + 1, p + 1);
      autosizeEditor();
      return;
    }
    if (k === "Enter") { e.preventDefault(); commitEdit(e.shiftKey ? -1 : 1, 0); return; }
    if (k === "Tab") { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1); return; }
    if (k === "Escape") { e.preventDefault(); cancelEdit(); return; }
    if (editMode === "quick" && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k) && !e.shiftKey) {
      if (editorIsFormulaRefPoint()) {
        e.preventDefault();
        const base = refInsert ? { r: refInsert.r, c: refInsert.c } : { r: editAt.r, c: editAt.c };
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
        const n = moveFrom(base, d[0], d[1]);
        insertRef(n.r, n.c, n.r, n.c);
        return;
      }
      e.preventDefault();
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
      commitEdit(d[0], d[1]);
    }
  });
  formulaInput.addEventListener("focus", () => {
    if (editing) return;
    const cell = sheet.cells[key(active.r, active.c)];
    formulaInput.value = cell ? displayRaw(cell) : "";
    formulaInput.dataset.at = active.r + ":" + active.c;
  });
  formulaInput.addEventListener("input", () => {
    if (editing) {
      editor.value = formulaInput.value;
      autosizeEditor();
    }
  });
  formulaInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (editing) { editor.value = formulaInput.value; commitEdit(e.key === "Tab" ? 0 : 1, e.key === "Tab" ? 1 : 0); return; }
      const [r, c] = (formulaInput.dataset.at || active.r + ":" + active.c).split(":").map(Number);
      writeCells([[r, c, formulaInput.value]]);
      const n = moveFrom({ r, c }, e.key === "Tab" ? 0 : 1, e.key === "Tab" ? 1 : 0);
      select(n.r, n.c);
      ensureVisible(n.r, n.c);
      focusGrid();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (editing) cancelEdit();
      paintSelection();
      focusGrid();
    }
  });
  formulaInput.addEventListener("blur", () => {
    if (!editing) {
      const cell = sheet.cells[key(active.r, active.c)];
      formulaInput.value = cell ? displayRaw(cell) : "";
    }
  });
  nameBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const parts = nameBox.value.trim().split(":");
      const a = parseAddr(parts[0]);
      const b = parts[1] ? parseAddr(parts[1]) : a;
      if (!a || !b) { toast("Invalid cell reference"); paintSelection(); return; }
      const need = Math.max(a.r, b.r) + 1;
      if (need > sheet.rows || Math.max(a.c, b.c) >= sheet.cols) {
        mutate(() => {
          sheet.rows = Math.max(sheet.rows, need);
          sheet.cols = Math.max(sheet.cols, Math.max(a.c, b.c) + 1);
        }, { rebuild: true });
      }
      select(a.r, a.c, b.r, b.c);
      ensureVisible(a.r, a.c);
      focusGrid();
    } else if (e.key === "Escape") {
      paintSelection();
      focusGrid();
    }
  });
  nameBox.addEventListener("focus", () => nameBox.select());

  function focusGrid() {
    if (document.activeElement !== sink) sink.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- formatting
  function forRange(fn) {
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) fn(r, c);
  }
  function styleOf(r, c) {
    const cell = sheet.cells[key(r, c)];
    return (cell && cell.s) || {};
  }
  function setStyle(patch) {
    mutate(() => {
      forRange((r, c) => {
        const k = key(r, c);
        const cell = sheet.cells[k] || (sheet.cells[k] = { v: "" });
        const s = Object.assign({}, cell.s || {}, patch);
        for (const p in s) if (s[p] === null || s[p] === undefined || s[p] === false) delete s[p];
        cell.s = s;
        if (!Object.keys(s).length) delete cell.s;
        if (cell.v === "" && !cell.s) delete sheet.cells[k];
      });
    });
  }
  function toggleStyle(prop) {
    setStyle({ [prop]: !styleOf(active.r, active.c)[prop] });
  }
  function setFormat(fmt) {
    setStyle({ fmt: fmt === "auto" ? null : fmt, dec: null });
  }
  function changeDecimals(delta) {
    const s = styleOf(active.r, active.c);
    let cur = s.dec;
    if (cur === undefined) {
      if (s.fmt && s.fmt !== "auto") cur = 2;
      else {
        const v = safeCellValue(sheet, active.r, active.c);
        const t = typeof v === "number" ? autoNum(v) : "";
        cur = t.includes(".") ? t.split(".")[1].length : 0;
      }
    }
    const next = Math.max(0, Math.min(10, cur + delta));
    setStyle({ dec: next, fmt: s.fmt && s.fmt !== "auto" ? s.fmt : "number" });
  }
  function changeSize(delta) {
    const cur = styleOf(active.r, active.c).size || 10;
    const sizes = [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36];
    let next;
    if (delta > 0) next = sizes.find((x) => x > cur) || cur + 2;
    else next = sizes.slice().reverse().find((x) => x < cur) || Math.max(1, cur - 1);
    setStyle({ size: next === 10 ? null : next });
  }
  function setBorders(kind) {
    mutate(() => {
      forRange((r, c) => {
        const k = key(r, c);
        const cell = sheet.cells[k] || (sheet.cells[k] = { v: "" });
        const s = Object.assign({}, cell.s || {});
        const top = r === range.r1, bottom = r === range.r2, left = c === range.c1, right = c === range.c2;
        if (kind === "none") { delete s.bt; delete s.bb; delete s.bl; delete s.br; }
        if (kind === "all") { s.bt = s.bb = s.bl = s.br = true; }
        if (kind === "outer") { if (top) s.bt = true; if (bottom) s.bb = true; if (left) s.bl = true; if (right) s.br = true; }
        if (kind === "inner") { if (!bottom) s.bb = true; if (!right) s.br = true; }
        if (kind === "top" && top) s.bt = true;
        if (kind === "bottom" && bottom) s.bb = true;
        if (kind === "left" && left) s.bl = true;
        if (kind === "right" && right) s.br = true;
        if (kind === "none") {
          // also clear neighbours that draw onto this range's outer edge
          const clearN = (rr, cc, p) => { const n = sheet.cells[key(rr, cc)]; if (n && n.s) delete n.s[p]; };
          if (top) clearN(r - 1, c, "bb");
          if (bottom) clearN(r + 1, c, "bt");
          if (left) clearN(r, c - 1, "br");
          if (right) clearN(r, c + 1, "bl");
        }
        cell.s = s;
        if (!Object.keys(s).length) delete cell.s;
        if (cell.v === "" && !cell.s) delete sheet.cells[k];
      });
    });
    // borders affect neighbours' rendering
    for (let r = range.r1 - 1; r <= range.r2 + 1; r++) for (let c = range.c1 - 1; c <= range.c2 + 1; c++) if (r >= 0 && c >= 0) renderCell(r, c);
    paintSelection();
  }
  function clearFormatting() {
    mutate(() => {
      forRange((r, c) => {
        const k = key(r, c);
        const cell = sheet.cells[k];
        if (!cell) return;
        delete cell.s;
        if (cell.v === "") delete sheet.cells[k];
      });
    });
  }
  function toggleMerge() {
    const existing = sheet.merges.filter((m) => !(m.r2 < range.r1 || m.r1 > range.r2 || m.c2 < range.c1 || m.c1 > range.c2));
    if (existing.length) {
      mutate(() => { sheet.merges = sheet.merges.filter((m) => !existing.includes(m)); }, { rebuild: true });
      return;
    }
    if (range.r1 === range.r2 && range.c1 === range.c2) return toast("Select more than one cell to merge");
    let extra = 0;
    forRange((r, c) => { if ((r !== range.r1 || c !== range.c1) && hasValue(r, c)) extra++; });
    if (extra && !confirm("Merging cells only keeps the top-left value. Continue?")) return;
    mutate(() => {
      forRange((r, c) => { if (r !== range.r1 || c !== range.c1) delete sheet.cells[key(r, c)]; });
      sheet.merges.push(Object.assign({}, range));
    }, { rebuild: true });
    select(range.r1, range.c1, range.r2, range.c2);
  }
  function updateToolbarState() {
    const s = styleOf(active.r, active.c);
    $("tb-bold").classList.toggle("active", !!s.b);
    $("tb-italic").classList.toggle("active", !!s.i);
    $("tb-underline").classList.toggle("active", !!s.u);
    $("tb-strike").classList.toggle("active", !!s.st);
    $("tb-wrap").classList.toggle("active", !!s.wrap);
    $("tb-merge").classList.toggle("active", !!mergeAt(active.r, active.c));
    $("tb-filter").classList.toggle("active", !!sheet.filter);
    $("text-swatch").style.background = s.color || "#000";
    $("fill-swatch").style.background = s.bg || "#fff";
    $("font-family").value = s.font || "Arial";
    if (document.activeElement !== $("font-size")) $("font-size").value = s.size || 10;
    $("paint-btn").classList.toggle("active", !!paintFormat);
  }

  // ---------------------------------------------------------------- aggregate footer
  const AGG = ["Sum", "Average", "Min", "Max", "Count", "Count numbers"];
  function updateAggregate() {
    const btn = $("agg");
    const cells = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1);
    if (cells < 2 || cells > 200000) { btn.classList.remove("show"); return; }
    const vals = [];
    let count = 0;
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) {
      if (!sheet.cells[key(r, c)]) continue;
      const v = safeCellValue(sheet, r, c);
      if (v === null || v === "") continue;
      count++;
      if (typeof v === "number") vals.push(v);
    }
    if (!vals.length && aggMode !== 4) { btn.classList.remove("show"); return; }
    const sum = vals.reduce((a, b) => a + b, 0);
    const out = [sum, vals.length ? sum / vals.length : 0, vals.length ? Math.min.apply(null, vals) : 0, vals.length ? Math.max.apply(null, vals) : 0, count, vals.length][aggMode];
    const fmt = effectiveFmt(sheet.cells[key(active.r, active.c)]);
    btn.textContent = AGG[aggMode] + ": " + (aggMode >= 4 ? out : formatValue(out, fmt === "date" || fmt === "datetime" || fmt === "text" ? "auto" : fmt, styleOf(active.r, active.c).dec));
    btn.classList.add("show");
  }
  $("agg").addEventListener("click", () => {
    aggMode = (aggMode + 1) % AGG.length;
    updateAggregate();
  });

  // ---------------------------------------------------------------- clipboard
  function selectionMatrix() {
    const rows = [];
    for (let r = range.r1; r <= range.r2; r++) {
      if (rowHidden(r)) continue;
      const row = [];
      for (let c = range.c1; c <= range.c2; c++) {
        const cell = sheet.cells[key(r, c)];
        row.push(cell ? clone(cell) : null);
      }
      rows.push(row);
    }
    return rows;
  }
  function selectionText() {
    const lines = [];
    for (let r = range.r1; r <= range.r2; r++) {
      if (rowHidden(r)) continue;
      const parts = [];
      for (let c = range.c1; c <= range.c2; c++) {
        const cell = sheet.cells[key(r, c)];
        let t = formatValue(safeCellValue(sheet, r, c), effectiveFmt(cell), cell && cell.s ? cell.s.dec : undefined);
        if (/[\t\n"]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"';
        parts.push(t);
      }
      lines.push(parts.join("\t"));
    }
    return lines.join("\n");
  }
  function doCopy(cut) {
    const text = selectionText();
    clipboard = { cells: selectionMatrix(), r: range.r1, c: range.c1, text, cut, sheet };
    return text;
  }
  function parseDelimited(text, delim) {
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += ch;
      } else if (ch === '"' && field === "") q = true;
      else if (ch === delim) { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function pasteAt(text, valuesOnly) {
    const internal = clipboard && clipboard.text === text.replace(/\r\n/g, "\n").replace(/\n$/, "");
    const r0 = range.r1, c0 = range.c1;
    if (internal) {
      const src = clipboard;
      const h = src.cells.length, w = src.cells[0] ? src.cells[0].length : 0;
      // Paste repeats to fill a larger selection that is a multiple of the copied block.
      const selH = range.r2 - range.r1 + 1, selW = range.c2 - range.c1 + 1;
      const reps = selH % h === 0 && selW % w === 0 ? [selH / h, selW / w] : [1, 1];
      mutate(() => {
        if (src.cut) {
          for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) delete src.sheet.cells[key(src.r + i, src.c + j)];
        }
        for (let ry = 0; ry < reps[0]; ry++) for (let rx = 0; rx < reps[1]; rx++) {
          for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
            const r = r0 + ry * h + i, c = c0 + rx * w + j;
            if (c >= sheet.cols) continue;
            if (r >= sheet.rows) sheet.rows = r + 1;
            const cell = src.cells[i][j];
            const k = key(r, c);
            if (!cell) {
              if (valuesOnly) { if (sheet.cells[k]) setRaw(r, c, ""); }
              else delete sheet.cells[k];
              continue;
            }
            if (valuesOnly) {
              const v = cellValueAt(src.sheet, cell, src.r + i, src.c + j);
              const target = sheet.cells[k] || (sheet.cells[k] = { v: "" });
              target.v = v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : v instanceof FErr ? v.code : String(v);
            } else {
              const nc = clone(cell);
              if (isFormula(nc.v) && !src.cut) nc.v = shiftFormula(nc.v, r - (src.r + i), c - (src.c + j));
              sheet.cells[k] = nc;
            }
          }
        }
      }, { rebuild: true });
      if (src.cut) clipboard = null;
      select(r0, c0, r0 + h * reps[0] - 1, Math.min(sheet.cols - 1, c0 + w * reps[1] - 1));
      return;
    }
    const delim = text.includes("\t") ? "\t" : text.includes("\n") ? "\t" : "\t";
    const rows = parseDelimited(text.replace(/\n$/, ""), delim);
    if (!rows.length) return;
    const list = [];
    rows.forEach((row, i) => row.forEach((v, j) => { if (c0 + j < sheet.cols) list.push([r0 + i, c0 + j, v]); }));
    writeCells(list);
    select(r0, c0, r0 + rows.length - 1, Math.min(sheet.cols - 1, c0 + Math.max.apply(null, rows.map((r) => r.length)) - 1));
  }
  function cellValueAt(sh, cell, r, c) {
    return safeCellValue(sh, r, c);
  }
  function gridHasFocus() {
    return document.activeElement === sink;
  }
  document.addEventListener("copy", (e) => {
    if (!gridHasFocus()) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", doCopy(false));
  });
  document.addEventListener("cut", (e) => {
    if (!gridHasFocus()) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", doCopy(true));
  });
  let pasteValuesOnly = false;
  let pasteFallback = null;
  document.addEventListener("paste", (e) => {
    if (!gridHasFocus()) return;
    e.preventDefault();
    clearTimeout(pasteFallback);
    pasteAt(e.clipboardData.getData("text/plain"), pasteValuesOnly);
    pasteValuesOnly = false;
  });
  // Some environments deliver Ctrl+C / Ctrl+V keys without native clipboard events;
  // keep an internal copy and fall back to it when no paste event follows.
  function keyCopy(cut) {
    doCopy(cut);
  }
  function keyPaste(valuesOnly) {
    pasteValuesOnly = valuesOnly;
    clearTimeout(pasteFallback);
    pasteFallback = setTimeout(() => {
      if (clipboard) pasteAt(clipboard.text, pasteValuesOnly);
      pasteValuesOnly = false;
    }, 80);
  }
  async function menuCopy(cut) {
    const text = doCopy(cut);
    try { await navigator.clipboard.writeText(text); } catch { /* internal clipboard still works */ }
    toast(cut ? "Cut " + (clipboard.cells.length) + " row(s)" : "Copied");
  }
  async function menuPaste(valuesOnly) {
    try {
      const text = await navigator.clipboard.readText();
      pasteAt(text, valuesOnly);
    } catch {
      if (clipboard) pasteAt(clipboard.text, valuesOnly);
      else toast("Use Ctrl+V to paste from the system clipboard");
    }
  }

  // ---------------------------------------------------------------- structural edits
  function shiftKeys(obj, axis, at, count) {
    const out = {};
    for (const k in obj) {
      let r, c;
      if (axis === "both") continue;
      if (k.includes(":")) { [r, c] = k.split(":").map(Number); } else { r = c = +k; }
      const v = axis === "row" ? r : c;
      if (count < 0 && v >= at && v < at - count) continue;
      const nv = v >= at ? v + count : v;
      if (k.includes(":")) out[axis === "row" ? key(nv, c) : key(r, nv)] = obj[k];
      else out[nv] = obj[k];
    }
    return out;
  }
  function insertRows(at, n) {
    mutate(() => {
      rewriteForStructure(sheet, "row", at, n);
      sheet.cells = shiftKeys(sheet.cells, "row", at, n);
      sheet.rowH = shiftKeys(sheet.rowH, "row", at, n);
      sheet.merges.forEach((m) => { if (m.r1 >= at) { m.r1 += n; m.r2 += n; } else if (m.r2 >= at) m.r2 += n; });
      if (sheet.filter && sheet.filter.r >= at) sheet.filter.r += n;
      if (sheet.filter && sheet.filter.r2 >= at) sheet.filter.r2 += n;
      sheet.rows += n;
    }, { rebuild: true });
  }
  function deleteRows(at, n) {
    if (n >= sheet.rows) return toast("Can't delete all rows of a sheet");
    mutate(() => {
      rewriteForStructure(sheet, "row", at, -n);
      sheet.cells = shiftKeys(sheet.cells, "row", at, -n);
      sheet.rowH = shiftKeys(sheet.rowH, "row", at, -n);
      sheet.merges = sheet.merges.filter((m) => !(m.r1 >= at && m.r2 < at + n)).map((m) => {
        const f = (v, end) => (v < at ? v : v >= at + n ? v - n : end ? at - 1 : at);
        return Object.assign({}, m, { r1: f(m.r1, false), r2: f(m.r2, true) });
      }).filter((m) => m.r2 > m.r1 || m.c2 > m.c1);
      if (sheet.filter && sheet.filter.r >= at && sheet.filter.r < at + n) sheet.filter = null;
      sheet.rows -= n;
    }, { rebuild: true });
    clampSelection();
    paintSelection();
  }
  function insertCols(at, n) {
    mutate(() => {
      rewriteForStructure(sheet, "col", at, n);
      sheet.cells = shiftKeys(sheet.cells, "col", at, n);
      sheet.colW = shiftKeys(sheet.colW, "col", at, n);
      sheet.merges.forEach((m) => { if (m.c1 >= at) { m.c1 += n; m.c2 += n; } else if (m.c2 >= at) m.c2 += n; });
      if (sheet.filter) { if (sheet.filter.c1 >= at) sheet.filter.c1 += n; if (sheet.filter.c2 >= at) sheet.filter.c2 += n; sheet.filter.hide = shiftKeys(sheet.filter.hide || {}, "col", at, n); }
      sheet.cols += n;
    }, { rebuild: true });
  }
  function deleteCols(at, n) {
    if (n >= sheet.cols) return toast("Can't delete all columns of a sheet");
    mutate(() => {
      rewriteForStructure(sheet, "col", at, -n);
      sheet.cells = shiftKeys(sheet.cells, "col", at, -n);
      sheet.colW = shiftKeys(sheet.colW, "col", at, -n);
      sheet.merges = sheet.merges.filter((m) => !(m.c1 >= at && m.c2 < at + n)).map((m) => {
        const f = (v, end) => (v < at ? v : v >= at + n ? v - n : end ? at - 1 : at);
        return Object.assign({}, m, { c1: f(m.c1, false), c2: f(m.c2, true) });
      }).filter((m) => m.r2 > m.r1 || m.c2 > m.c1);
      if (sheet.filter) sheet.filter = null;
      sheet.cols -= n;
    }, { rebuild: true });
    clampSelection();
    paintSelection();
  }
  function clearValues() {
    mutate(() => forRange((r, c) => setRaw(r, c, "")));
  }
  function fill(dir) {
    const list = [];
    if (dir === "down") {
      const r0 = range.r1;
      for (let c = range.c1; c <= range.c2; c++) {
        const src = sheet.cells[key(r0, c)];
        for (let r = r0 + 1; r <= range.r2; r++) list.push([r, c, src ? (isFormula(src.v) ? shiftFormula(src.v, r - r0, 0) : src.v) : "", src && src.s]);
      }
    } else {
      const c0 = range.c1;
      for (let r = range.r1; r <= range.r2; r++) {
        const src = sheet.cells[key(r, c0)];
        for (let c = c0 + 1; c <= range.c2; c++) list.push([r, c, src ? (isFormula(src.v) ? shiftFormula(src.v, 0, c - c0) : src.v) : "", src && src.s]);
      }
    }
    if (!list.length) return;
    mutate(() => {
      for (const [r, c, v, s] of list) {
        if (v === "" && !s) { delete sheet.cells[key(r, c)]; continue; }
        sheet.cells[key(r, c)] = s ? { v, s: clone(s) } : { v };
      }
    });
  }
  // Drag-fill: repeats the source block, continuing simple numeric series.
  function fillFromHandle(src, target) {
    const vertical = target.r2 !== src.r2 || target.r1 !== src.r1;
    const rowsBefore = sheet.rows;
    mutate(() => {
      if (vertical) {
        const h = src.r2 - src.r1 + 1;
        for (let c = src.c1; c <= src.c2; c++) {
          const series = numericSeries(src.r1, src.r2, c, true);
          for (let r = target.r1; r <= target.r2; r++) {
            if (r >= src.r1 && r <= src.r2) continue;
            const off = r - src.r1;
            const sr = src.r1 + (((off % h) + h) % h);
            const s = sheet.cells[key(sr, c)];
            if (r >= sheet.rows) sheet.rows = r + 1;
            if (series) { sheet.cells[key(r, c)] = { v: String(series.start + series.step * off), s: s && s.s ? clone(s.s) : undefined }; if (!s || !s.s) delete sheet.cells[key(r, c)].s; continue; }
            if (!s) { delete sheet.cells[key(r, c)]; continue; }
            const nc = clone(s);
            if (isFormula(nc.v)) nc.v = shiftFormula(nc.v, r - sr, 0);
            sheet.cells[key(r, c)] = nc;
          }
        }
      } else {
        const w = src.c2 - src.c1 + 1;
        for (let r = src.r1; r <= src.r2; r++) {
          const series = numericSeries(src.c1, src.c2, r, false);
          for (let c = target.c1; c <= target.c2; c++) {
            if (c >= src.c1 && c <= src.c2) continue;
            const off = c - src.c1;
            const sc = src.c1 + (((off % w) + w) % w);
            const s = sheet.cells[key(r, sc)];
            if (series) { sheet.cells[key(r, c)] = { v: String(series.start + series.step * off) }; if (s && s.s) sheet.cells[key(r, c)].s = clone(s.s); continue; }
            if (!s) { delete sheet.cells[key(r, c)]; continue; }
            const nc = clone(s);
            if (isFormula(nc.v)) nc.v = shiftFormula(nc.v, 0, c - sc);
            sheet.cells[key(r, c)] = nc;
          }
        }
      }
    }, { rebuild: target.r2 >= rowsBefore });
    select(target.r1, target.c1, target.r2, target.c2);
  }
  function numericSeries(a, b, fixed, vertical) {
    if (b - a < 1) return null;
    const vals = [];
    for (let i = a; i <= b; i++) {
      const cell = sheet.cells[vertical ? key(i, fixed) : key(fixed, i)];
      if (!cell || isFormula(cell.v)) return null;
      const v = literalValue(cell.v, cell.s);
      if (typeof v !== "number") return null;
      vals.push(v);
    }
    const step = vals[1] - vals[0];
    for (let i = 2; i < vals.length; i++) if (Math.abs(vals[i] - vals[i - 1] - step) > 1e-9) return null;
    return { start: vals[0], step };
  }

  // ---------------------------------------------------------------- data tools
  function sortRows(r1, r2, c1, c2, byCol, asc) {
    mutate(() => {
      const rows = [];
      for (let r = r1; r <= r2; r++) {
        const cells = [];
        for (let c = c1; c <= c2; c++) cells.push(sheet.cells[key(r, c)] || null);
        rows.push({ v: safeCellValue(sheet, r, byCol), cells });
      }
      rows.sort((x, y) => {
        const a = x.v, b = y.v;
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        const d = compare(a, b, "<") ? -1 : compare(a, b, ">") ? 1 : 0;
        return asc ? d : -d;
      });
      rows.forEach((row, i) => row.cells.forEach((cell, j) => {
        const k = key(r1 + i, c1 + j);
        if (cell) sheet.cells[k] = cell; else delete sheet.cells[k];
      }));
    });
  }
  function sortSheet(asc) {
    const { r2, c2 } = usedBounds();
    if (r2 < 0) return;
    sortRows(sheet.freezeRows, r2, 0, Math.max(c2, active.c), active.c, asc);
  }
  function sortRange(asc) {
    if (range.r1 === range.r2) return toast("Select more than one row to sort a range");
    sortRows(range.r1, range.r2, range.c1, range.c2, active.c, asc);
  }
  function removeDuplicates() {
    const seen = new Set();
    const keep = [];
    let removed = 0;
    for (let r = range.r1; r <= range.r2; r++) {
      const sig = [];
      for (let c = range.c1; c <= range.c2; c++) sig.push(str(safeCellValueText(r, c)));
      const s = sig.join("\u0001");
      if (seen.has(s)) { removed++; continue; }
      seen.add(s);
      const row = [];
      for (let c = range.c1; c <= range.c2; c++) row.push(sheet.cells[key(r, c)] || null);
      keep.push(row);
    }
    mutate(() => {
      for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) {
        const i = r - range.r1;
        const cell = keep[i] ? keep[i][c - range.c1] : null;
        if (cell) sheet.cells[key(r, c)] = cell; else delete sheet.cells[key(r, c)];
      }
    });
    toast(removed + " duplicate row" + (removed === 1 ? "" : "s") + " removed");
  }
  function safeCellValueText(r, c) {
    const v = safeCellValue(sheet, r, c);
    return v instanceof FErr ? v.code : v;
  }
  function trimWhitespace() {
    let n = 0;
    mutate(() => forRange((r, c) => {
      const cell = sheet.cells[key(r, c)];
      if (!cell || isFormula(cell.v)) return;
      const t = cell.v.trim().replace(/\s+/g, " ");
      if (t !== cell.v) { cell.v = t; n++; }
    }));
    toast(n + " cell" + (n === 1 ? "" : "s") + " trimmed");
  }
  function splitToColumns() {
    const sep = prompt("Split text using separator (leave empty to detect comma / semicolon / space):", "");
    if (sep === null) return;
    const list = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const cell = sheet.cells[key(r, active.c)];
      if (!cell || isFormula(cell.v)) continue;
      const d = sep || (cell.v.includes(",") ? "," : cell.v.includes(";") ? ";" : " ");
      cell.v.split(d).forEach((part, j) => { if (active.c + j < sheet.cols) list.push([r, active.c + j, part.trim()]); });
    }
    writeCells(list);
  }

  // Filters
  function toggleFilter() {
    if (sheet.filter) {
      mutate(() => { sheet.filter = null; }, { rebuild: true });
      return;
    }
    let r = range.r1, c1 = range.c1, c2 = range.c2, r2 = range.r2;
    if (range.r1 === range.r2 && range.c1 === range.c2) {
      const b = usedBounds();
      if (b.r2 < 0) return toast("Add some data first, then create a filter");
      r = 0; c1 = 0; c2 = b.c2; r2 = b.r2;
    }
    mutate(() => { sheet.filter = { r, c1, c2, r2, hide: {} }; }, { rebuild: true });
  }
  function computeHidden() {
    const hidden = new Set((sheet.hiddenRowsList || []).filter((r) => r < sheet.rows));
    const f = sheet.filter;
    if (!f || !f.hide || !Object.values(f.hide).some((list) => list && list.length)) return hidden;
    const last = Math.max(f.r2, usedBounds().r2);
    for (let r = f.r + 1; r <= last && r < sheet.rows; r++) {
      for (const c in f.hide) {
        const list = f.hide[c];
        if (!list || !list.length) continue;
        const cell = sheet.cells[key(r, +c)];
        const t = cell ? formatValue(safeCellValue(sheet, r, +c), effectiveFmt(cell), (cell.s || {}).dec) : "";
        if (list.includes(t)) { hidden.add(r); break; }
      }
    }
    return hidden;
  }
  // Recomputes which rows the filter hides; re-renders only when that set changed.
  function applyFilter() {
    const next = computeHidden();
    if (next.size === hiddenRows.size && [...next].every((r) => hiddenRows.has(r))) return;
    hiddenRows = next;
    computeRowTops();
    renderWindow(true);
  }
  function openFilterMenu(c, anchorEl) {
    const f = sheet.filter;
    const last = Math.max(f.r2, usedBounds().r2);
    const values = new Map();
    for (let r = f.r + 1; r <= last; r++) {
      const cell = sheet.cells[key(r, c)];
      const t = cell ? formatValue(safeCellValue(sheet, r, c), effectiveFmt(cell), (cell.s || {}).dec) : "";
      values.set(t, (values.get(t) || 0) + 1);
    }
    const hidden = new Set((f.hide && f.hide[c]) || []);
    const pop = openPopup(anchorEl, "popup filter-pop");
    const sorted = Array.from(values.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    pop.innerHTML =
      '<button class="item" data-a="asc"><span class="label">Sort A &rarr; Z</span></button>' +
      '<button class="item" data-a="desc"><span class="label">Sort Z &rarr; A</span></button>' +
      '<div class="divider"></div><div class="links"><button data-a="all">Select all</button><button data-a="none">Clear</button></div>' +
      '<div class="vals">' + sorted.map((v, i) => '<label><input type="checkbox" data-i="' + i + '"' + (hidden.has(v) ? "" : " checked") + "> " + (v === "" ? "<i>(Blanks)</i>" : escapeHtml(v)) + "</label>").join("") + "</div>" +
      '<div class="actions" style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="ok">OK</button></div>';
    pop.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]");
      if (!a) return;
      const act = a.dataset.a;
      const boxes = pop.querySelectorAll("input[type=checkbox]");
      if (act === "all") boxes.forEach((b) => (b.checked = true));
      if (act === "none") boxes.forEach((b) => (b.checked = false));
      if (act === "cancel") closePopups();
      if (act === "asc" || act === "desc") {
        closePopups();
        sortRows(f.r + 1, last, f.c1, f.c2, c, act === "asc");
      }
      if (act === "ok") {
        const hide = [];
        boxes.forEach((b) => { if (!b.checked) hide.push(sorted[+b.dataset.i]); });
        closePopups();
        mutate(() => { sheet.filter.hide = Object.assign({}, sheet.filter.hide, { [c]: hide }); });
      }
    });
  }

  // ---------------------------------------------------------------- sheets
  function renderTabs() {
    const tabs = $("tabs");
    tabs.innerHTML = "";
    doc.sheets.forEach((s, i) => {
      const b = document.createElement("button");
      b.className = "tab" + (i === doc.active ? " active" : "");
      b.type = "button";
      b.innerHTML = "<span>" + escapeHtml(s.name) + '</span><span class="tab-caret" data-tab-menu="' + i + '"></span>';
      b.addEventListener("click", (e) => {
        if (e.target.dataset.tabMenu !== undefined) { switchSheet(i); openTabMenu(i, b); return; }
        switchSheet(i);
      });
      b.addEventListener("dblclick", () => renameSheetInline(i, b));
      b.addEventListener("contextmenu", (e) => { e.preventDefault(); switchSheet(i); openTabMenu(i, b); });
      tabs.appendChild(b);
    });
  }
  function switchSheet(i) {
    if (editing) commitEdit();
    if (i === doc.active) return;
    doc.active = i;
    sheet = doc.sheets[i];
    active = { r: 0, c: 0 };
    extent = { r: 0, c: 0 };
    painted = { r1: 0, c1: 0, r2: -1, c2: -1 };
    buildGrid();
    computeRange();
    paintSelection();
    renderTabs();
    scroller.scrollTo(0, 0);
    scheduleSave();
    focusGrid();
  }
  function uniqueSheetName(base) {
    let n = doc.sheets.length + 1;
    let name = base || "Sheet" + n;
    while (sheetByName(name)) name = (base || "Sheet") + (base ? " " : "") + ++n;
    return name;
  }
  function addSheet(sh) {
    mutate(() => {
      doc.sheets.splice(doc.active + 1, 0, sh || newSheet(uniqueSheetName()));
    }, { tabs: true });
    switchSheet(doc.active + 1);
  }
  function renameSheet(i, name) {
    name = name.trim();
    const old = doc.sheets[i].name;
    if (!name || name === old) return;
    if (sheetByName(name) && sheetByName(name) !== doc.sheets[i]) return toast("A sheet named \"" + name + "\" already exists");
    mutate(() => {
      renameSheetRefs(old, name);
      doc.sheets[i].name = name;
    }, { tabs: true });
  }
  function renameSheetInline(i, btn) {
    const input = document.createElement("input");
    input.className = "tab-rename";
    input.value = doc.sheets[i].name;
    btn.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) renameSheet(i, input.value);
      renderTabs();
      focusGrid();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
      e.stopPropagation();
    });
    input.addEventListener("blur", () => finish(true));
  }
  function openTabMenu(i, anchor) {
    showMenu(anchor, [
      { label: "Delete", action: () => deleteSheet(i), disabled: () => doc.sheets.length < 2 },
      { label: "Duplicate", action: () => { const c = clone(doc.sheets[i]); c.id = uid(); c.name = uniqueSheetName("Copy of " + doc.sheets[i].name); addSheet(c); } },
      { label: "Rename", action: () => renameSheetInline(i, $("tabs").children[i]) },
      { sep: true },
      { label: "Move right", disabled: () => i >= doc.sheets.length - 1, action: () => moveSheet(i, 1) },
      { label: "Move left", disabled: () => i === 0, action: () => moveSheet(i, -1) },
    ], "up");
  }
  function moveSheet(i, d) {
    mutate(() => {
      const [s] = doc.sheets.splice(i, 1);
      doc.sheets.splice(i + d, 0, s);
      doc.active = i + d;
    }, { tabs: true });
  }
  function deleteSheet(i) {
    if (doc.sheets.length < 2) return;
    if (!confirm("Delete sheet \"" + doc.sheets[i].name + "\"? You can undo this with Ctrl+Z.")) return;
    mutate(() => {
      doc.sheets.splice(i, 1);
      doc.active = Math.min(doc.active, doc.sheets.length - 1);
      sheet = doc.sheets[doc.active];
    }, { rebuild: true, tabs: true });
    select(0, 0);
  }

  // ---------------------------------------------------------------- popups and menus
  const layer = $("popup-layer");
  let openMenuBtn = null;
  function closePopups() {
    layer.innerHTML = "";
    if (openMenuBtn) openMenuBtn.classList.remove("open");
    openMenuBtn = null;
  }
  function openPopup(anchor, className, where) {
    closePopups();
    const pop = document.createElement("div");
    pop.className = className || "popup";
    layer.appendChild(pop);
    requestAnimationFrame(() => placePopup(pop, anchor, where));
    placePopup(pop, anchor, where);
    return pop;
  }
  function placePopup(pop, anchor, where) {
    let x, y;
    if (anchor && anchor.getBoundingClientRect) {
      const r = anchor.getBoundingClientRect();
      x = r.left;
      y = where === "up" ? r.top - pop.offsetHeight - 4 : r.bottom + 2;
    } else { x = anchor.x; y = anchor.y; }
    const w = pop.offsetWidth, h = pop.offsetHeight;
    if (x + w > window.innerWidth - 8) x = Math.max(8, window.innerWidth - w - 8);
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
    pop.style.left = x + "px";
    pop.style.top = y + "px";
  }
  function showMenu(anchor, items, where) {
    const pop = openPopup(anchor, "popup", where);
    for (const it of items) {
      if (it.sep) { pop.insertAdjacentHTML("beforeend", '<div class="divider"></div>'); continue; }
      if (it.heading) { pop.insertAdjacentHTML("beforeend", '<div class="heading">' + escapeHtml(it.heading) + "</div>"); continue; }
      const b = document.createElement("button");
      b.className = "item";
      b.type = "button";
      const checked = it.checked && it.checked();
      b.innerHTML = '<span class="check">' + (checked ? "&#10003;" : "") + '</span><span class="label">' + it.label + "</span>" + (it.kbd ? '<span class="kbd">' + it.kbd + "</span>" : "");
      if (it.disabled && it.disabled()) b.disabled = true;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        closePopups();
        it.action();
        if (!editing && !document.querySelector(".dialog")) focusGrid();
      });
      pop.appendChild(b);
    }
    placePopup(pop, anchor, where);
    return pop;
  }
  document.addEventListener("mousedown", (e) => {
    if (layer.contains(e.target)) return;
    if (e.target.closest && e.target.closest(".menu-btn, [data-menu], .filter-btn, .dv-btn")) return;
    if (layer.children.length) closePopups();
  });

  const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const sel1 = () => range.r1 === range.r2 && range.c1 === range.c2;
  const rowsLabel = () => (range.r2 > range.r1 ? "rows " + (range.r1 + 1) + " - " + (range.r2 + 1) : "row " + (range.r1 + 1));
  const colsLabel = () => (range.c2 > range.c1 ? "columns " + colName(range.c1) + " - " + colName(range.c2) : "column " + colName(range.c1));
  const fmtItems = () => [
    { label: "Automatic", checked: () => !styleOf(active.r, active.c).fmt, action: () => setFormat("auto") },
    { label: "Plain text", checked: () => styleOf(active.r, active.c).fmt === "text", action: () => setFormat("text") },
    { sep: true },
    { label: "Number <span class=kbd>1,000.12</span>", checked: () => styleOf(active.r, active.c).fmt === "number", action: () => setFormat("number"), kbd: MOD + "Shift+1" },
    { label: "Percent <span class=kbd>10.12%</span>", checked: () => styleOf(active.r, active.c).fmt === "percent", action: () => setFormat("percent"), kbd: MOD + "Shift+5" },
    { label: "Scientific <span class=kbd>1.01E+03</span>", checked: () => styleOf(active.r, active.c).fmt === "sci", action: () => setFormat("sci") },
    { sep: true },
    { label: "Currency <span class=kbd>$1,000.12</span>", checked: () => styleOf(active.r, active.c).fmt === "currency", action: () => setFormat("currency"), kbd: MOD + "Shift+4" },
    { sep: true },
    { label: "Date <span class=kbd>9/26/2008</span>", checked: () => styleOf(active.r, active.c).fmt === "date", action: () => setFormat("date") },
    { label: "Date time <span class=kbd>9/26/2008 15:59:00</span>", checked: () => styleOf(active.r, active.c).fmt === "datetime", action: () => setFormat("datetime") },
  ];
  const FUNCTION_QUICK = ["SUM", "AVERAGE", "COUNT", "MAX", "MIN"];
  function insertFunction(name) {
    if (editing) commitEdit();
    const multi = !sel1();
    const arg = multi ? addr(range.r1, range.c1) + ":" + addr(range.r2, range.c2) : "";
    if (multi) {
      // Put the result just below a vertical selection, like Sheets' quick-sum.
      const r = range.r2 + 1, c = range.c1;
      if (r >= sheet.rows) insertRows(sheet.rows, 1);
      select(r, c);
      ensureVisible(r, c);
    }
    startEdit("=" + name + "(" + arg + ")", "full");
    if (!multi) editor.setSelectionRange(editor.value.length - 1, editor.value.length - 1);
  }

  // ---------------------------------------------------------------- version history
  function fmtWhen(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }
  async function openHistory() {
    if (server.available !== true) return toast("Version history needs the workspace server");
    let res;
    try { res = await api("GET", docPath() + "/history"); } catch { return toast("Server unreachable"); }
    const versions = (res.data && res.data.versions) || [];
    openDialog(
      "<h2>Version history</h2><p class=\"note\">A snapshot is kept at most every 5 minutes while people edit (newest 200 kept). Restoring creates a new version; nothing is lost.</p>" +
        '<div class="history-list">' + (versions.length ? versions.map((v) =>
          '<div class="history-row"><div><strong>' + escapeHtml(fmtWhen(v.updatedAt)) + "</strong><span>Version " + v.version + (v.updatedBy ? " · " + escapeHtml(v.updatedBy) : "") + (v.version === server.version ? " · current" : "") + '</span></div><button class="btn" data-restore="' + v.version + '"' + (readOnly() ? " disabled" : "") + ">Restore</button></div>").join("") : '<p class="note">No snapshots yet. They are made as the sheet is saved.</p>') + "</div>" +
        '<div class="actions"><button class="btn primary" data-close>Close</button></div>',
      (dlg, close) => dlg.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-restore]");
        if (!b) return;
        const version = +b.dataset.restore;
        if (!confirm("Restore version " + version + "? The current version stays in the history.")) return;
        const snap = await api("GET", docPath() + "/history/" + version);
        if (snap.status !== 200) return toast("Couldn't load that version");
        const restored = snap.data.doc;
        restored.id = doc.id;
        const put = await api("PUT", docPath(), { baseVersion: server.version, doc: restored, restoredFrom: version });
        if (put.status !== 200) return toast(put.status === 409 ? "Someone changed the sheet meanwhile; try again" : "Restore failed: " + ((put.data && put.data.error) || put.status));
        close();
        applyRemote(restored, put.data.version, JSON.stringify(restored));
        toast("Restored version " + version);
      })
    );
  }

  // ---------------------------------------------------------------- data sources, sharing
  async function openDataSources() {
    let status = null;
    try { status = (await api("GET", "/api/webhooks/status")).data; } catch { /* offline */ }
    if (!status) return toast("Data source settings need the workspace server");
    const url = location.origin + "/api/webhooks/ingest/<source>";
    openDialog(
      "<h2>Data sources</h2>" +
        '<p class="note"><strong>Webhook (n8n or any HTTP client):</strong> ' + (status.enabled ? "enabled" : "disabled — an admin must set WEBHOOK_SECRET") + "</p>" +
        '<p class="note">POST JSON to <code>' + escapeHtml(url) + "</code> with <code>Authorization: Bearer &lt;secret&gt;</code>. Add <code>?dryRun=1</code> to test without saving. Records appear in the <a href=\"/editor?id=" + encodeURIComponent(status.documentId) + "\">Webhook leads</a> spreadsheet; every call is logged in its <em>Sync runs</em> and <em>Sync errors</em> tabs.</p>" +
        '<p class="note"><strong>Grist forwarding:</strong> ' + (status.grist.enabled ? "on (table " + escapeHtml(status.grist.table) + ")" : "off") + "</p>" +
        '<p class="note"><strong>Meta Lead Ads direct:</strong> ' + (status.meta.enabled ? "on at <code>" + escapeHtml(location.origin + status.meta.path) + "</code>" + (status.meta.fetchesLeadFields ? ", form answers fetched automatically" : ", lead ids only (no META_ACCESS_TOKEN)") : "off") + "</p>" +
        '<div class="actions"><button class="btn" id="ds-copy">Copy webhook URL</button><button class="btn primary" data-close>Close</button></div>',
      (dlg) => dlg.querySelector("#ds-copy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(url); toast("Copied"); } catch { toast(url); }
      })
    );
  }
  function openShare() {
    const link = location.origin + "/editor?id=" + doc.id;
    openDialog(
      "<h2>Share “" + escapeHtml(doc.title) + "”</h2>" +
        '<p class="note">' + (server.available === true
          ? "Everyone who can sign in to this workspace can open this spreadsheet: admins and editors can change it, viewers can only read. Admins add people and set their role on the admin page."
          : "This spreadsheet is only saved in this browser right now, so the link works only here. Download it to give the data to someone else.") + "</p>" +
        '<div class="row"><input type="text" id="sh-link" readonly></div>' +
        '<div class="actions">' + (me.role === "admin" ? '<button class="btn" id="sh-people">Manage people</button>' : "") + '<button class="btn" id="sh-xlsx">Download .xlsx</button><button class="btn" id="sh-copy">Copy link</button><button class="btn primary" data-close>Done</button></div>',
      (dlg, close) => {
        const input = dlg.querySelector("#sh-link");
        input.value = link;
        input.addEventListener("focus", () => input.select());
        dlg.querySelector("#sh-copy").addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(link); toast("Link copied"); } catch { input.select(); toast("Press Ctrl+C to copy"); }
        });
        dlg.querySelector("#sh-xlsx").addEventListener("click", () => { close(); exportXlsx(); });
        const people = dlg.querySelector("#sh-people");
        if (people) people.addEventListener("click", () => window.open("/control#users", "_blank"));
      }
    );
  }

  // ---------------------------------------------------------------- notes
  function editNote() {
    const cell = sheet.cells[key(active.r, active.c)];
    openDialog(
      "<h2>Note for " + addr(active.r, active.c) + '</h2><div class="row"><textarea id="note-text" rows="5" maxlength="2000" style="flex:1;font:inherit;padding:8px;border:1px solid #c4c7c5;border-radius:4px"></textarea></div>' +
        '<div class="actions"><button class="btn" id="note-del">Delete note</button><button class="btn" data-close>Cancel</button><button class="btn primary" id="note-ok">Save</button></div>',
      (dlg, close) => {
        const ta = dlg.querySelector("#note-text");
        ta.value = (cell && cell.note) || "";
        ta.focus();
        const save = (text) => {
          close();
          mutate(() => {
            const k = key(active.r, active.c);
            const c = sheet.cells[k] || (sheet.cells[k] = { v: "" });
            if (text) c.note = text;
            else delete c.note;
            if (c.v === "" && !c.s && !c.note) delete sheet.cells[k];
          });
        };
        dlg.querySelector("#note-ok").addEventListener("click", () => save(ta.value.trim()));
        dlg.querySelector("#note-del").addEventListener("click", () => save(""));
      }
    );
  }

  // ---------------------------------------------------------------- data validation (dropdown lists)
  function rangeContains(rg, r, c) {
    return r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2;
  }
  function validationAt(r, c) {
    const rules = sheet.validation || [];
    for (let i = rules.length - 1; i >= 0; i--) if (rangeContains(rules[i], r, c)) return rules[i];
    return null;
  }
  function cellText(r, c) {
    const cell = sheet.cells[key(r, c)];
    return cell ? formatValue(safeCellValue(sheet, r, c), effectiveFmt(cell), (cell.s || {}).dec) : "";
  }
  // Returns the first rejected write as "A1: value", or null when every write is allowed.
  function validationError(list) {
    for (const [r, c, raw] of list) {
      const rule = validationAt(r, c);
      if (!rule || !rule.strict || raw === "" || raw === null || raw === undefined) continue;
      if (!rule.list.some((item) => item.toLowerCase() === String(raw).trim().toLowerCase())) return addr(r, c) + " must be one of: " + rule.list.join(", ");
    }
    return null;
  }
  function openValidation() {
    const existing = validationAt(active.r, active.c);
    const rg = existing || range;
    openDialog(
      "<h2>Data validation</h2>" +
        '<div class="row"><label>Range</label><input type="text" id="dv-range"></div>' +
        '<div class="row"><label>Allowed values</label><input type="text" id="dv-list" placeholder="New, Called, Won, Lost"></div>' +
        '<div class="row"><label></label><span><input type="checkbox" id="dv-strict"> <label for="dv-strict" style="width:auto">Reject other values (otherwise show a warning)</label></span></div>' +
        '<p class="note">Cells in the range get a dropdown (click it or press Alt+Down).</p>' +
        '<div class="actions">' + (existing ? '<button class="btn" id="dv-remove">Remove rule</button>' : "") + '<button class="btn" data-close>Cancel</button><button class="btn primary" id="dv-ok">Save</button></div>',
      (dlg, close) => {
        dlg.querySelector("#dv-range").value = addr(rg.r1, rg.c1) + ":" + addr(rg.r2, rg.c2);
        dlg.querySelector("#dv-list").value = existing ? existing.list.join(", ") : "";
        dlg.querySelector("#dv-strict").checked = existing ? !!existing.strict : true;
        dlg.querySelector("#dv-list").focus();
        const remove = dlg.querySelector("#dv-remove");
        if (remove) remove.addEventListener("click", () => {
          close();
          mutate(() => { sheet.validation = (sheet.validation || []).filter((x) => x !== existing && !same(x, existing)); });
        });
        dlg.querySelector("#dv-ok").addEventListener("click", () => {
          const parts = dlg.querySelector("#dv-range").value.trim().split(":");
          const a = parseAddr(parts[0]), b = parts[1] ? parseAddr(parts[1]) : a;
          const list = dlg.querySelector("#dv-list").value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 500);
          if (!a || !b) return toast("Enter a range like D2:D500");
          if (!list.length) return toast("Enter at least one allowed value");
          close();
          const rule = { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c), list, strict: dlg.querySelector("#dv-strict").checked };
          mutate(() => {
            sheet.validation = (sheet.validation || []).filter((x) => !(existing && same(x, existing)));
            sheet.validation.push(rule);
          });
        });
      }
    );
  }
  function openDropdown(r, c, anchor) {
    const rule = validationAt(r, c);
    if (!rule) return;
    if (readOnly()) return refuseReadOnly();
    select(r, c);
    showMenu(anchor, rule.list.map((item) => ({ label: escapeHtml(item), checked: () => cellText(r, c) === item, action: () => writeCells([[r, c, item]]) }))
      .concat([{ sep: true }, { label: "Clear", action: () => writeCells([[r, c, ""]]) }]));
  }

  // ---------------------------------------------------------------- conditional formatting
  const CF_TYPES = [["gt", "Greater than"], ["lt", "Less than"], ["eq", "Equal to"], ["neq", "Not equal to"], ["contains", "Text contains"], ["empty", "Is empty"], ["notEmpty", "Is not empty"]];
  function condMatches(rule, v) {
    const empty = v === null || v === "" || v === undefined;
    if (rule.type === "empty") return empty;
    if (rule.type === "notEmpty") return !empty;
    if (empty || v instanceof FErr) return false;
    const target = rule.value;
    const n = Number(target);
    const numeric = typeof v === "number" && target !== "" && !isNaN(n);
    switch (rule.type) {
      case "gt": return numeric ? v > n : String(v).toLowerCase() > String(target).toLowerCase();
      case "lt": return numeric ? v < n : String(v).toLowerCase() < String(target).toLowerCase();
      case "eq": return numeric ? v === n : String(v).toLowerCase() === String(target).toLowerCase();
      case "neq": return numeric ? v !== n : String(v).toLowerCase() !== String(target).toLowerCase();
      case "contains": return String(v).toLowerCase().includes(String(target).toLowerCase());
    }
    return false;
  }
  function condStyle(r, c, v) {
    const rules = sheet.condFormats;
    if (!rules || !rules.length) return null;
    for (const rule of rules) if (rangeContains(rule, r, c) && condMatches(rule, v)) return rule;
    return null;
  }
  const CF_PRESETS = [["#b7e1cd", "#0d652d", "Green"], ["#f4c7c3", "#a50e0e", "Red"], ["#fce8b2", "#7a4f01", "Yellow"], ["#c6dafc", "#174ea6", "Blue"], ["#e6e6e6", "#202124", "Grey"]];
  function openCondFormat() {
    const rules = sheet.condFormats || [];
    const describe = (x) => addr(x.r1, x.c1) + ":" + addr(x.r2, x.c2) + " · " + (CF_TYPES.find((t) => t[0] === x.type) || ["", x.type])[1] + (x.type === "empty" || x.type === "notEmpty" ? "" : " " + escapeHtml(String(x.value)));
    openDialog(
      "<h2>Conditional formatting</h2>" +
        '<div class="history-list">' + (rules.length ? rules.map((x, i) => '<div class="history-row"><div><span class="cf-swatch" style="background:' + (safeColor(x.bg) ? x.bg : "#fff") + ";color:" + (safeColor(x.color) ? x.color : "#000") + '">Aa</span> ' + describe(x) + '</div><button class="btn" data-del="' + i + '">Delete</button></div>').join("") : '<p class="note">No rules on this sheet yet.</p>') + "</div>" +
        "<h3 style=\"font-weight:500;margin:16px 0 8px\">Add a rule</h3>" +
        '<div class="row"><label>Range</label><input type="text" id="cf-range"></div>' +
        '<div class="row"><label>Format if</label><select id="cf-type" style="flex:1;height:34px">' + CF_TYPES.map((t) => '<option value="' + t[0] + '">' + t[1] + "</option>").join("") + "</select></div>" +
        '<div class="row"><label>Value</label><input type="text" id="cf-value"></div>' +
        '<div class="row"><label>Style</label><select id="cf-style" style="flex:1;height:34px">' + CF_PRESETS.map((p, i) => '<option value="' + i + '">' + p[2] + "</option>").join("") + "</select></div>" +
        '<div class="actions"><button class="btn" data-close>Close</button><button class="btn primary" id="cf-add">Add rule</button></div>',
      (dlg, close) => {
        dlg.querySelector("#cf-range").value = addr(range.r1, range.c1) + ":" + addr(range.r2, range.c2);
        dlg.addEventListener("click", (e) => {
          const del = e.target.closest("[data-del]");
          if (!del) return;
          close();
          mutate(() => { sheet.condFormats.splice(+del.dataset.del, 1); });
          openCondFormat();
        });
        dlg.querySelector("#cf-add").addEventListener("click", () => {
          const parts = dlg.querySelector("#cf-range").value.trim().split(":");
          const a = parseAddr(parts[0]), b = parts[1] ? parseAddr(parts[1]) : a;
          if (!a || !b) return toast("Enter a range like E2:E500");
          const preset = CF_PRESETS[+dlg.querySelector("#cf-style").value];
          const rule = { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c), type: dlg.querySelector("#cf-type").value, value: dlg.querySelector("#cf-value").value.trim(), bg: preset[0], color: preset[1] };
          close();
          mutate(() => { (sheet.condFormats = sheet.condFormats || []).push(rule); });
        });
      }
    );
  }

  // ---------------------------------------------------------------- hidden rows and columns
  function isColHidden(c) {
    return !!(sheet.hiddenCols && sheet.hiddenCols.includes(c));
  }
  function hideRows(r1, r2) {
    mutate(() => {
      const set = new Set(sheet.hiddenRowsList || []);
      for (let r = r1; r <= r2; r++) set.add(r);
      if (set.size >= sheet.rows) return toast("Can't hide every row");
      sheet.hiddenRowsList = [...set].sort((a, b) => a - b);
    }, { rebuild: true });
  }
  function hideCols(c1, c2) {
    mutate(() => {
      const set = new Set(sheet.hiddenCols || []);
      for (let c = c1; c <= c2; c++) set.add(c);
      if (set.size >= sheet.cols) return toast("Can't hide every column");
      sheet.hiddenCols = [...set].sort((a, b) => a - b);
    }, { rebuild: true });
  }
  function unhide(rows, r1, r2) {
    mutate(() => {
      const prop = rows ? "hiddenRowsList" : "hiddenCols";
      sheet[prop] = (sheet[prop] || []).filter((x) => x < r1 - 1 || x > r2 + 1);
      if (!sheet[prop].length) delete sheet[prop];
    }, { rebuild: true });
  }
  function hasHidden() {
    return !!((sheet.hiddenRowsList && sheet.hiddenRowsList.length) || (sheet.hiddenCols && sheet.hiddenCols.length));
  }

  // ---------------------------------------------------------------- charts
  const CHART_COLORS = ["#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6", "#7baaf7", "#f07b72"];
  const chartLayer = document.createElement("div");
  chartLayer.className = "chart-layer";
  $("grid-wrap").appendChild(chartLayer);
  const label = (v) => (v === null || v === undefined ? "" : v instanceof FErr ? v.code : str(v));
  function chartData(ch) {
    const rg = ch.range;
    const rows = [];
    for (let r = rg.r1; r <= rg.r2; r++) {
      const row = [];
      for (let c = rg.c1; c <= rg.c2; c++) row.push(safeCellValue(sheet, r, c));
      rows.push(row);
    }
    const width = rg.c2 - rg.c1 + 1;
    const labelCol = width > 1 && rows.some((row) => row[0] !== null && typeof row[0] !== "number");
    const first = labelCol ? 1 : 0;
    const header = rows.length > 1 && rows[0].slice(first).some((v) => v !== null && typeof v !== "number");
    const body = header ? rows.slice(1) : rows;
    const series = [];
    for (let j = first; j < width; j++) {
      series.push({ name: header ? label(rows[0][j]) : colName(rg.c1 + j), values: body.map((row) => (typeof row[j] === "number" ? row[j] : 0)) });
    }
    const labels = body.map((row, i) => (labelCol ? label(row[0]) : String(i + 1)));
    return { labels, series };
  }
  function svgText(x, y, text, attrs) {
    return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" ' + (attrs || "") + ">" + escapeHtml(text) + "</text>";
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }
  function drawChart(ch, w, h) {
    const { labels, series } = chartData(ch);
    if (!series.length || !labels.length) return svgText(w / 2, h / 2, "Select numbers to chart", 'text-anchor="middle" class="muted"');
    const out = [];
    const legendH = series.length > 1 || ch.type === "pie" ? 22 : 0;
    if (ch.type === "pie") {
      const vals = series[0].values.map((v) => Math.max(0, v));
      const total = vals.reduce((a, b) => a + b, 0) || 1;
      const cx = w / 2, cy = (h - legendH) / 2 + 4, rad = Math.max(10, Math.min(w, h - legendH) / 2 - 16);
      let angle = -Math.PI / 2;
      vals.forEach((v, i) => {
        const sweep = (v / total) * Math.PI * 2;
        const x1 = cx + rad * Math.cos(angle), y1 = cy + rad * Math.sin(angle);
        const x2 = cx + rad * Math.cos(angle + sweep), y2 = cy + rad * Math.sin(angle + sweep);
        const large = sweep > Math.PI ? 1 : 0;
        out.push(sweep >= Math.PI * 2 - 1e-9
          ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + rad + '" fill="' + CHART_COLORS[i % 8] + '"/>'
          : '<path d="M' + cx + "," + cy + " L" + x1.toFixed(1) + "," + y1.toFixed(1) + " A" + rad + "," + rad + " 0 " + large + " 1 " + x2.toFixed(1) + "," + y2.toFixed(1) + ' Z" fill="' + CHART_COLORS[i % 8] + '" stroke="#fff"><title>' + escapeHtml(labels[i] + ": " + autoNum(v) + " (" + Math.round((v / total) * 100) + "%)") + "</title></path>");
        if (sweep > 0.3) {
          const mid = angle + sweep / 2;
          out.push(svgText(cx + rad * 0.62 * Math.cos(mid), cy + rad * 0.62 * Math.sin(mid) + 4, Math.round((v / total) * 100) + "%", 'text-anchor="middle" fill="#fff" font-size="11"'));
        }
        angle += sweep;
      });
      let lx = 8;
      labels.slice(0, 8).forEach((label, i) => {
        out.push('<rect x="' + lx + '" y="' + (h - 15) + '" width="10" height="10" fill="' + CHART_COLORS[i % 8] + '"/>' + svgText(lx + 14, h - 6, label.slice(0, 14), 'font-size="11"'));
        lx += 24 + Math.min(14, label.length) * 6.2;
      });
      return out.join("");
    }
    const all = series.flatMap((s) => s.values);
    const max = niceMax(Math.max(0, ...all));
    const min = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(0, ...all)) : 0;
    const left = 44, right = 10, top = 10, bottom = 26 + legendH;
    const pw = Math.max(10, w - left - right), ph = Math.max(10, h - top - bottom);
    const y = (v) => top + ph - ((v - min) / (max - min)) * ph;
    for (let i = 0; i <= 4; i++) {
      const v = min + ((max - min) * i) / 4;
      out.push('<line x1="' + left + '" x2="' + (left + pw) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="#e0e0e0"/>' + svgText(left - 6, y(v) + 4, autoNum(Math.round(v * 100) / 100), 'text-anchor="end" font-size="10" fill="#5f6368"'));
    }
    const n = labels.length;
    const slot = pw / n;
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 60))));
    labels.forEach((label, i) => {
      if (i % step === 0) out.push(svgText(left + slot * (i + 0.5), top + ph + 15, label.slice(0, 10), 'text-anchor="middle" font-size="10" fill="#5f6368"'));
    });
    series.forEach((s, si) => {
      const color = CHART_COLORS[si % 8];
      if (ch.type === "line") {
        const pts = s.values.map((v, i) => (left + slot * (i + 0.5)).toFixed(1) + "," + y(v).toFixed(1));
        out.push('<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + color + '" stroke-width="2"/>');
        s.values.forEach((v, i) => out.push('<circle cx="' + (left + slot * (i + 0.5)).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3" fill="' + color + '"><title>' + escapeHtml(s.name + " · " + labels[i] + ": " + autoNum(v)) + "</title></circle>"));
      } else {
        const bw = Math.max(1, (slot * 0.75) / series.length);
        s.values.forEach((v, i) => {
          const x = left + slot * i + slot * 0.125 + bw * si;
          const y0 = y(Math.max(0, v)), y1 = y(Math.min(0, v));
          out.push('<rect x="' + x.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, y1 - y0).toFixed(1) + '" fill="' + color + '"><title>' + escapeHtml(s.name + " · " + labels[i] + ": " + autoNum(v)) + "</title></rect>");
        });
      }
    });
    if (legendH) {
      let lx = left;
      series.forEach((s, si) => {
        out.push('<rect x="' + lx + '" y="' + (h - 15) + '" width="10" height="10" fill="' + CHART_COLORS[si % 8] + '"/>' + svgText(lx + 14, h - 6, s.name.slice(0, 16), 'font-size="11"'));
        lx += 24 + Math.min(16, s.name.length) * 6.2;
      });
    }
    return out.join("");
  }
  function renderCharts() {
    chartLayer.style.zoom = zoom;
    chartLayer.innerHTML = "";
    for (const ch of sheet.charts || []) {
      const el = document.createElement("div");
      el.className = "chart";
      el.dataset.chart = ch.id;
      el.style.cssText = "left:" + sizeOr(ch.x, 60) + "px;top:" + sizeOr(ch.y, 60) + "px;width:" + sizeOr(ch.w, 420) + "px;height:" + sizeOr(ch.h, 260) + "px";
      const w = sizeOr(ch.w, 420), h = sizeOr(ch.h, 260) - 30;
      el.innerHTML = '<div class="chart-head"><span></span><button class="chart-menu" title="Chart options" aria-label="Chart options">&#8942;</button></div><svg viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" role="img"></svg><div class="chart-resize"></div>';
      el.querySelector(".chart-head span").textContent = ch.title || "Chart";
      el.querySelector("svg").setAttribute("aria-label", ch.title || "Chart");
      el.querySelector("svg").innerHTML = drawChart(ch, w, h);
      chartLayer.appendChild(el);
    }
  }
  function chartById(id) {
    return (sheet.charts || []).find((c) => c.id === id);
  }
  function insertChart(type) {
    if (range.r1 === range.r2 && range.c1 === range.c2) return toast("Select the data to chart first (labels in the first column, numbers next to it)");
    const td = cellEl(range.r1, range.c2);
    let x = ROW_HEADER_W;
    for (let c = 0; c <= range.c2; c++) if (!isColHidden(c)) x += colWidth(c);
    const yPos = (td ? td.offsetTop : rowTops[range.r1] + 22) + 0;
    mutate(() => {
      (sheet.charts = sheet.charts || []).push({ id: uid(), type: type || "bar", range: Object.assign({}, range), title: "Chart", x: x + 16, y: Math.max(24, yPos), w: 420, h: 260 });
    });
  }
  function openChartEditor(ch) {
    openDialog(
      "<h2>Chart</h2>" +
        '<div class="row"><label>Title</label><input type="text" id="ch-title" maxlength="100"></div>' +
        '<div class="row"><label>Type</label><select id="ch-type" style="flex:1;height:34px"><option value="bar">Column</option><option value="line">Line</option><option value="pie">Pie</option></select></div>' +
        '<div class="row"><label>Data range</label><input type="text" id="ch-range"></div>' +
        '<div class="actions"><button class="btn" id="ch-del">Delete chart</button><button class="btn" data-close>Cancel</button><button class="btn primary" id="ch-ok">Save</button></div>',
      (dlg, close) => {
        dlg.querySelector("#ch-title").value = ch.title || "";
        dlg.querySelector("#ch-type").value = ch.type;
        dlg.querySelector("#ch-range").value = addr(ch.range.r1, ch.range.c1) + ":" + addr(ch.range.r2, ch.range.c2);
        dlg.querySelector("#ch-del").addEventListener("click", () => {
          close();
          mutate(() => { sheet.charts = sheet.charts.filter((c) => c.id !== ch.id); });
        });
        dlg.querySelector("#ch-ok").addEventListener("click", () => {
          const parts = dlg.querySelector("#ch-range").value.trim().split(":");
          const a = parseAddr(parts[0]), b = parts[1] ? parseAddr(parts[1]) : a;
          if (!a || !b) return toast("Enter a range like A1:C12");
          close();
          mutate(() => {
            const target = chartById(ch.id);
            if (!target) return;
            target.title = dlg.querySelector("#ch-title").value.trim();
            target.type = dlg.querySelector("#ch-type").value;
            target.range = { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
          });
        });
      }
    );
  }
  let chartDrag = null;
  chartLayer.addEventListener("mousedown", (e) => {
    const el = e.target.closest(".chart");
    if (!el) return;
    e.stopPropagation();
    const ch = chartById(el.dataset.chart);
    if (!ch) return;
    if (e.target.closest(".chart-menu")) {
      e.preventDefault();
      openChartEditor(ch);
      return;
    }
    if (readOnly()) return;
    e.preventDefault();
    chartDrag = { el, ch, mode: e.target.classList.contains("chart-resize") ? "resize" : "move", x: e.clientX, y: e.clientY, start: { x: ch.x, y: ch.y, w: ch.w, h: ch.h } };
  });
  chartLayer.addEventListener("dblclick", (e) => {
    const el = e.target.closest(".chart");
    if (el && chartById(el.dataset.chart)) openChartEditor(chartById(el.dataset.chart));
  });
  document.addEventListener("mousemove", (e) => {
    if (!chartDrag) return;
    const dx = (e.clientX - chartDrag.x) / zoom, dy = (e.clientY - chartDrag.y) / zoom;
    const s = chartDrag.start;
    if (chartDrag.mode === "move") {
      chartDrag.el.style.left = Math.max(0, s.x + dx) + "px";
      chartDrag.el.style.top = Math.max(0, s.y + dy) + "px";
    } else {
      chartDrag.el.style.width = Math.max(200, s.w + dx) + "px";
      chartDrag.el.style.height = Math.max(150, s.h + dy) + "px";
    }
  });
  document.addEventListener("mouseup", () => {
    if (!chartDrag) return;
    const d = chartDrag;
    chartDrag = null;
    const left = parseFloat(d.el.style.left), top = parseFloat(d.el.style.top), w = parseFloat(d.el.style.width), h = parseFloat(d.el.style.height);
    if (left === d.start.x && top === d.start.y && w === d.start.w && h === d.start.h) return;
    mutate(() => {
      const ch = chartById(d.ch.id);
      if (!ch) return;
      Object.assign(ch, { x: Math.round(left), y: Math.round(top), w: Math.round(w), h: Math.round(h) });
    });
  });

  // ---------------------------------------------------------------- Excel (.xlsx) export and import
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  // Minimal ZIP writer (stored, no compression), enough for an .xlsx package.
  function zipBytes(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, text] of files) {
      const nameBytes = enc.encode(name);
      const data = enc.encode(text);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nameBytes.length, true); cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of all) { out.set(p, at); at += p.length; }
    return out;
  }
  function xmlEscape(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  }
  function buildXlsxFiles() {
    const styles = new Map([["0|0", 0]]);
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'];
    const fmtIds = { number: 4, percent: 10, currency: 164, date: 14, datetime: 22, sci: 11 };
    const styleIndex = (s, fmt) => {
      const bold = s && s.b ? 1 : 0;
      const numFmt = fmtIds[fmt] || 0;
      const k = bold + "|" + numFmt;
      if (!styles.has(k)) {
        styles.set(k, xfs.length);
        xfs.push('<xf numFmtId="' + numFmt + '" fontId="' + bold + '" fillId="0" borderId="0"' + (numFmt ? ' applyNumberFormat="1"' : "") + (bold ? ' applyFont="1"' : "") + "/>");
      }
      return styles.get(k);
    };
    const sheetsXml = doc.sheets.map((sh) => {
      const rows = new Map();
      for (const k in sh.cells) {
        const cell = sh.cells[k];
        const [r, c] = k.split(":").map(Number);
        if (cell.v === "" && !(cell.s && cell.s.b)) continue;
        const v = safeCellValue(sh, r, c);
        const s = cell.s || {};
        const si = styleIndex(s, effectiveFmt(cell));
        const ref = addr(r, c);
        const sAttr = si ? ' s="' + si + '"' : "";
        let xml;
        const f = isFormula(cell.v) ? "<f>" + xmlEscape(cell.v.slice(1)) + "</f>" : "";
        if (v === null) xml = '<c r="' + ref + '"' + sAttr + "/>";
        else if (typeof v === "number") xml = '<c r="' + ref + '"' + sAttr + ">" + f + "<v>" + v + "</v></c>";
        else if (typeof v === "boolean") xml = '<c r="' + ref + '" t="b"' + sAttr + ">" + f + "<v>" + (v ? 1 : 0) + "</v></c>";
        else if (v instanceof FErr) xml = '<c r="' + ref + '" t="e"' + sAttr + ">" + f + "<v>" + xmlEscape(v.code) + "</v></c>";
        else xml = f ? '<c r="' + ref + '" t="str"' + sAttr + ">" + f + "<v>" + xmlEscape(v) + "</v></c>" : '<c r="' + ref + '" t="inlineStr"' + sAttr + "><is><t xml:space=\"preserve\">" + xmlEscape(v) + "</t></is></c>";
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push([c, xml]);
      }
      const rowXml = [...rows.keys()].sort((a, b) => a - b).map((r) => '<row r="' + (r + 1) + '">' + rows.get(r).sort((a, b) => a[0] - b[0]).map((x) => x[1]).join("") + "</row>").join("");
      const cols = Object.keys(sh.colW || {}).map(Number).filter((c) => c < sh.cols).sort((a, b) => a - b).map((c) => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + (sizeOr(sh.colW[c], 100) / 7).toFixed(2) + '" customWidth="1"/>').join("");
      const pane = sh.freezeRows || sh.freezeCols ? '<sheetViews><sheetView workbookViewId="0"><pane ' + (sh.freezeCols ? 'xSplit="' + sh.freezeCols + '" ' : "") + (sh.freezeRows ? 'ySplit="' + sh.freezeRows + '" ' : "") + 'topLeftCell="' + addr(sh.freezeRows || 0, sh.freezeCols || 0) + '" state="frozen"/></sheetView></sheetViews>' : "";
      const merges = (sh.merges || []).length ? '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map((m) => '<mergeCell ref="' + addr(m.r1, m.c1) + ":" + addr(m.r2, m.c2) + '"/>').join("") + "</mergeCells>" : "";
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + pane + (cols ? "<cols>" + cols + "</cols>" : "") + "<sheetData>" + rowXml + "</sheetData>" + merges + "</worksheet>";
    });
    const safeName = (n, i) => xmlEscape(String(n).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet" + (i + 1));
    const files = [
      ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + doc.sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") + "</Types>"],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + doc.sheets.map((sh, i) => '<sheet name="' + safeName(sh.name, i) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") + "</sheets></workbook>"],
      ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + doc.sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") + '<Relationship Id="rId' + (doc.sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ["xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="' + xfs.length + '">' + xfs.join("") + "</cellXfs></styleSheet>"],
    ].concat(sheetsXml.map((xml, i) => ["xl/worksheets/sheet" + (i + 1) + ".xml", xml]));
    return files;
  }
  function exportXlsx() {
    const blob = new Blob([zipBytes(buildXlsxFiles())], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (doc.title || "Spreadsheet") + ".xlsx";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function unzip(buffer) {
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("Not a valid .xlsx file");
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const files = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt .xlsx file");
      const method = view.getUint16(p + 10, true);
      const size = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(buffer, p + 46, nameLen));
      const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      files.set(name, { method, data: new Uint8Array(buffer, dataStart, size) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return async (name) => {
      const f = files.get(name);
      if (!f) return null;
      if (f.method === 0) return dec.decode(f.data);
      if (f.method !== 8 || typeof DecompressionStream === "undefined") throw new Error("This browser can't read compressed .xlsx files");
      const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return dec.decode(await new Response(stream).arrayBuffer());
    };
  }
  async function importXlsx(file) {
    await importXlsxBuffer(await file.arrayBuffer(), file.name);
  }
  async function importXlsxBuffer(buffer, fileName) {
    const read = await unzip(buffer);
    const parser = new DOMParser();
    const parse = (text) => parser.parseFromString(text, "application/xml");
    const workbook = parse(await read("xl/workbook.xml") || "");
    const rels = parse(await read("xl/_rels/workbook.xml.rels") || "<r/>");
    const target = new Map([...rels.getElementsByTagName("Relationship")].map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
    const sharedText = await read("xl/sharedStrings.xml");
    const shared = sharedText ? [...parse(sharedText).getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join("")) : [];
    const added = [];
    let cellCount = 0;
    for (const sh of [...workbook.getElementsByTagName("sheet")]) {
      const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let path = target.get(rid) || "";
      path = path.startsWith("/") ? path.slice(1) : "xl/" + path.replace(/^\.\//, "");
      const xml = await read(path);
      if (!xml) continue;
      const ws = parse(xml);
      let maxR = 0, maxC = 0;
      const cells = {};
      for (const c of [...ws.getElementsByTagName("c")]) {
        const pos = parseAddr(c.getAttribute("r") || "");
        if (!pos) continue;
        const t = c.getAttribute("t");
        const fEl = c.getElementsByTagName("f")[0];
        const vEl = c.getElementsByTagName("v")[0];
        let raw = "";
        if (fEl && fEl.textContent) raw = "=" + fEl.textContent;
        else if (t === "s") raw = shared[+(vEl ? vEl.textContent : -1)] || "";
        else if (t === "inlineStr") raw = [...c.getElementsByTagName("t")].map((x) => x.textContent).join("");
        else if (t === "b") raw = vEl && vEl.textContent === "1" ? "TRUE" : "FALSE";
        else if (vEl) raw = vEl.textContent;
        if (raw === "") continue;
        if (t === "s" || t === "inlineStr" || t === "str") {
          if (!raw.startsWith("=") && literalValue(raw) !== raw) raw = "'" + raw;
        }
        cells[key(pos.r, pos.c)] = { v: raw };
        maxR = Math.max(maxR, pos.r);
        maxC = Math.max(maxC, pos.c);
        if (++cellCount > 500000) throw new Error("The file is too large to import (over 500,000 cells)");
      }
      const name = uniqueSheetName((sh.getAttribute("name") || "Imported").slice(0, 60));
      const tab = newSheet(name, Math.max(100, maxR + 21), Math.max(26, maxC + 1));
      tab.cells = cells;
      const merges = [...ws.getElementsByTagName("mergeCell")].map((m) => (m.getAttribute("ref") || "").split(":")).map(([a, b]) => [parseAddr(a || ""), parseAddr(b || "")]).filter(([a, b]) => a && b);
      tab.merges = merges.map(([a, b]) => ({ r1: a.r, c1: a.c, r2: b.r, c2: b.c }));
      added.push(tab);
    }
    if (!added.length) throw new Error("No sheets found in the file");
    mutate(() => { doc.sheets.splice(doc.active + 1, 0, ...added); }, { tabs: true });
    switchSheet(doc.active + 1);
    toast("Imported " + added.length + " sheet" + (added.length === 1 ? "" : "s") + " from " + fileName);
  }
  $("xlsx-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try { await importXlsx(file); } catch (error) { toast(error.message || "Import failed"); }
  });

  // ---------------------------------------------------------------- screen readers
  const announcer = document.createElement("div");
  announcer.className = "sr-only";
  announcer.setAttribute("aria-live", "polite");
  document.body.appendChild(announcer);
  let announceTimer = null;
  function announceSelection() {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      const text = cellText(active.r, active.c);
      announcer.textContent = (range.r1 !== range.r2 || range.c1 !== range.c2 ? addr(range.r1, range.c1) + " to " + addr(range.r2, range.c2) + ", " : "") + addr(active.r, active.c) + ": " + (text || "empty");
    }, 120);
  }

  // ---------------------------------------------------------------- protected ranges
  // The server enforces these on every save; the editor checks too so people get instant feedback.
  function canEditRule(rule) {
    if (me.role === "admin" || !me.username) return true;
    const u = me.username.toLowerCase();
    return (rule.owner || "").toLowerCase() === u || (rule.editors || []).some((x) => String(x).toLowerCase() === u);
  }
  function lockedRules() {
    return (sheet.protected || []).filter((rule) => !canEditRule(rule));
  }
  function isLocked(r, c) {
    const rules = sheet.protected;
    if (!rules || !rules.length) return false;
    return rules.some((rule) => r >= rule.r1 && r <= rule.r2 && c >= rule.c1 && c <= rule.c2 && !canEditRule(rule));
  }
  // Content of each locked range relative to its top-left corner (so moving it by inserting rows
  // above is fine, like on the server), used to undo forbidden edits.
  function lockedSignature(sh) {
    const rules = (sh.protected || []).filter((rule) => !canEditRule(rule));
    if (!rules.length) return null;
    return JSON.stringify(rules.map((rule) => {
      const parts = [];
      for (const k in sh.cells) {
        const [r, c] = k.split(":").map(Number);
        if (r < rule.r1 || r > rule.r2 || c < rule.c1 || c > rule.c2) continue;
        const cell = sh.cells[k];
        if (cell.v === "" && !cell.s && !cell.note) continue;
        parts.push((r - rule.r1) + ":" + (c - rule.c1) + "=" + JSON.stringify([cell.v, cell.s || null, cell.note || null]));
      }
      return [rule.id, rule.owner, rule.editors, rule.description || "", rule.r2 - rule.r1, rule.c2 - rule.c1, parts.sort()];
    }));
  }
  function openProtect() {
    if (readOnly()) return refuseReadOnly();
    const rules = sheet.protected || [];
    const who = (rule) => (rule.editors && rule.editors.length ? "admins, " + escapeHtml(rule.owner) + ", " + rule.editors.map(escapeHtml).join(", ") : "admins and " + escapeHtml(rule.owner));
    openDialog(
      "<h2>Protected ranges</h2>" +
        '<div class="history-list">' + (rules.length ? rules.map((rule, i) => '<div class="history-row"><div><strong>' + addr(rule.r1, rule.c1) + ":" + addr(rule.r2, rule.c2) + (rule.description ? " · " + escapeHtml(rule.description) : "") + "</strong><span>Can edit: " + who(rule) + "</span></div>" + (canEditRule(rule) ? '<button class="btn" data-unprotect="' + i + '">Remove</button>' : "") + "</div>").join("") : '<p class="note">Nothing is protected on this sheet.</p>') + "</div>" +
        "<h3 style=\"font-weight:500;margin:16px 0 8px\">Protect a range</h3>" +
        '<div class="row"><label>Range</label><input type="text" id="pr-range"></div>' +
        '<div class="row"><label>Description</label><input type="text" id="pr-desc" maxlength="100" placeholder="e.g. Targets — finance only"></div>' +
        '<div class="row"><label>Also allow</label><input type="text" id="pr-editors" placeholder="usernames, comma separated (optional)"></div>' +
        '<p class="note">Admins and you can always edit it. Everyone else sees the cells but can\'t change them; the server rejects any change.</p>' +
        '<div class="actions"><button class="btn" data-close>Close</button><button class="btn primary" id="pr-ok">Protect</button></div>',
      (dlg, close) => {
        dlg.querySelector("#pr-range").value = addr(range.r1, range.c1) + ":" + addr(range.r2, range.c2);
        dlg.addEventListener("click", (e) => {
          const b = e.target.closest("[data-unprotect]");
          if (!b) return;
          close();
          mutate(() => { sheet.protected.splice(+b.dataset.unprotect, 1); }, { rebuild: true });
        });
        dlg.querySelector("#pr-ok").addEventListener("click", () => {
          const parts = dlg.querySelector("#pr-range").value.trim().split(":");
          const a = parseAddr(parts[0]), b = parts[1] ? parseAddr(parts[1]) : a;
          if (!a || !b) return toast("Enter a range like A1:D20");
          if (!me.username) return toast("Protected ranges need the workspace server");
          const editors = dlg.querySelector("#pr-editors").value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 50);
          const rule = { id: uid(), r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c), owner: me.username, editors };
          const desc = dlg.querySelector("#pr-desc").value.trim();
          if (desc) rule.description = desc;
          close();
          mutate(() => { (sheet.protected = sheet.protected || []).push(rule); }, { rebuild: true });
          toast("Protected " + addr(rule.r1, rule.c1) + ":" + addr(rule.r2, rule.c2));
        });
      }
    );
  }

  // ---------------------------------------------------------------- comments (threads)
  function threadsAt(r, c) {
    const list = sheet.comments && sheet.comments[key(r, c)];
    return Array.isArray(list) ? list : [];
  }
  async function commentAction(body) {
    if (server.available !== true) { toast("Comments need the workspace server"); return false; }
    if (!readOnly() && hasUnsyncedChanges()) await syncToServer();
    let res;
    try { res = await api("POST", docPath() + "/comments", Object.assign({ sheetId: sheet.id }, body)); } catch { toast("Server unreachable"); return false; }
    if (res.status !== 200) { toast((res.data && res.data.error) || "Comment failed"); return false; }
    if (readOnly() || !hasUnsyncedChanges()) applyRemote(res.data.doc, res.data.version, JSON.stringify(res.data.doc));
    return true;
  }
  function fmtShort(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function openComments(r, c) {
    if (r === undefined) { r = active.r; c = active.c; }
    const cellKey = key(r, c);
    const render = () => {
      const threads = threadsAt(r, c);
      const mine = (author) => me.role === "admin" || (author || "").toLowerCase() === (me.username || "").toLowerCase();
      return "<h2>Comments on " + addr(r, c) + "</h2>" +
        '<div class="history-list comment-list">' + (threads.length ? threads.map((th) =>
          '<div class="comment' + (th.resolved ? " resolved" : "") + '"><div class="comment-head"><strong>' + escapeHtml(th.author) + "</strong><span>" + escapeHtml(fmtShort(th.at)) + (th.resolved ? " · resolved" : "") + '</span></div><div class="comment-text"></div>' +
          th.replies.map((rp) => '<div class="comment-reply"><div class="comment-head"><strong>' + escapeHtml(rp.author) + "</strong><span>" + escapeHtml(fmtShort(rp.at)) + "</span>" + (mine(rp.author) ? '<button class="link-btn" data-del-reply="' + escapeHtml(th.id) + "|" + escapeHtml(rp.id) + '">Delete</button>' : "") + '</div><div class="comment-text" data-reply-text="' + escapeHtml(rp.id) + '"></div></div>').join("") +
          '<div class="comment-actions"><input type="text" placeholder="Reply…" data-reply-input="' + escapeHtml(th.id) + '"><button class="btn" data-reply="' + escapeHtml(th.id) + '">Reply</button>' +
          '<button class="btn" data-resolve="' + escapeHtml(th.id) + '">' + (th.resolved ? "Reopen" : "Resolve") + "</button>" + (mine(th.author) ? '<button class="btn" data-del="' + escapeHtml(th.id) + '">Delete</button>' : "") + "</div></div>").join("") : '<p class="note">No comments yet.</p>') + "</div>" +
        '<div class="row"><textarea id="cm-new" rows="3" maxlength="4000" placeholder="Add a comment… Type @username to notify someone." style="flex:1;font:inherit;padding:8px;border:1px solid #c4c7c5;border-radius:4px"></textarea></div>' +
        '<div class="actions"><button class="btn" data-close>Close</button><button class="btn primary" id="cm-add">Comment</button></div>';
    };
    const fill = (dlg) => {
      // Comment text goes in with textContent so it can never become markup.
      const threads = threadsAt(r, c);
      dlg.querySelectorAll(".comment").forEach((el, i) => {
        const th = threads[i];
        if (!th) return;
        el.querySelector(".comment-text").textContent = th.text;
        th.replies.forEach((rp) => { const t = el.querySelector('[data-reply-text="' + CSS.escape(rp.id) + '"]'); if (t) t.textContent = rp.text; });
      });
    };
    openDialog(render(), (dlg, close) => {
      fill(dlg);
      const rerender = () => { dlg.innerHTML = render(); fill(dlg); dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close)); };
      dlg.addEventListener("click", async (e) => {
        const t = e.target.closest("button");
        if (!t) return;
        let ok = false;
        if (t.id === "cm-add") {
          const text = dlg.querySelector("#cm-new").value.trim();
          if (!text) return;
          ok = await commentAction({ action: "add", cell: cellKey, text });
        } else if (t.dataset.reply) {
          const input = dlg.querySelector('[data-reply-input="' + CSS.escape(t.dataset.reply) + '"]');
          if (!input.value.trim()) return;
          ok = await commentAction({ action: "reply", cell: cellKey, threadId: t.dataset.reply, text: input.value.trim() });
        } else if (t.dataset.resolve) {
          const th = threadsAt(r, c).find((x) => x.id === t.dataset.resolve);
          ok = await commentAction({ action: th && th.resolved ? "reopen" : "resolve", cell: cellKey, threadId: t.dataset.resolve });
        } else if (t.dataset.del) {
          if (!confirm("Delete this comment thread?")) return;
          ok = await commentAction({ action: "delete", cell: cellKey, threadId: t.dataset.del });
        } else if (t.dataset.delReply) {
          const [threadId, replyId] = t.dataset.delReply.split("|");
          ok = await commentAction({ action: "delete", cell: cellKey, threadId, replyId });
        }
        if (ok) rerender();
      });
      const box = dlg.querySelector("#cm-new");
      if (box) box.focus();
    });
  }
  function openAllComments() {
    const entries = [];
    for (const [k, list] of Object.entries(sheet.comments || {})) {
      if (!Array.isArray(list)) continue;
      const [r, c] = k.split(":").map(Number);
      for (const th of list) entries.push({ r, c, th });
    }
    entries.sort((a, b) => (a.th.resolved - b.th.resolved) || a.r - b.r || a.c - b.c);
    openDialog(
      "<h2>All comments on this sheet</h2>" +
        '<div class="history-list">' + (entries.length ? entries.map((e, i) => '<div class="history-row"><div><strong>' + addr(e.r, e.c) + " · " + escapeHtml(e.th.author) + (e.th.resolved ? " · resolved" : "") + '</strong><span data-preview="' + i + '"></span></div><button class="btn" data-open="' + i + '">Open</button></div>').join("") : '<p class="note">No comments on this sheet.</p>') + "</div>" +
        '<div class="actions"><button class="btn primary" data-close>Close</button></div>',
      (dlg, close) => {
        entries.forEach((e, i) => { const s = dlg.querySelector('[data-preview="' + i + '"]'); if (s) s.textContent = e.th.text.slice(0, 120) + (e.th.replies.length ? " (" + e.th.replies.length + " repl" + (e.th.replies.length === 1 ? "y)" : "ies)") : ""); });
        dlg.addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-open]");
          if (!b) return;
          const e = entries[+b.dataset.open];
          close();
          select(e.r, e.c);
          ensureVisible(e.r, e.c);
          openComments(e.r, e.c);
        });
      }
    );
  }
  // ---------------------------------------------------------------- pivot tables (live PIVOT formula on a new sheet)
  function quoteSheet(name) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "'" + name.replace(/'/g, "''") + "'";
  }
  function openPivot() {
    if (readOnly()) return refuseReadOnly();
    let rg = Object.assign({}, range);
    if (rg.r1 === rg.r2 && rg.c1 === rg.c2) {
      const b = usedBounds();
      if (b.r2 < 1) return toast("Select a table with a header row first");
      rg = { r1: 0, c1: 0, r2: b.r2, c2: b.c2 };
    }
    const headers = [];
    for (let c = rg.c1; c <= rg.c2; c++) headers.push(cellText(rg.r1, c) || colName(c));
    const options = headers.map((h, i) => '<option value="' + i + '">' + escapeHtml(h) + "</option>").join("");
    openDialog(
      "<h2>Pivot table</h2>" +
        '<div class="row"><label>Data</label><input type="text" id="pv-range"></div>' +
        '<div class="row"><label>Rows</label><select id="pv-rows" style="flex:1;height:34px">' + options + "</select></div>" +
        '<div class="row"><label>Columns</label><select id="pv-cols" style="flex:1;height:34px"><option value="">(none)</option>' + options + "</select></div>" +
        '<div class="row"><label>Values</label><select id="pv-vals" style="flex:1;height:34px">' + options + "</select></div>" +
        '<div class="row"><label>Summarize by</label><select id="pv-agg" style="flex:1;height:34px">' + Object.keys(PIVOT_AGGS).map((k) => "<option>" + k + "</option>").join("") + "</select></div>" +
        '<p class="note">The pivot is placed on a new sheet as a live <code>PIVOT</code> formula, so it updates when the data changes.</p>' +
        '<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="pv-ok">Create</button></div>',
      (dlg, close) => {
        dlg.querySelector("#pv-range").value = addr(rg.r1, rg.c1) + ":" + addr(rg.r2, rg.c2);
        dlg.querySelector("#pv-vals").value = String(Math.min(headers.length - 1, 1));
        dlg.querySelector("#pv-ok").addEventListener("click", () => {
          const parts = dlg.querySelector("#pv-range").value.trim().split(":");
          const a = parseAddr(parts[0]), b = parts[1] ? parseAddr(parts[1]) : a;
          if (!a || !b) return toast("Enter a range like A1:D200");
          const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
          const rowField = headers[+dlg.querySelector("#pv-rows").value];
          const valField = headers[+dlg.querySelector("#pv-vals").value];
          const colSel = dlg.querySelector("#pv-cols").value;
          const agg = dlg.querySelector("#pv-agg").value;
          const src = quoteSheet(sheet.name) + "!" + addr(Math.min(a.r, b.r), Math.min(a.c, b.c)) + ":" + addr(Math.max(a.r, b.r), Math.max(a.c, b.c));
          const formula = "=PIVOT(" + src + "," + q(rowField) + "," + q(valField) + "," + q(agg) + (colSel === "" ? "" : "," + q(headers[+colSel])) + ")";
          close();
          // Size the sheet for the result: one row per distinct row value, one column per distinct column value.
          const distinct = (offset) => {
            const set = new Set();
            for (let r = Math.min(a.r, b.r) + 1; r <= Math.max(a.r, b.r); r++) set.add(cellText(r, Math.min(a.c, b.c) + offset));
            return set.size;
          };
          const outRows = distinct(+dlg.querySelector("#pv-rows").value) + 3;
          const outCols = colSel === "" ? 2 : distinct(+colSel) + 3;
          if (outCols > 2000) return toast("That column field has too many distinct values for a pivot");
          const pv = newSheet(uniqueSheetName("Pivot"), Math.max(100, outRows + 20), Math.max(26, outCols + 2));
          pv.cells["0:0"] = { v: formula };
          pv.freezeRows = 1;
          pv.colW = { 0: 160 };
          addSheet(pv);
          const result = safeCellValue(sheet, 0, 0);
          if (result instanceof FErr) toast("Pivot: " + (result.msg || result.code));
        });
      }
    );
  }
  const MENUS = {
    File: () => [
      { label: "New spreadsheet", action: () => { location.href = "/editor?new=blank"; } },
      { label: "Open (home)", kbd: MOD + "O", action: () => { location.href = "/"; } },
      { label: "Make a copy", action: makeCopy },
      { sep: true },
      { label: "Import Excel (.xlsx) as new sheets…", action: () => $("xlsx-input").click(), disabled: readOnly },
      { label: "Import CSV / TSV as new sheet…", action: () => $("file-input").click(), disabled: readOnly },
      { label: "Download as Excel (.xlsx)", action: exportXlsx },
      { label: "Download current sheet (.csv)", action: () => download("csv") },
      { label: "Download current sheet (.tsv)", action: () => download("tsv") },
      { sep: true },
      { label: "Share…", action: openShare },
      { label: "Version history…", action: openHistory },
      { label: "Rename", action: () => { $("doc-title").focus(); $("doc-title").select(); }, disabled: readOnly },
      { label: "Delete this spreadsheet", action: deleteDoc, disabled: readOnly },
      { sep: true },
      { label: "Print", kbd: MOD + "P", action: () => window.print() },
    ],
    Edit: () => [
      { label: "Undo", kbd: MOD + "Z", action: undo, disabled: () => !undoStack.length },
      { label: "Redo", kbd: MOD + "Y", action: redo, disabled: () => !redoStack.length },
      { sep: true },
      { label: "Cut", kbd: MOD + "X", action: () => menuCopy(true) },
      { label: "Copy", kbd: MOD + "C", action: () => menuCopy(false) },
      { label: "Paste", kbd: MOD + "V", action: () => menuPaste(false) },
      { label: "Paste values only", kbd: MOD + "Shift+V", action: () => menuPaste(true) },
      { sep: true },
      { label: "Select all", kbd: MOD + "A", action: selectAll },
      { label: "Delete values", kbd: "Del", action: clearValues },
      { label: "Delete " + rowsLabel(), action: () => deleteRows(range.r1, range.r2 - range.r1 + 1) },
      { label: "Delete " + colsLabel(), action: () => deleteCols(range.c1, range.c2 - range.c1 + 1) },
      { sep: true },
      { label: "Find and replace", kbd: MOD + "H", action: () => openFind(true) },
    ],
    View: () => [
      { heading: "Freeze" },
      { label: "No rows", checked: () => !sheet.freezeRows, action: () => setFreeze("rows", 0) },
      { label: "1 row", checked: () => sheet.freezeRows === 1, action: () => setFreeze("rows", 1) },
      { label: "2 rows", checked: () => sheet.freezeRows === 2, action: () => setFreeze("rows", 2) },
      { label: "Up to row " + (active.r + 1), checked: () => sheet.freezeRows === active.r + 1 && active.r > 1, action: () => setFreeze("rows", active.r + 1) },
      { label: "No columns", checked: () => !sheet.freezeCols, action: () => setFreeze("cols", 0) },
      { label: "1 column", checked: () => sheet.freezeCols === 1, action: () => setFreeze("cols", 1) },
      { label: "2 columns", checked: () => sheet.freezeCols === 2, action: () => setFreeze("cols", 2) },
      { label: "Up to column " + colName(active.c), checked: () => sheet.freezeCols === active.c + 1 && active.c > 1, action: () => setFreeze("cols", active.c + 1) },
      { sep: true },
      { label: "All comments…", action: openAllComments },
      { label: "Show all hidden rows and columns", action: () => mutate(() => { delete sheet.hiddenRowsList; delete sheet.hiddenCols; }, { rebuild: true }), disabled: () => !hasHidden() },
      { sep: true },
      { label: "Gridlines", checked: () => sheet.gridlines !== false, action: () => mutate(() => { sheet.gridlines = sheet.gridlines === false; }, { rebuild: true }) },
      { label: "Formula bar", checked: () => document.querySelector(".formula-bar").style.display !== "none", action: () => { const fb = document.querySelector(".formula-bar"); fb.style.display = fb.style.display === "none" ? "" : "none"; } },
      { sep: true },
      { label: "Zoom in", action: () => setZoom(Math.min(2, zoom + 0.25)) },
      { label: "Zoom out", action: () => setZoom(Math.max(0.5, zoom - 0.25)) },
      { label: "Full screen", action: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => toast("Full screen was blocked by the browser"))) },
    ],
    Insert: () => [
      { label: "Row" + (range.r2 > range.r1 ? "s" : "") + " above", action: () => insertRows(range.r1, range.r2 - range.r1 + 1) },
      { label: "Row" + (range.r2 > range.r1 ? "s" : "") + " below", action: () => insertRows(range.r2 + 1, range.r2 - range.r1 + 1) },
      { label: "Column" + (range.c2 > range.c1 ? "s" : "") + " left", action: () => insertCols(range.c1, range.c2 - range.c1 + 1) },
      { label: "Column" + (range.c2 > range.c1 ? "s" : "") + " right", action: () => insertCols(range.c2 + 1, range.c2 - range.c1 + 1) },
      { sep: true },
      { label: "New sheet", kbd: "Shift+F11", action: () => addSheet() },
      { sep: true },
      { label: "Pivot table…", action: openPivot },
      { label: "Chart (column)", action: () => insertChart("bar") },
      { label: "Chart (line)", action: () => insertChart("line") },
      { label: "Chart (pie)", action: () => insertChart("pie") },
      { label: "Comment", kbd: MOD + "Alt+M", action: () => openComments() },
      { label: "Note", kbd: "Shift+F2", action: editNote },
      { sep: true },
      { label: "Function: SUM", action: () => insertFunction("SUM") },
      { label: "Function: AVERAGE", action: () => insertFunction("AVERAGE") },
      { label: "All functions…", action: openFunctionList },
      { label: "Link", kbd: MOD + "K", action: insertLink },
      { label: "Today's date", kbd: MOD + ";", action: () => writeCells([[active.r, active.c, fmtDate(dateToSerial(new Date()))]]) },
    ],
    Format: () => fmtItems().concat([
      { sep: true },
      { label: "Bold", kbd: MOD + "B", checked: () => !!styleOf(active.r, active.c).b, action: () => toggleStyle("b") },
      { label: "Italic", kbd: MOD + "I", checked: () => !!styleOf(active.r, active.c).i, action: () => toggleStyle("i") },
      { label: "Underline", kbd: MOD + "U", checked: () => !!styleOf(active.r, active.c).u, action: () => toggleStyle("u") },
      { label: "Strikethrough", kbd: "Alt+Shift+5", checked: () => !!styleOf(active.r, active.c).st, action: () => toggleStyle("st") },
      { sep: true },
      { label: "Align left", kbd: MOD + "Shift+L", action: () => setStyle({ ha: "left" }) },
      { label: "Align center", kbd: MOD + "Shift+E", action: () => setStyle({ ha: "center" }) },
      { label: "Align right", kbd: MOD + "Shift+R", action: () => setStyle({ ha: "right" }) },
      { label: "Wrap text", checked: () => !!styleOf(active.r, active.c).wrap, action: () => toggleStyle("wrap") },
      { label: mergeAt(active.r, active.c) ? "Unmerge cells" : "Merge cells", action: toggleMerge },
      { sep: true },
      { sep: true },
      { label: "Conditional formatting…", action: openCondFormat },
      { label: "Clear formatting", kbd: MOD + "\\", action: clearFormatting },
    ]),
    Data: () => [
      { label: "Sort sheet by column " + colName(active.c) + " (A to Z)", action: () => sortSheet(true) },
      { label: "Sort sheet by column " + colName(active.c) + " (Z to A)", action: () => sortSheet(false) },
      { label: "Sort range by column " + colName(active.c) + " (A to Z)", action: () => sortRange(true), disabled: () => range.r1 === range.r2 },
      { label: "Sort range by column " + colName(active.c) + " (Z to A)", action: () => sortRange(false), disabled: () => range.r1 === range.r2 },
      { sep: true },
      { label: sheet.filter ? "Remove filter" : "Create a filter", action: toggleFilter },
      { sep: true },
      { label: "Remove duplicates", action: removeDuplicates, disabled: () => range.r1 === range.r2 },
      { label: "Trim whitespace", action: trimWhitespace },
      { label: "Split text to columns", action: splitToColumns },
      { sep: true },
      { label: "Pivot table…", action: openPivot },
      { label: "Protected ranges…", action: openProtect },
      { label: "Data validation (dropdown list)…", action: openValidation },
      { label: "Data sources and webhooks…", action: openDataSources },
    ],
    Tools: () => [
      { label: "Version history…", action: openHistory },
      { label: "Data sources and webhooks…", action: openDataSources },
      { label: "Open Webhook leads", action: () => { location.href = "/editor?id=webhook-leads"; } },
    ].concat(me.role === "admin" ? [
      { sep: true },
      { label: "Users and audit log (admin)", action: () => window.open("/control", "_blank") },
      { label: "Grist data store (admin)", action: () => window.open("/grist/", "_blank") },
    ] : []),
    Help: () => [
      { label: "Keyboard shortcuts", kbd: MOD + "/", action: openShortcuts },
      { label: "Function list", action: openFunctionList },
      { sep: true },
      { label: "About Aureum Data Sheet", action: () => toast("Aureum Data Sheet: shared spreadsheets saved on this workspace server, with webhook ingestion. Signed in as " + (me.username || "unknown") + " (" + me.role + ").") },
    ],
  };
  const menubar = $("menubar");
  for (const name of Object.keys(MENUS)) {
    const b = document.createElement("button");
    b.className = "menu-btn";
    b.type = "button";
    b.textContent = name;
    const open = () => {
      if (editing) commitEdit();
      showMenu(b, MENUS[name]());
      openMenuBtn = b;
      b.classList.add("open");
    };
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (!doc) return;
      if (openMenuBtn === b) closePopups();
      else open();
    });
    b.addEventListener("mouseenter", () => { if (openMenuBtn && openMenuBtn !== b) open(); });
    menubar.appendChild(b);
  }

  // ---------------------------------------------------------------- toolbar
  const PALETTE = [
    "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff",
    "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff",
    "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc",
    "#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd",
    "#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0",
    "#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79",
  ];
  function colorPicker(anchor, prop) {
    const pop = openPopup(anchor, "popup");
    pop.innerHTML = '<button class="item" data-reset="1"><span class="check"></span><span class="label">Reset</span></button><div class="palette">' + PALETTE.map((c) => '<button title="' + c + '" data-color="' + c + '" style="background:' + c + '"></button>').join("") + "</div>";
    pop.addEventListener("mousedown", (e) => e.preventDefault());
    pop.addEventListener("click", (e) => {
      const t = e.target.closest("[data-color],[data-reset]");
      if (!t) return;
      closePopups();
      setStyle({ [prop]: t.dataset.reset ? null : t.dataset.color });
      focusGrid();
    });
    placePopup(pop, anchor);
  }
  function iconMenu(anchor, items) {
    const pop = openPopup(anchor, "popup");
    pop.style.minWidth = "0";
    pop.innerHTML = '<div class="icon-row">' + items.map((it, i) => '<button class="tb" data-i="' + i + '" title="' + it.title + '">' + it.icon + "</button>").join("") + "</div>";
    pop.addEventListener("mousedown", (e) => e.preventDefault());
    pop.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      closePopups();
      items[+b.dataset.i].action();
      focusGrid();
    });
    placePopup(pop, anchor);
  }
  const svg = (d) => '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>';
  const ICONS = {
    left: svg("M3 3h18v2H3V3zm0 4h12v2H3V7zm0 4h18v2H3v-2zm0 4h12v2H3v-2zm0 4h18v2H3v-2z"),
    center: svg("M3 3h18v2H3V3zm3 4h12v2H6V7zm-3 4h18v2H3v-2zm3 4h12v2H6v-2zm-3 4h18v2H3v-2z"),
    right: svg("M3 3h18v2H3V3zm6 4h12v2H9V7zm-6 4h18v2H3v-2zm6 4h12v2H9v-2zm-6 4h18v2H3v-2z"),
    top: svg("M8 11h3v10h2V11h3l-4-4-4 4zM4 3v2h16V3H4z"),
    middle: svg("M8 19h3v4h2v-4h3l-4-4-4 4zm8-14h-3V1h-2v4H8l4 4 4-4zM4 11v2h16v-2H4z"),
    bottom: svg("M16 13h-3V3h-2v10H8l4 4 4-4zM4 19v2h16v-2H4z"),
    all: svg("M3 3v18h18V3H3zm8 16H5v-6h6v6zm0-8H5V5h6v6zm8 8h-6v-6h6v6zm0-8h-6V5h6v6z"),
    inner: svg("M3 21h2v-2H3v2zm4 0h2v-2H7v2zM5 7H3v2h2V7zM3 17h2v-2H3v2zM9 3H7v2h2V3zM5 3H3v2h2V3zm12 0h-2v2h2V3zm2 6h2V7h-2v2zm0-6v2h2V3h-2zm-4 18h2v-2h-2v2zM13 3h-2v8H3v2h8v8h2v-8h8v-2h-8V3zm6 18h2v-2h-2v2zm0-4h2v-2h-2v2z"),
    outer: svg("M13 7h-2v2h2V7zm0 4h-2v2h2v-2zm4 0h-2v2h2v-2zM3 3v18h18V3H3zm16 16H5V5h14v14zm-6-4h-2v2h2v-2zm-4-4H7v2h2v-2z"),
    btop: svg("M7 21h2v-2H7v2zm0-8h2v-2H7v2zm4 0h2v-2h-2v2zm0 8h2v-2h-2v2zm-8-4h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2v-2H3v2zm0-4h2V7H3v2zm8 8h2v-2h-2v2zm8-8h2V7h-2v2zm0 4h2v-2h-2v2zM3 3v2h18V3H3zm16 14h2v-2h-2v2zm-4 4h2v-2h-2v2zM11 9h2V7h-2v2zm8 12h2v-2h-2v2zm-4-8h2v-2h-2v2z"),
    bbottom: svg("M9 11H7v2h2v-2zm4 4h-2v2h2v-2zM9 3H7v2h2V3zm4 8h-2v2h2v-2zM5 3H3v2h2V3zm8 4h-2v2h2V7zm4 4h-2v2h2v-2zm-4-8h-2v2h2V3zm4 0h-2v2h2V3zm2 10h2v-2h-2v2zm0 4h2v-2h-2v2zM5 7H3v2h2V7zm14-4v2h2V3h-2zm0 6h2V7h-2v2zM5 11H3v2h2v-2zM3 21h18v-2H3v2zm2-6H3v2h2v-2z"),
    bleft: svg("M11 21h2v-2h-2v2zm0-4h2v-2h-2v2zm0-12h2V3h-2v2zm0 4h2V7h-2v2zm0 4h2v-2h-2v2zm-4 8h2v-2H7v2zM7 5h2V3H7v2zm0 8h2v-2H7v2zm-4 8h2V3H3v18zM19 9h2V7h-2v2zm-4 12h2v-2h-2v2zm4-4h2v-2h-2v2zm0-14v2h2V3h-2zm0 10h2v-2h-2v2zm0 8h2v-2h-2v2zm-4-8h2v-2h-2v2zm0-8h2V3h-2v2z"),
    bright: svg("M7 21h2v-2H7v2zM3 5h2V3H3v2zm4 0h2V3H7v2zm0 8h2v-2H7v2zm-4 8h2v-2H3v2zm8 0h2v-2h-2v2zm-8-8h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm8 8h2v-2h-2v2zm4-4h2v-2h-2v2zm4-10v18h2V3h-2zm-4 18h2v-2h-2v2zm0-16h2V3h-2v2zm-4 8h2v-2h-2v2zm0-8h2V3h-2v2zm0 4h2V7h-2v2z"),
    none: svg("M7 5h2V3H7v2zm0 8h2v-2H7v2zm0 8h2v-2H7v2zm4-4h2v-2h-2v2zm0 4h2v-2h-2v2zm-8 0h2v-2H3v2zm0-4h2v-2H3v2zm0-4h2v-2H3v2zm0-4h2V7H3v2zm0-4h2V3H3v2zm8 8h2v-2h-2v2zm8 4h2v-2h-2v2zm0-4h2v-2h-2v2zm0 8h2v-2h-2v2zm0-12h2V7h-2v2zm-8 0h2V7h-2v2zm8-6v2h2V3h-2zm-8 2h2V3h-2v2zm4 16h2v-2h-2v2zm0-8h2v-2h-2v2zm0-8h2V3h-2v2z"),
  };
  const TOOLBAR_MENUS = {
    numfmt: (b) => showMenu(b, fmtItems()),
    textColor: (b) => colorPicker(b, "color"),
    fillColor: (b) => colorPicker(b, "bg"),
    borders: (b) => iconMenu(b, [
      { title: "All borders", icon: ICONS.all, action: () => setBorders("all") },
      { title: "Inner borders", icon: ICONS.inner, action: () => setBorders("inner") },
      { title: "Outer borders", icon: ICONS.outer, action: () => setBorders("outer") },
      { title: "Top border", icon: ICONS.btop, action: () => setBorders("top") },
      { title: "Bottom border", icon: ICONS.bbottom, action: () => setBorders("bottom") },
      { title: "Left border", icon: ICONS.bleft, action: () => setBorders("left") },
      { title: "Right border", icon: ICONS.bright, action: () => setBorders("right") },
      { title: "Clear borders", icon: ICONS.none, action: () => setBorders("none") },
    ]),
    halign: (b) => iconMenu(b, [
      { title: "Left", icon: ICONS.left, action: () => setStyle({ ha: "left" }) },
      { title: "Center", icon: ICONS.center, action: () => setStyle({ ha: "center" }) },
      { title: "Right", icon: ICONS.right, action: () => setStyle({ ha: "right" }) },
    ]),
    valign: (b) => iconMenu(b, [
      { title: "Top", icon: ICONS.top, action: () => setStyle({ va: "top" }) },
      { title: "Middle", icon: ICONS.middle, action: () => setStyle({ va: "middle" }) },
      { title: "Bottom", icon: ICONS.bottom, action: () => setStyle({ va: null }) },
    ]),
    functions: (b) => showMenu(b, FUNCTION_QUICK.map((f) => ({ label: f, action: () => insertFunction(f) })).concat([{ sep: true }, { label: "All functions…", action: openFunctionList }])),
  };
  const COMMANDS = {
    undo, redo,
    print: () => window.print(),
    paintFormat: () => {
      paintFormat = paintFormat ? null : clone(styleOf(active.r, active.c));
      updateToolbarState();
      if (paintFormat) toast("Click or drag over cells to paste the format");
    },
    fmtCurrency: () => setFormat(styleOf(active.r, active.c).fmt === "currency" ? "auto" : "currency"),
    fmtPercent: () => setFormat(styleOf(active.r, active.c).fmt === "percent" ? "auto" : "percent"),
    decDown: () => changeDecimals(-1),
    decUp: () => changeDecimals(1),
    sizeDown: () => changeSize(-1),
    sizeUp: () => changeSize(1),
    bold: () => toggleStyle("b"),
    italic: () => toggleStyle("i"),
    underline: () => toggleStyle("u"),
    strike: () => toggleStyle("st"),
    wrap: () => toggleStyle("wrap"),
    merge: toggleMerge,
    insertLink,
    filter: toggleFilter,
  };
  $("toolbar").addEventListener("mousedown", (e) => {
    const b = e.target.closest("button");
    if (b) e.preventDefault();
  });
  $("toolbar").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !doc) return;
    if (editing) commitEdit();
    if (b.dataset.menu) {
      if (layer.children.length && b.classList.contains("open")) { closePopups(); return; }
      TOOLBAR_MENUS[b.dataset.menu](b);
      return;
    }
    const cmd = COMMANDS[b.dataset.cmd];
    if (cmd) cmd();
    if (!document.querySelector(".dialog")) focusGrid();
  });
  $("font-family").addEventListener("change", (e) => {
    setStyle({ font: e.target.value === "Arial" ? null : e.target.value });
    focusGrid();
  });
  $("font-size").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const n = parseFloat(e.target.value);
    if (n > 0 && n <= 400) setStyle({ size: n === 10 ? null : n });
    focusGrid();
  });
  $("font-size").addEventListener("blur", () => updateToolbarState());
  $("zoom").addEventListener("change", (e) => { setZoom(parseFloat(e.target.value)); focusGrid(); });
  function setZoom(z) {
    zoom = z;
    grid.style.zoom = z;
    const sel = $("zoom");
    if (![...sel.options].some((o) => parseFloat(o.value) === z)) sel.insertAdjacentHTML("beforeend", '<option value="' + z + '">' + Math.round(z * 100) + "%</option>");
    sel.value = String(z);
    renderWindow(true);
    renderCharts();
  }
  function setFreeze(which, n) {
    mutate(() => {
      if (which === "rows") sheet.freezeRows = n;
      else sheet.freezeCols = n;
    }, { rebuild: true });
  }

  // ---------------------------------------------------------------- dialogs
  function openDialog(html, onMount) {
    closePopups();
    const back = document.createElement("div");
    back.className = "dialog-backdrop";
    back.innerHTML = '<div class="dialog" role="dialog">' + html + "</div>";
    document.body.appendChild(back);
    const close = () => { back.remove(); focusGrid(); };
    back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } e.stopPropagation(); });
    back.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
    if (onMount) onMount(back.querySelector(".dialog"), close);
    return close;
  }
  function openFind(replace) {
    openDialog(
      "<h2>Find and replace</h2>" +
        '<div class="row"><label for="f-find">Find</label><input type="text" id="f-find"></div>' +
        '<div class="row"><label for="f-rep">Replace with</label><input type="text" id="f-rep"></div>' +
        '<div class="row"><label></label><span><input type="checkbox" id="f-case"> <label for="f-case" style="width:auto">Match case</label> &nbsp; <input type="checkbox" id="f-all"> <label for="f-all" style="width:auto">All sheets</label></span></div>' +
        '<div class="note" id="f-note"></div>' +
        '<div class="actions"><button class="btn" id="f-next">Find</button><button class="btn" id="f-one">Replace</button><button class="btn" id="f-every">Replace all</button><button class="btn primary" data-close>Done</button></div>',
      (dlg) => {
        const q = dlg.querySelector("#f-find");
        q.value = lastFind;
        q.focus();
        q.select();
        if (!replace) dlg.querySelector("#f-rep").closest(".row").style.display = "none";
        const note = dlg.querySelector("#f-note");
        const opts = () => ({ text: q.value, rep: dlg.querySelector("#f-rep").value, cs: dlg.querySelector("#f-case").checked, all: dlg.querySelector("#f-all").checked });
        const next = () => {
          const o = opts();
          lastFind = o.text;
          const hit = findNext(o);
          note.textContent = hit ? "" : "No results for \"" + o.text + "\"";
          return hit;
        };
        dlg.querySelector("#f-next").addEventListener("click", next);
        q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); next(); } });
        dlg.querySelector("#f-one").addEventListener("click", () => {
          const o = opts();
          const cell = sheet.cells[key(active.r, active.c)];
          if (cell && matches(cell, o)) writeCells([[active.r, active.c, replaceIn(cell.v, o)]]);
          next();
        });
        dlg.querySelector("#f-every").addEventListener("click", () => {
          const o = opts();
          if (!o.text) return;
          let n = 0;
          mutate(() => {
            for (const sh of o.all ? doc.sheets : [sheet]) for (const k in sh.cells) {
              const cell = sh.cells[k];
              if (cell.v && matchesRaw(cell.v, o)) { cell.v = replaceIn(cell.v, o); n++; }
            }
          });
          note.textContent = "Replaced " + n + " cell" + (n === 1 ? "" : "s");
        });
      }
    );
  }
  let lastFind = "";
  const matchesRaw = (v, o) => (o.cs ? v.includes(o.text) : v.toLowerCase().includes(o.text.toLowerCase()));
  function matches(cell, o) { return !!o.text && !!cell.v && matchesRaw(displayRaw(cell), o); }
  function replaceIn(v, o) {
    const re = new RegExp(o.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), o.cs ? "g" : "gi");
    return v.replace(re, o.rep.replace(/\$/g, "$$$$"));
  }
  function findNext(o) {
    if (!o.text) return false;
    const sheets = o.all ? doc.sheets.map((s, i) => i) : [doc.active];
    const order = sheets.slice(sheets.indexOf(doc.active)).concat(sheets.slice(0, sheets.indexOf(doc.active)));
    for (let pass = 0; pass < order.length; pass++) {
      const si = order[pass];
      const sh = doc.sheets[si];
      const hits = Object.keys(sh.cells).map((k) => k.split(":").map(Number)).filter(([r, c]) => {
        const cell = sh.cells[key(r, c)];
        if (!cell.v) return false;
        const shown = formatValue(safeCellValue(sh, r, c), effectiveFmt(cell), (cell.s || {}).dec);
        return matchesRaw(cell.v, o) || matchesRaw(shown, o);
      }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (!hits.length) continue;
      let target = hits[0];
      if (pass === 0) {
        const after = hits.find(([r, c]) => r > active.r || (r === active.r && c > active.c));
        if (after) target = after;
        else if (order.length > 1) continue;
      }
      if (si !== doc.active) switchSheet(si);
      select(target[0], target[1]);
      ensureVisible(target[0], target[1]);
      return true;
    }
    return false;
  }
  function insertLink() {
    const cell = sheet.cells[key(active.r, active.c)];
    openDialog(
      "<h2>Insert link</h2>" +
        '<div class="row"><label for="l-text">Text</label><input type="text" id="l-text"></div>' +
        '<div class="row"><label for="l-url">Link</label><input type="text" id="l-url" placeholder="https://"></div>' +
        '<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="l-ok">Apply</button></div>',
      (dlg, close) => {
        const t = dlg.querySelector("#l-text"), u = dlg.querySelector("#l-url");
        t.value = cell && !isFormula(cell.v) ? cell.v : "";
        u.value = (cell && cell.s && cell.s.link) || "";
        (t.value ? u : t).focus();
        const ok = () => {
          let url = u.value.trim();
          if (url && !/^[a-z]+:/i.test(url)) url = "https://" + url;
          if (url && !/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) { toast("Only http, https and mailto links are allowed"); return; }
          close();
          mutate(() => {
            setRaw(active.r, active.c, t.value || url);
            const c = sheet.cells[key(active.r, active.c)];
            if (!c) return;
            c.s = Object.assign({}, c.s || {}, { link: url || undefined });
            if (!url) delete c.s.link;
          });
        };
        dlg.querySelector("#l-ok").addEventListener("click", ok);
        dlg.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); });
      }
    );
  }
  function openShortcuts() {
    const rows = [
      ["Undo / Redo", MOD + "Z / " + MOD + "Y"], ["Copy / Cut / Paste", MOD + "C / X / V"], ["Paste values only", MOD + "Shift+V"],
      ["Bold / Italic / Underline", MOD + "B / I / U"], ["Strikethrough", "Alt+Shift+5"], ["Align left / center / right", MOD + "Shift+L / E / R"],
      ["Format as number / currency / percent", MOD + "Shift+1 / 4 / 5"], ["Clear formatting", MOD + "\\"], ["Edit cell", "Enter or F2"],
      ["New line in cell", "Alt+Enter"], ["Fill down / right", MOD + "D / " + MOD + "R"], ["Select all", MOD + "A"],
      ["Select column / row", MOD + "Space / Shift+Space"], ["Jump to data edge", MOD + "Arrow"], ["Insert date", MOD + ";"],
      ["Find / Find and replace", MOD + "F / " + MOD + "H"], ["Insert link", MOD + "K"], ["New sheet", "Shift+F11"],
      ["Next / previous sheet", "Alt+↓ / Alt+↑"], ["Print", MOD + "P"],
    ];
    openDialog("<h2>Keyboard shortcuts</h2><table class=\"shortcuts\">" + rows.map((r) => "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>").join("") + '</table><div class="actions"><button class="btn primary" data-close>Close</button></div>');
  }
  function openFunctionList() {
    const names = Object.keys(FN).concat(Object.keys(LAZY)).sort();
    openDialog(
      "<h2>Functions</h2><p class=\"note\">Click a function to insert it into the selected cell. Formulas start with = and can reference other sheets like Sheet2!A1.</p>" +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">' + names.map((n) => '<button class="btn" style="height:30px;padding:0 10px;font-size:12px" data-fn="' + n + '" title="' + escapeHtml(FN_HELP[n] || n + "(…)") + '">' + n + "</button>").join("") + "</div>" +
        '<div class="actions"><button class="btn primary" data-close>Close</button></div>',
      (dlg, close) => dlg.addEventListener("click", (e) => {
        const b = e.target.closest("[data-fn]");
        if (!b) return;
        close();
        insertFunction(b.dataset.fn);
      })
    );
  }

  // ---------------------------------------------------------------- file actions
  function sheetToDelimited(delim) {
    let { r2, c2 } = usedBounds();
    ensureSpills(sheet);
    for (const sk of spillValues.keys()) {
      if (!sk.startsWith(sheet.id + "|")) continue;
      const [r, c] = sk.slice(sheet.id.length + 1).split("|").map(Number);
      r2 = Math.max(r2, r);
      c2 = Math.max(c2, c);
    }
    const lines = [];
    for (let r = 0; r <= r2; r++) {
      const parts = [];
      for (let c = 0; c <= c2; c++) {
        const cell = sheet.cells[key(r, c)];
        let t = formatValue(safeCellValue(sheet, r, c), effectiveFmt(cell), cell && cell.s ? cell.s.dec : undefined);
        if (t.includes(delim) || /["\n\r]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"';
        parts.push(t);
      }
      lines.push(parts.join(delim));
    }
    return lines.join("\r\n");
  }
  function download(kind) {
    const text = sheetToDelimited(kind === "csv" ? "," : "\t");
    const blob = new Blob([kind === "csv" ? "﻿" + text : text], { type: kind === "csv" ? "text/csv" : "text/tab-separated-values" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (doc.title || "Spreadsheet") + " - " + sheet.name + "." + kind;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  $("file-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const text = (await file.text()).replace(/^﻿/, "");
    const delim = /\.tsv$/i.test(file.name) || (text.split("\n")[0].includes("\t") && !text.split("\n")[0].includes(",")) ? "\t" : ",";
    const rows = parseDelimited(text, delim);
    const width = Math.max(26, ...rows.map((r) => r.length));
    const sh = newSheet(uniqueSheetName(file.name.replace(/\.[^.]+$/, "").slice(0, 60)), Math.max(100, rows.length + 20), width);
    rows.forEach((row, r) => row.forEach((v, c) => {
      if (v === "") return;
      const det = detectInput(v);
      sh.cells[key(r, c)] = det.fmt ? { v: det.v, s: { fmt: det.fmt } } : { v: det.v };
    }));
    if (rows.length) sh.freezeRows = 1;
    addSheet(sh);
    toast("Imported " + rows.length + " rows from " + file.name);
  });
  async function makeCopy() {
    const copy = clone(doc);
    copy.id = uid();
    copy.title = "Copy of " + doc.title;
    copy.starred = false;
    storageSet(DOC_PREFIX + copy.id, JSON.stringify(copy));
    writeIndexEntry(copy);
    // Open the tab before awaiting so the popup blocker treats it as a user action.
    const tab = window.open("about:blank", "_blank");
    if (server.available === true) {
      try { await api("PUT", "/api/sheets/" + encodeURIComponent(copy.id), { baseVersion: 0, doc: copy }); } catch { /* the copy is still in this browser */ }
    }
    if (tab) tab.location.href = "/editor?id=" + encodeURIComponent(copy.id);
    else location.href = "/editor?id=" + encodeURIComponent(copy.id);
  }
  async function deleteDoc() {
    if (!confirm("Delete \"" + doc.title + "\"? This cannot be undone.")) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    const wasOnServer = server.available === true;
    server.available = false;
    if (wasOnServer) {
      try {
        const res = await api("DELETE", docPath());
        if (res.status !== 200 && res.status !== 404) { toast("Couldn't delete on the server: " + ((res.data && res.data.error) || res.status)); server.available = true; return; }
      } catch {
        toast("Server unreachable; nothing was deleted");
        server.available = true;
        return;
      }
    }
    try { localStorage.removeItem(DOC_PREFIX + doc.id); } catch { /* ignore */ }
    storageSet(INDEX_KEY, JSON.stringify(readIndex().filter((e) => e.id !== doc.id)));
    location.href = "/";
  }

  // ---------------------------------------------------------------- mouse
  let drag = null;
  function cellFromTarget(t) {
    const td = t.closest && t.closest("td");
    if (!td || !grid.contains(td) || td.parentElement.dataset.r === undefined) return null;
    return { r: +td.parentElement.dataset.r, c: td.cellIndex - 1, td };
  }
  grid.addEventListener("mousedown", (e) => {
    if (e.button === 2) return;
    const t = e.target;
    if (t.dataset && t.dataset.dv) {
      e.preventDefault();
      const hit = cellFromTarget(t);
      if (hit) openDropdown(hit.r, hit.c, t);
      return;
    }
    if (t.classList.contains("filter-btn")) {
      e.preventDefault();
      openFilterMenu(+t.dataset.filterCol, t);
      return;
    }
    if (t.classList.contains("fill-handle")) {
      e.preventDefault();
      if (editing) commitEdit();
      drag = { type: "fill", src: Object.assign({}, range), target: Object.assign({}, range) };
      return;
    }
    if (t.classList.contains("col-resize")) {
      e.preventDefault();
      const c = t.parentElement.cellIndex - 1;
      drag = { type: "colw", c, x: e.clientX, w: colWidth(c) };
      return;
    }
    if (t.classList.contains("row-resize")) {
      e.preventDefault();
      const r = +t.parentElement.parentElement.dataset.r;
      drag = { type: "rowh", r, y: e.clientY, h: rowHeight(r) };
      return;
    }
    const th = t.closest("th");
    if (th) {
      e.preventDefault();
      if (editing) commitEdit();
      if (th.classList.contains("corner")) { selectAll(); focusGrid(); return; }
      if (th.parentElement.parentElement.tagName === "THEAD") {
        const c = th.cellIndex - 1;
        if (e.shiftKey) { extent = { r: sheet.rows - 1, c }; active = { r: 0, c: active.c }; computeRange(); paintSelection(); }
        else select(0, c, sheet.rows - 1, c);
        drag = { type: "cols", c0: e.shiftKey ? active.c : c };
      } else {
        const r = +th.parentElement.dataset.r;
        if (e.shiftKey) { extent = { r, c: sheet.cols - 1 }; active = { r: active.r, c: 0 }; computeRange(); paintSelection(); }
        else select(r, 0, r, sheet.cols - 1);
        drag = { type: "rows", r0: e.shiftKey ? active.r : r };
      }
      focusGrid();
      return;
    }
    const hit = cellFromTarget(t);
    if (!hit) return;
    e.preventDefault();
    if (editing && editorIsFormulaRefPoint() && !(hit.r === editAt.r && hit.c === editAt.c)) {
      insertRef(hit.r, hit.c, hit.r, hit.c);
      drag = { type: "ref", r0: hit.r, c0: hit.c };
      editor.focus({ preventScroll: true });
      return;
    }
    if (editing) commitEdit();
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const cell = sheet.cells[key(hit.r, hit.c)];
      const v = cell && safeCellValue(sheet, hit.r, hit.c);
      const url = cell && cell.s && cell.s.link ? cell.s.link : typeof v === "string" && /^https?:\/\/\S+$/.test(v) ? v : null;
      // Documents are shared, so a stored link is checked here too (never javascript: or data:).
      if (url && /^(https?:\/\/|mailto:)/i.test(String(url).trim())) { window.open(String(url).trim(), "_blank", "noopener"); return; }
    }
    if (e.shiftKey) extendTo(hit.r, hit.c);
    else select(hit.r, hit.c);
    drag = { type: "cells" };
    focusGrid();
  });
  grid.addEventListener("dblclick", (e) => {
    if (e.target.closest("th")) {
      const rs = e.target.classList.contains("col-resize");
      if (rs) {
        const c = e.target.parentElement.cellIndex - 1;
        autoFitColumn(c);
      }
      return;
    }
    const hit = cellFromTarget(e.target);
    if (!hit) return;
    startEdit(undefined, "full");
  });
  function autoFitColumn(c) {
    const meas = document.createElement("span");
    meas.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:13.333px Arial";
    document.body.appendChild(meas);
    let w = 40;
    // Measures every row from the data, not just the rows currently in the DOM.
    for (const k in sheet.cells) {
      const i = k.indexOf(":");
      if (+k.slice(i + 1) !== c) continue;
      const r = +k.slice(0, i);
      const cell = sheet.cells[k];
      const s = cell.s || {};
      const text = formatValue(safeCellValue(sheet, r, c), effectiveFmt(cell), s.dec);
      if (!text) continue;
      const family = typeof s.font === "string" && /^[A-Za-z0-9 -]{1,40}$/.test(s.font) ? "'" + s.font + "', Arial" : "Arial";
      meas.style.font = (s.i ? "italic " : "") + (s.b ? "700 " : "") + ((s.size || 10) * 4 / 3).toFixed(2) + "px " + family;
      meas.textContent = text;
      w = Math.max(w, meas.offsetWidth + 14);
    }
    meas.remove();
    mutate(() => { sheet.colW[c] = Math.min(600, Math.ceil(w)); }, { rebuild: true });
  }
  document.addEventListener("mousemove", (e) => {
    if (!drag) return;
    if (drag.type === "colw") {
      const w = Math.max(20, drag.w + (e.clientX - drag.x) / zoom);
      grid.querySelectorAll("col")[drag.c + 1].style.width = w + "px";
      setTableWidth({ c: drag.c, w });
      drag.nw = w;
      return;
    }
    if (drag.type === "rowh") {
      const h = Math.max(12, drag.h + (e.clientY - drag.y) / zoom);
      tbodyRows[drag.r].style.height = h + "px";
      drag.nh = h;
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    if (drag.type === "cols" || drag.type === "rows") {
      const th = el.closest && el.closest("th");
      if (!th || !grid.contains(th)) return;
      if (drag.type === "cols" && th.parentElement.parentElement.tagName === "THEAD" && th.cellIndex > 0) {
        active = { r: 0, c: drag.c0 };
        extent = { r: sheet.rows - 1, c: th.cellIndex - 1 };
        computeRange(); paintSelection();
      } else if (drag.type === "rows" && th.parentElement.parentElement.tagName === "TBODY") {
        active = { r: drag.r0, c: 0 };
        extent = { r: +th.parentElement.dataset.r, c: sheet.cols - 1 };
        computeRange(); paintSelection();
      }
      return;
    }
    const hit = cellFromTarget(el);
    if (!hit) return;
    if (drag.type === "cells") {
      if (hit.r !== extent.r || hit.c !== extent.c) extendTo(hit.r, hit.c);
    } else if (drag.type === "ref") {
      insertRef(drag.r0, drag.c0, hit.r, hit.c);
      refInsert.r = drag.r0;
      refInsert.c = drag.c0;
    } else if (drag.type === "fill") {
      const s = drag.src;
      const dDown = hit.r - s.r2, dUp = s.r1 - hit.r, dRight = hit.c - s.c2, dLeft = s.c1 - hit.c;
      const best = Math.max(dDown, dUp, dRight, dLeft);
      let t = Object.assign({}, s);
      if (best > 0) {
        if (best === dDown) t.r2 = hit.r;
        else if (best === dUp) t.r1 = hit.r;
        else if (best === dRight) t.c2 = hit.c;
        else t.c1 = hit.c;
      }
      for (let r = drag.target.r1; r <= drag.target.r2; r++) for (let c = drag.target.c1; c <= drag.target.c2; c++) { const td = cellEl(r, c); if (td) td.classList.remove("fill-preview"); }
      drag.target = t;
      for (let r = t.r1; r <= t.r2; r++) for (let c = t.c1; c <= t.c2; c++) { if (!(r >= s.r1 && r <= s.r2 && c >= s.c1 && c <= s.c2)) { const td = cellEl(r, c); if (td) td.classList.add("fill-preview"); } }
    }
  });
  document.addEventListener("mouseup", () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.type === "colw" && d.nw) mutate(() => { sheet.colW[d.c] = Math.round(d.nw); }, { rebuild: true });
    if (d.type === "rowh" && d.nh) mutate(() => { sheet.rowH[d.r] = Math.round(d.nh); }, { rebuild: true });
    if (d.type === "fill") {
      grid.querySelectorAll(".fill-preview").forEach((td) => td.classList.remove("fill-preview"));
      const s = d.src, t = d.target;
      if (t.r1 !== s.r1 || t.r2 !== s.r2 || t.c1 !== s.c1 || t.c2 !== s.c2) fillFromHandle(s, t);
    }
    if (d.type === "cells" && paintFormat) {
      const fmt = paintFormat;
      paintFormat = null;
      mutate(() => forRange((r, c) => {
        const k = key(r, c);
        const cell = sheet.cells[k] || (sheet.cells[k] = { v: "" });
        if (Object.keys(fmt).length) cell.s = clone(fmt); else delete cell.s;
        if (cell.v === "" && !cell.s) delete sheet.cells[k];
      }));
    }
  });
  grid.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const th = e.target.closest("th");
    const hit = cellFromTarget(e.target);
    if (editing) commitEdit();
    if (hit && !inRange(hit.r, hit.c)) select(hit.r, hit.c);
    if (th && !th.classList.contains("corner")) {
      if (th.parentElement.parentElement.tagName === "THEAD") { const c = th.cellIndex - 1; if (!(c >= range.c1 && c <= range.c2 && range.r1 === 0 && range.r2 === sheet.rows - 1)) select(0, c, sheet.rows - 1, c); }
      else { const r = +th.parentElement.dataset.r; if (!(r >= range.r1 && r <= range.r2 && range.c1 === 0 && range.c2 === sheet.cols - 1)) select(r, 0, r, sheet.cols - 1); }
    }
    const nR = range.r2 - range.r1 + 1, nC = range.c2 - range.c1 + 1;
    showMenu({ x: e.clientX, y: e.clientY }, [
      { label: "Cut", kbd: MOD + "X", action: () => menuCopy(true) },
      { label: "Copy", kbd: MOD + "C", action: () => menuCopy(false) },
      { label: "Paste", kbd: MOD + "V", action: () => menuPaste(false) },
      { label: "Paste values only", kbd: MOD + "Shift+V", action: () => menuPaste(true) },
      { sep: true },
      { label: "Insert " + nR + " row" + (nR > 1 ? "s" : "") + " above", action: () => insertRows(range.r1, nR) },
      { label: "Insert " + nR + " row" + (nR > 1 ? "s" : "") + " below", action: () => insertRows(range.r2 + 1, nR) },
      { label: "Insert " + nC + " column" + (nC > 1 ? "s" : "") + " left", action: () => insertCols(range.c1, nC) },
      { label: "Insert " + nC + " column" + (nC > 1 ? "s" : "") + " right", action: () => insertCols(range.c2 + 1, nC) },
      { sep: true },
      { label: "Delete " + rowsLabel(), action: () => deleteRows(range.r1, nR) },
      { label: "Delete " + colsLabel(), action: () => deleteCols(range.c1, nC) },
      { label: "Clear values", kbd: "Del", action: clearValues },
      { sep: true },
      { label: "Hide " + rowsLabel(), action: () => hideRows(range.r1, range.r2) },
      { label: "Hide " + colsLabel(), action: () => hideCols(range.c1, range.c2) },
      { label: "Unhide rows next to the selection", action: () => unhide(true, range.r1, range.r2), disabled: () => !(sheet.hiddenRowsList || []).some((x) => x >= range.r1 - 1 && x <= range.r2 + 1) },
      { label: "Unhide columns next to the selection", action: () => unhide(false, range.c1, range.c2), disabled: () => !(sheet.hiddenCols || []).some((x) => x >= range.c1 - 1 && x <= range.c2 + 1) },
      { sep: true },
      { label: "Sort range A → Z", action: () => sortRange(true), disabled: () => range.r1 === range.r2 },
      { label: "Insert link", kbd: MOD + "K", action: insertLink },
      { label: (sheet.cells[key(active.r, active.c)] || {}).note ? "Edit note" : "Insert note", kbd: "Shift+F2", action: editNote },
      { label: threadsAt(active.r, active.c).length ? "Open comments" : "Comment", kbd: MOD + "Alt+M", action: () => openComments() },
      { label: "Protect range…", action: openProtect },
      { label: "Data validation…", action: openValidation },
      { label: "Conditional formatting…", action: openCondFormat },
      { label: "Clear formatting", kbd: MOD + "\\", action: clearFormatting },
    ]);
  });
  // ---------------------------------------------------------------- touch (phones and tablets)
  // Tap selects (browsers turn taps into mouse events), double-tap edits, a short hold then drag
  // selects a range, and a long press opens the context menu. Plain swipes keep scrolling the grid.
  let touch = null;
  let lastTap = null;
  grid.addEventListener("touchstart", (e) => {
    // The hidden keyboard field must not raise the on-screen keyboard on every tap.
    sink.setAttribute("inputmode", "none");
    if (e.touches.length !== 1) { touch = null; return; }
    const pt = e.touches[0];
    const hit = cellFromTarget(pt.target);
    if (!hit) return;
    touch = { x: pt.clientX, y: pt.clientY, start: hit, moved: false, mode: null, at: Date.now(), target: pt.target };
    touch.holdTimer = setTimeout(() => {
      if (!touch || touch.moved) return;
      touch.mode = "select";
      if (editing) commitEdit();
      select(hit.r, hit.c);
    }, 350);
    touch.menuTimer = setTimeout(() => {
      if (!touch || touch.moved || touch.mode === "drag") return;
      touch.mode = "menu";
      touch.target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: touch.x, clientY: touch.y }));
    }, 650);
  }, { passive: true });
  grid.addEventListener("touchmove", (e) => {
    if (!touch) return;
    const pt = e.touches[0];
    const far = Math.abs(pt.clientX - touch.x) > 10 || Math.abs(pt.clientY - touch.y) > 10;
    if (touch.mode === "select" || touch.mode === "drag") {
      e.preventDefault();
      touch.mode = "drag";
      const el = document.elementFromPoint(pt.clientX, pt.clientY);
      const hit = el && cellFromTarget(el);
      if (hit) extendTo(hit.r, hit.c);
      return;
    }
    if (far) {
      touch.moved = true;
      clearTimeout(touch.holdTimer);
      clearTimeout(touch.menuTimer);
    }
  }, { passive: false });
  grid.addEventListener("touchend", (e) => {
    if (!touch) return;
    clearTimeout(touch.holdTimer);
    clearTimeout(touch.menuTimer);
    const t = touch;
    touch = null;
    if (t.mode === "menu" || t.mode === "drag") { e.preventDefault(); return; }
    if (t.moved || Date.now() - t.at > 300) return;
    const now = Date.now();
    if (lastTap && now - lastTap.at < 350 && lastTap.r === t.start.r && lastTap.c === t.start.c) {
      e.preventDefault();
      lastTap = null;
      select(t.start.r, t.start.c);
      startEdit(undefined, "full");
      return;
    }
    lastTap = { at: now, r: t.start.r, c: t.start.c };
  });
  grid.addEventListener("touchcancel", () => {
    if (touch) { clearTimeout(touch.holdTimer); clearTimeout(touch.menuTimer); }
    touch = null;
  });
  scroller.addEventListener("mousedown", (e) => {
    if (e.target === scroller || e.target.id === "grid-wrap") { if (editing) commitEdit(); focusGrid(); }
  });
  scroller.addEventListener("scroll", () => { if (editing) positionEditor(); });

  function selectAll() {
    active = { r: 0, c: 0 };
    extent = { r: sheet.rows - 1, c: sheet.cols - 1 };
    computeRange();
    paintSelection();
  }

  // ---------------------------------------------------------------- keyboard
  sink.addEventListener("keydown", (e) => {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const code = e.code;
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (mod && e.shiftKey && !e.altKey) {
      const map = { Digit1: () => setFormat("number"), Digit4: () => setFormat("currency"), Digit5: () => setFormat("percent"), KeyL: () => setStyle({ ha: "left" }), KeyE: () => setStyle({ ha: "center" }), KeyR: () => setStyle({ ha: "right" }), KeyV: () => keyPaste(true) };
      if (map[code]) {
        if (code !== "KeyV") e.preventDefault();
        map[code]();
        return;
      }
      if (code === "KeyZ") { e.preventDefault(); redo(); return; }
    }
    if (e.altKey && e.shiftKey && code === "Digit5") { e.preventDefault(); toggleStyle("st"); return; }
    if (e.altKey && (k === "ArrowDown" || k === "ArrowUp") && !(k === "ArrowDown" && validationAt(active.r, active.c))) {
      e.preventDefault();
      switchSheet((doc.active + (k === "ArrowDown" ? 1 : -1) + doc.sheets.length) % doc.sheets.length);
      return;
    }
    if (e.shiftKey && k === "F11") { e.preventDefault(); addSheet(); return; }
    if (e.shiftKey && k === "F2") { e.preventDefault(); editNote(); return; }
    if ((e.ctrlKey || e.metaKey) && e.altKey && (k === "m" || k === "M" || e.code === "KeyM")) { e.preventDefault(); openComments(); return; }
    if (e.altKey && k === "ArrowDown" && validationAt(active.r, active.c)) {
      e.preventDefault();
      const td = cellEl(active.r, active.c);
      if (td) openDropdown(active.r, active.c, td);
      return;
    }
    if (mod && !e.altKey) {
      if (arrows[k]) {
        e.preventDefault();
        const from = e.shiftKey ? extent : active;
        const to = jumpFrom(from, arrows[k][0], arrows[k][1]);
        if (e.shiftKey) extendTo(to.r, to.c); else select(to.r, to.c);
        ensureVisible(to.r, to.c);
        return;
      }
      const lk = k.toLowerCase();
      const handlers = {
        z: undo, y: redo,
        b: () => toggleStyle("b"), i: () => toggleStyle("i"), u: () => toggleStyle("u"),
        a: selectAll, f: () => openFind(false), h: () => openFind(true), p: () => window.print(),
        s: () => { saveNow(); toast("All changes saved in this browser"); },
        d: () => fill("down"), r: () => fill("right"), k: insertLink,
        "\\": clearFormatting, "/": openShortcuts,
        ";": () => writeCells([[active.r, active.c, fmtDate(dateToSerial(new Date()))]]),
        " ": () => select(0, active.c, sheet.rows - 1, active.c),
        home: () => { select(0, 0); ensureVisible(0, 0); },
        end: () => { const b = usedBounds(); select(Math.max(0, b.r2), Math.max(0, b.c2)); ensureVisible(Math.max(0, b.r2), Math.max(0, b.c2)); },
      };
      if (handlers[lk]) { e.preventDefault(); handlers[lk](); }
      // No preventDefault: the native copy/cut/paste events still fire and use the system clipboard.
      if (lk === "c" || lk === "x") keyCopy(lk === "x");
      if (lk === "v") keyPaste(false);
      return;
    }
    if (arrows[k]) {
      e.preventDefault();
      if (e.shiftKey) {
        const to = moveFrom(extent, arrows[k][0], arrows[k][1]);
        extendTo(to.r, to.c);
        ensureVisible(to.r, to.c);
      } else {
        const to = moveFrom(active, arrows[k][0], arrows[k][1]);
        select(to.r, to.c);
        ensureVisible(to.r, to.c);
      }
      return;
    }
    switch (k) {
      case "Tab": {
        e.preventDefault();
        const to = moveFrom(active, 0, e.shiftKey ? -1 : 1);
        select(to.r, to.c);
        ensureVisible(to.r, to.c);
        return;
      }
      case "Enter":
        e.preventDefault();
        if (e.shiftKey) { const to = moveFrom(active, -1, 0); select(to.r, to.c); ensureVisible(to.r, to.c); }
        else startEdit(undefined, "full");
        return;
      case "F2": e.preventDefault(); startEdit(undefined, "full"); return;
      case "Delete": case "Backspace": e.preventDefault(); clearValues(); return;
      case "Escape": paintFormat = null; clipboard = clipboard && !clipboard.cut ? clipboard : null; updateToolbarState(); return;
      case "Home": e.preventDefault(); select(active.r, 0); ensureVisible(active.r, 0); return;
      case "End": { e.preventDefault(); let c = sheet.cols - 1; while (c > 0 && !hasValue(active.r, c)) c--; select(active.r, c); ensureVisible(active.r, c); return; }
      case "PageDown": case "PageUp": {
        e.preventDefault();
        const rows = Math.max(1, Math.floor(scroller.clientHeight / (DEFAULT_ROW_H * zoom)) - 2);
        const to = moveFrom(active, k === "PageDown" ? rows : -rows, 0);
        select(to.r, to.c);
        ensureVisible(to.r, to.c);
        return;
      }
    }
    if (e.shiftKey && k === " ") { e.preventDefault(); select(active.r, 0, active.r, sheet.cols - 1); return; }
    if (k.length === 1 && !e.altKey) {
      e.preventDefault();
      startEdit(k, "quick");
    }
  });
  // IME / mobile keyboards deliver text through input events instead of keydown.
  sink.addEventListener("input", () => {
    const v = sink.value;
    sink.value = "";
    if (v && !editing) startEdit(v, "quick");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && layer.children.length) { closePopups(); focusGrid(); }
  });

  // ---------------------------------------------------------------- title, star, share, rows
  const titleInput = $("doc-title");
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") {
      if (e.key === "Escape") titleInput.value = doc.title;
      e.preventDefault();
      focusGrid();
    }
  });
  titleInput.addEventListener("blur", () => {
    const t = titleInput.value.trim() || "Untitled spreadsheet";
    titleInput.value = t;
    if (t !== doc.title) {
      doc.title = t;
      scheduleSave();
    }
    document.title = t + " - Aureum Data Sheet";
    sizeTitle();
  });
  titleInput.addEventListener("input", sizeTitle);
  function sizeTitle() {
    titleInput.style.width = Math.min(420, Math.max(60, titleInput.value.length * 9 + 20)) + "px";
  }
  $("star").addEventListener("click", () => {
    if (readOnly()) return refuseReadOnly();
    doc.starred = !doc.starred;
    $("star").classList.toggle("on", doc.starred);
    $("star").innerHTML = doc.starred ? "&#9733;" : "&#9734;";
    scheduleSave();
    toast(doc.starred ? "Starred" : "Removed from starred");
  });
  $("share").addEventListener("click", openShare);
  $("add-rows").addEventListener("click", () => {
    const n = Math.max(1, Math.min(5000, parseInt($("add-rows-count").value, 10) || 100));
    mutate(() => { sheet.rows += n; }, { rebuild: true });
  });
  $("add-sheet").addEventListener("click", () => addSheet());
  $("all-sheets").addEventListener("click", (e) => {
    showMenu(e.currentTarget, doc.sheets.map((s, i) => ({ label: escapeHtml(s.name), checked: () => i === doc.active, action: () => switchSheet(i) })), "up");
  });

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  // ---------------------------------------------------------------- boot
  function showDocMeta() {
    titleInput.value = doc.title;
    document.title = doc.title + " - Aureum Data Sheet";
    sizeTitle();
    $("star").classList.toggle("on", !!doc.starred);
    $("star").innerHTML = doc.starred ? "&#9733;" : "&#9734;";
  }
  async function fetchServerDoc(id) {
    const res = await api("GET", "/api/sheets/" + encodeURIComponent(id));
    if (!res.data) { server.available = false; return null; }
    server.available = true;
    return res.status === 200 ? res.data : null;
  }
  async function boot() {
    setSaveState("Loading…");
    try {
      const who = await api("GET", "/api/me");
      if (who.status === 200 && who.data) me = who.data;
    } catch { /* static preview or offline: keep editing locally */ }
    if (readOnly()) {
      document.body.classList.add("read-only");
      titleInput.readOnly = true;
      $("save-state").insertAdjacentHTML("beforebegin", '<span class="ro-badge" title="Ask an admin for edit access">View only</span>');
    }
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    const tpl = params.get("new");
    let stored = null;
    try {
      if (id) stored = await fetchServerDoc(id);
      else if (!tpl) {
        const list = await api("GET", "/api/sheets");
        server.available = !!list.data;
        const recent = list.data && list.data.documents && list.data.documents[0];
        if (recent) stored = await fetchServerDoc(recent.id);
      }
    } catch {
      server.available = false;
    }
    if (stored) {
      doc = normalizeDoc(stored.doc);
      server.version = stored.version;
      // The merge base is the server's own copy, so normalising does not look like a local edit.
      server.synced = JSON.stringify(doc);
      const pending = readPending(doc.id);
      const local = pending && loadDoc(doc.id);
      if (local && JSON.stringify(local) !== pending.base) {
        // Edits from an earlier visit never reached the server: replay them on the current version.
        doc = mergeDocs(pending.base ? JSON.parse(pending.base) : null, local, stored.doc);
        setTimeout(() => toast("Recovered changes that hadn't been saved to the server yet"), 600);
      }
    } else {
      // Not on the server yet: a sheet made before server saving existed, or a new one.
      if (id) doc = loadDoc(id);
      if (!doc && !tpl && !id && server.available !== true) {
        const recent = readIndex()[0];
        if (recent) doc = loadDoc(recent.id);
      }
      if (!doc) {
        doc = (TEMPLATES[tpl] || TEMPLATES.blank)();
        if (id && !tpl) toast("That spreadsheet wasn't found, so a new one was created");
      }
    }
    normalizeDoc(doc);
    if (params.get("id") !== doc.id) history.replaceState(null, "", location.pathname + "?id=" + encodeURIComponent(doc.id));
    doc.active = Math.max(0, Math.min(doc.active || 0, doc.sheets.length - 1));
    sheet = doc.sheets[doc.active];
    showDocMeta();
    buildGrid();
    computeRange();
    paintSelection();
    renderTabs();
    focusGrid();
    saveNow();
    // Deep link from the mentions inbox: ?sheet=<id>&cell=<row:col> opens that comment thread.
    const linkSheet = params.get("sheet"), linkCell = params.get("cell");
    if (linkCell && /^\d+:\d+$/.test(linkCell)) {
      const idx = doc.sheets.findIndex((s) => s.id === linkSheet);
      if (idx >= 0 && idx !== doc.active) switchSheet(idx);
      const [r, c] = linkCell.split(":").map(Number);
      if (r < sheet.rows && c < sheet.cols) {
        select(r, c);
        ensureVisible(r, c);
        if (threadsAt(r, c).length) openComments(r, c);
      }
      history.replaceState(null, "", location.pathname + "?id=" + encodeURIComponent(doc.id));
    }
  }
  boot();

  // Exposed for automated tests only.
  window.__sheet = { parseFormula, shiftFormula, transformFormula, detectInput, formatValue, get doc() { return doc; }, get clipboard() { return clipboard; }, cellValue: (r, c) => safeCellValue(sheet, r, c), writeCells, select, insertRows, deleteRows, poll: () => pollServer(true), get server() { return Object.assign({}, server); }, mergeDocs, buildXlsxFiles, zipBytes, importXlsxBuffer, hideRows, hideCols, insertCols, deleteCols, fill: fillFromHandle, toggleMerge, rowHidden, isColHidden, condStyle, validationAt, setValidation: (rule) => mutate(() => { (sheet.validation = sheet.validation || []).push(rule); }), addCondFormat: (rule) => mutate(() => { (sheet.condFormats = sheet.condFormats || []).push(rule); }), insertChart, renderChartSvg: (ch) => drawChart(ch, 400, 230), get me() { return me; }, get range() { return Object.assign({}, range); }, setMe: (m) => { me = m; }, addProtection: (rule) => mutate(() => { (sheet.protected = sheet.protected || []).push(rule); }, { rebuild: true }), isLocked, unionComments, threadsAt };
})();
