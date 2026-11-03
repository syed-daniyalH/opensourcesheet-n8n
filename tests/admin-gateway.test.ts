import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAdminGatewayServer, loadAdminGatewayConfig } from "../src/admin-gateway.js";
import type { GristWriter, JsonValue } from "../src/types.js";

const env = {
  ADMIN_GATEWAY_HOST: "127.0.0.1",
  ADMIN_GATEWAY_PORT: "3000",
  GRIST_ORIGIN: "http://127.0.0.1:1",
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "correct-horse-battery",
  ADMIN_SESSION_SECRET: "a-session-secret-that-is-at-least-32-characters-long",
  ADMIN_COOKIE_SECURE: "false",
  GATEWAY_STATE_DIR: mkdtempSync(join(tmpdir(), "gateway-state-shared-")),
};

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withGateway(extraEnv: Record<string, string>, run: (url: string, stateDir: string) => Promise<void>, gristWriter?: GristWriter, fetchImpl?: typeof fetch): Promise<void> {
  const stateDir = await mkdtemp(join(tmpdir(), "gateway-state-"));
  const deps: { gristWriter?: GristWriter; fetchImpl?: typeof fetch } = {};
  if (gristWriter) deps.gristWriter = gristWriter;
  if (fetchImpl) deps.fetchImpl = fetchImpl;
  const gateway = createAdminGatewayServer(loadAdminGatewayConfig({ ...env, GATEWAY_STATE_DIR: stateDir, ...extraEnv }), deps);
  const url = await listen(gateway);
  try {
    await run(url, stateDir);
  } finally {
    await close(gateway);
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function login(gatewayUrl: string, username = "admin", password = "correct-horse-battery"): Promise<{ status: number; cookie: string }> {
  const response = await fetch(`${gatewayUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }).toString(),
  });
  return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "" };
}

function app(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Cookie: cookie, "Content-Type": "application/json", "X-Requested-With": "aureum-sheet", ...extra };
}

test("loads a secure gateway configuration and rejects weak secrets", () => {
  const config = loadAdminGatewayConfig(env);
  assert.equal(config.username, "admin");
  assert.equal(config.gristOrigin, "http://127.0.0.1:1");
  assert.ok(config.sheetDataDir.startsWith(config.stateDir));
  assert.throws(() => loadAdminGatewayConfig({ ...env, ADMIN_PASSWORD: "short" }), /at least 12/);
  assert.throws(() => loadAdminGatewayConfig({ ...env, ADMIN_SESSION_SECRET: "short" }), /at least 32/);
});

test("validates webhook, Grist forwarding, and Meta settings", () => {
  assert.equal(loadAdminGatewayConfig(env).webhookSecret, null);
  assert.equal(loadAdminGatewayConfig(env).webhookGrist, null);
  assert.equal(loadAdminGatewayConfig(env).meta, null);
  assert.throws(() => loadAdminGatewayConfig({ ...env, WEBHOOK_SECRET: "too-short" }), /at least 24/);
  assert.throws(() => loadAdminGatewayConfig({ ...env, DRY_RUN: "false", GRIST_BASE_URL: "http://grist:8484" }), /GRIST_DOC_ID/);
  const config = loadAdminGatewayConfig({ ...env, DRY_RUN: "false", GRIST_BASE_URL: "http://grist:8484/", GRIST_DOC_ID: "doc", GRIST_TABLE_ID: "Leads", GRIST_API_KEY: "key" });
  assert.equal(config.webhookGrist?.baseUrl, "http://grist:8484");
  assert.equal(loadAdminGatewayConfig({ ...env, GRIST_BASE_URL: "http://grist:8484" }).webhookGrist, null, "DRY_RUN defaults to true");
  assert.throws(() => loadAdminGatewayConfig({ ...env, META_VERIFY_TOKEN: "verify-token-long-enough" }), /together/);
  assert.equal(loadAdminGatewayConfig({ ...env, META_VERIFY_TOKEN: "verify-token-long-enough", META_APP_SECRET: "s" }).meta?.accessToken, null);
});

test("accepts authenticated webhooks (bearer, header, HMAC), supports dry runs, and logs sync runs", async () => {
  const secret = "n8n-shared-secret-with-enough-length";
  const forwarded: Array<ReadonlyArray<Record<string, JsonValue>>> = [];
  const gristWriter: GristWriter = { async upsert(_table, records) { forwarded.push(records); return {}; } };
  await withGateway({ WEBHOOK_SECRET: secret, DRY_RUN: "false", GRIST_BASE_URL: "http://127.0.0.1:1", GRIST_DOC_ID: "doc", GRIST_TABLE_ID: "Leads", GRIST_API_KEY: "key" }, async (gatewayUrl) => {
    const post = (body: string, headers: Record<string, string> = {}, path = "/api/webhooks/ingest/n8n") =>
      fetch(gatewayUrl + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}`, ...headers }, body });

    assert.equal((await fetch(`${gatewayUrl}/api/webhooks/ingest`, { method: "GET" })).status, 405);
    assert.equal((await post("{}", { Authorization: "Bearer wrong" })).status, 401);
    assert.equal((await post("{}", { Authorization: "" })).status, 401);
    assert.equal((await post("{}", { "Content-Type": "text/plain" })).status, 415);
    assert.equal((await post("{not json")).status, 400);
    assert.equal((await post("[\"only text\"]")).status, 422);
    assert.equal((await post("{}", {}, "/api/webhooks/ingest/%E0%A4%A")).status, 400, "a malformed URL is rejected instead of crashing");
    assert.equal((await post("x".repeat(1024 * 1024 + 10))).status, 413);

    const preview = await post(JSON.stringify({ id: "dry-1", name: "Preview" }), {}, "/api/webhooks/ingest/n8n?dryRun=1");
    const previewBody = await preview.json() as { dryRun: boolean; preview: Array<{ key: string }> };
    assert.equal(previewBody.dryRun, true);
    assert.equal(previewBody.preview[0]!.key, "n8n:dry-1");
    assert.equal(forwarded.length, 0, "a dry run forwards nothing");

    const accepted = await post(JSON.stringify([{ json: { id: "lead-1", name: "Ali", phone: "+923001112233" } }]));
    assert.equal(accepted.status, 200);
    const result = await accepted.json() as { accepted: number; sheet: { added: number }; grist: { status: string } };
    assert.equal(result.sheet.added, 1);
    assert.equal(result.grist.status, "written");
    assert.equal(forwarded[0]![0]!.CanonicalKey, "n8n:lead-1");

    assert.equal((await post(JSON.stringify({ id: "lead-2" }), { Authorization: "", "X-Webhook-Secret": secret })).status, 200);
    const signedBody = JSON.stringify({ id: "lead-3", name: "Signed" });
    const signature = `sha256=${createHmac("sha256", secret).update(signedBody).digest("hex")}`;
    assert.equal((await post(signedBody, { Authorization: "", "X-Signature-256": signature })).status, 200);
    assert.equal((await post(signedBody, { Authorization: "", "X-Signature-256": "sha256=00" })).status, 401);
    assert.equal((await fetch(`${gatewayUrl}/healthz`)).status, 200, "the gateway is still running");

    assert.equal((await fetch(`${gatewayUrl}/api/sheets`)).status, 401, "the sheet API requires a session");
    const { cookie } = await login(gatewayUrl);
    const leads = await (await fetch(`${gatewayUrl}/api/sheets/webhook-leads`, { headers: { Cookie: cookie } })).json() as { doc: { sheets: Array<{ name: string; cells: Record<string, { v: string }> }> } };
    const names = leads.doc.sheets.map((s) => s.name);
    assert.deepEqual(names, ["Leads", "Sync runs", "Sync errors"]);
    assert.ok(Object.values(leads.doc.sheets[0]!.cells).some((cell) => cell.v === "Ali"));
    const runs = Object.keys(leads.doc.sheets[1]!.cells).filter((k) => k.endsWith(":0") && k !== "0:0").length;
    assert.equal(runs, 4, "the 422 call and the three accepted calls are logged");
    const status = await (await fetch(`${gatewayUrl}/api/webhooks/status`, { headers: { Cookie: cookie } })).json() as { enabled: boolean; grist: { enabled: boolean } };
    assert.deepEqual([status.enabled, status.grist.enabled], [true, true]);
  }, gristWriter);
});

test("rate-limits webhook calls per client", async () => {
  const secret = "n8n-shared-secret-with-enough-length";
  await withGateway({ WEBHOOK_SECRET: secret, WEBHOOK_RATE_LIMIT_PER_MINUTE: "3" }, async (gatewayUrl) => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await fetch(`${gatewayUrl}/api/webhooks/ingest/n8n`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify({ id: `r${i}` }) });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });
});

test("verifies and accepts Meta lead webhooks, fetching the lead fields", async () => {
  const appSecret = "meta-app-secret";
  const graphCalls: string[] = [];
  const fakeFetch = (async (url: string | URL) => {
    graphCalls.push(String(url));
    return new Response(JSON.stringify({ id: "L77", created_time: "2026-11-02T10:00:00+0000", field_data: [{ name: "full_name", values: ["Zara"] }, { name: "phone_number", values: ["+923009998877"] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  await withGateway({ META_VERIFY_TOKEN: "verify-token-long-enough", META_APP_SECRET: appSecret, META_ACCESS_TOKEN: "page-token" }, async (gatewayUrl) => {
    const ok = await fetch(`${gatewayUrl}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token-long-enough&hub.challenge=12345`);
    assert.equal(await ok.text(), "12345");
    assert.equal((await fetch(`${gatewayUrl}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status, 403);

    const body = JSON.stringify({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "L77", form_id: "F1" } }] }] });
    const signature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
    assert.equal((await fetch(`${gatewayUrl}/api/webhooks/meta`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=00" }, body })).status, 401);
    const accepted = await fetch(`${gatewayUrl}/api/webhooks/meta`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature }, body });
    assert.equal(accepted.status, 200);
    assert.ok(graphCalls[0]!.includes("/L77?fields="));
    const { cookie } = await login(gatewayUrl);
    const leads = await (await fetch(`${gatewayUrl}/api/sheets/webhook-leads`, { headers: { Cookie: cookie } })).json() as { doc: { sheets: Array<{ cells: Record<string, { v: string }> }> } };
    const values = Object.values(leads.doc.sheets[0]!.cells).map((c) => c.v);
    assert.ok(values.includes("Zara") && values.includes("'+923009998877") && values.includes("meta:L77"));
  }, undefined, fakeFetch);
});

test("locks out repeated failed sign-ins and records them in the audit log", async () => {
  await withGateway({ LOGIN_MAX_ATTEMPTS: "3" }, async (gatewayUrl) => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await login(gatewayUrl, "admin", "wrong-password-123")).status);
    assert.deepEqual(statuses, [401, 401, 401, 429]);
    assert.equal((await login(gatewayUrl)).status, 429, "even the right password waits out the lockout");
    assert.equal((await login(gatewayUrl, "someone-else", "x")).status, 401, "other usernames are limited separately");
  });
});

test("manages users with roles; viewers are read-only and only admins reach admin pages", async () => {
  const upstream = createServer((request, response) => response.end(`upstream:${request.url}`));
  const upstreamUrl = await listen(upstream);
  try {
    await withGateway({ GRIST_ORIGIN: upstreamUrl }, async (gatewayUrl) => {
      const admin = (await login(gatewayUrl)).cookie;
      const put = (name: string, body: unknown, cookie = admin) => fetch(`${gatewayUrl}/api/users/${name}`, { method: "PUT", headers: app(cookie), body: JSON.stringify(body) });
      assert.equal((await put("sara", { role: "editor", password: "short" })).status, 400);
      assert.equal((await put("sara", { role: "editor", password: "sara-password-123" })).status, 201);
      assert.equal((await put("vic", { role: "viewer", password: "vic-password-1234" })).status, 201);
      assert.equal((await put("admin", { role: "viewer" })).status, 400, "the built-in admin cannot be changed");

      const editor = (await login(gatewayUrl, "sara", "sara-password-123")).cookie;
      const viewer = (await login(gatewayUrl, "vic", "vic-password-1234")).cookie;
      assert.ok(editor && viewer);
      assert.deepEqual(await (await fetch(`${gatewayUrl}/api/me`, { headers: { Cookie: viewer } })).json(), { username: "vic", role: "viewer" });

      const doc = { id: "doc-roles", title: "Roles", sheets: [{ id: "s1", name: "Sheet1", rows: 10, cols: 5, cells: {} }] };
      const save = (cookie: string, baseVersion: number) => fetch(`${gatewayUrl}/api/sheets/doc-roles`, { method: "PUT", headers: app(cookie), body: JSON.stringify({ baseVersion, doc }) });
      assert.equal((await save(editor, 0)).status, 200);
      assert.equal((await save(viewer, 1)).status, 403, "viewers cannot save");
      assert.equal((await fetch(`${gatewayUrl}/api/sheets/doc-roles`, { headers: { Cookie: viewer } })).status, 200, "viewers can read");
      const stored = await (await fetch(`${gatewayUrl}/api/sheets/doc-roles`, { headers: { Cookie: viewer } })).json() as { updatedBy: string };
      assert.equal(stored.updatedBy, "sara");

      assert.equal((await fetch(`${gatewayUrl}/control`, { headers: { Cookie: editor } })).status, 403);
      assert.equal((await fetch(`${gatewayUrl}/grist/`, { headers: { Cookie: editor } })).status, 403, "Grist is admin-only");
      assert.equal((await fetch(`${gatewayUrl}/api/users`, { headers: { Cookie: editor } })).status, 403);
      assert.equal(await (await fetch(`${gatewayUrl}/grist/`, { headers: { Cookie: admin } })).text(), "upstream:/");

      // Downgrading a role signs the user out everywhere.
      assert.equal((await put("sara", { role: "viewer" })).status, 200);
      assert.equal((await fetch(`${gatewayUrl}/api/me`, { headers: { Cookie: editor } })).status, 401);
      assert.equal((await fetch(`${gatewayUrl}/api/users/vic`, { method: "DELETE", headers: app(admin) })).status, 200);
      assert.equal((await fetch(`${gatewayUrl}/api/me`, { headers: { Cookie: viewer } })).status, 401, "removed users lose access at once");

      const audit = await (await fetch(`${gatewayUrl}/api/audit`, { headers: { Cookie: admin } })).json() as { events: Array<{ event: string }> };
      const events = audit.events.map((e) => e.event);
      for (const name of ["login", "user_created", "user_updated", "user_removed", "sheet_created"]) assert.ok(events.includes(name), `audit has ${name}`);
    });
  } finally {
    await close(upstream);
  }
});

test("enforces protected ranges on save and lets viewers comment through the comments endpoint", async () => {
  await withGateway({}, async (gatewayUrl) => {
    const admin = (await login(gatewayUrl)).cookie;
    for (const [name, role, password] of [["sara", "editor", "sara-password-123"], ["ali", "editor", "ali-password-1234"], ["vic", "viewer", "vic-password-1234"]]) {
      await fetch(`${gatewayUrl}/api/users/${name}`, { method: "PUT", headers: app(admin), body: JSON.stringify({ role, password }) });
    }
    const sara = (await login(gatewayUrl, "sara", "sara-password-123")).cookie;
    const ali = (await login(gatewayUrl, "ali", "ali-password-1234")).cookie;
    const vic = (await login(gatewayUrl, "vic", "vic-password-1234")).cookie;
    const rule = { id: "p1", r1: 0, c1: 0, r2: 5, c2: 1, owner: "sara", editors: [], description: "Targets" };
    const doc = { id: "doc-prot", title: "Targets", sheets: [{ id: "s1", name: "S", rows: 50, cols: 10, cells: { "1:0": { v: "100" } }, protected: [rule] }] };
    const put = (cookie: string, body: unknown) => fetch(`${gatewayUrl}/api/sheets/doc-prot`, { method: "PUT", headers: app(cookie), body: JSON.stringify(body) });

    assert.equal((await put(ali, { baseVersion: 0, doc })).status, 403, "only the owner may create a rule in their name");
    assert.equal((await put(sara, { baseVersion: 0, doc })).status, 200);
    const edited = JSON.parse(JSON.stringify(doc));
    edited.sheets[0].cells["1:0"] = { v: "999" };
    const refused = await put(ali, { baseVersion: 1, doc: edited });
    assert.equal(refused.status, 403);
    assert.match((await refused.json() as { error: string }).error, /Targets/);
    edited.sheets[0].cells["20:5"] = { v: "outside" };
    edited.sheets[0].cells["1:0"] = { v: "100" };
    assert.equal((await put(ali, { baseVersion: 1, doc: edited })).status, 200, "editing outside the range is fine");

    const comment = (cookie: string, body: unknown) => fetch(`${gatewayUrl}/api/sheets/doc-prot/comments`, { method: "POST", headers: app(cookie), body: JSON.stringify(body) });
    const added = await comment(vic, { action: "add", sheetId: "s1", cell: "1:0", text: "Is 100 right?", author: "admin" });
    assert.equal(added.status, 200, "viewers can comment, even on protected cells");
    const stored = await added.json() as { version: number; doc: { sheets: Array<{ comments: Record<string, Array<{ id: string; author: string }>> }> } };
    const thread = stored.doc.sheets[0]!.comments["1:0"]![0]!;
    assert.equal(thread.author, "vic", "the author comes from the session, not the request");
    assert.equal((await comment(ali, { action: "delete", sheetId: "s1", cell: "1:0", threadId: thread.id })).status, 403);
    assert.equal((await comment(sara, { action: "reply", sheetId: "s1", cell: "1:0", threadId: thread.id, text: "Yes" })).status, 200);

    assert.equal((await comment(sara, { action: "add", sheetId: "s1", cell: "3:0", text: "@vic and @Ali please check" })).status, 200);
    const vicMentions = await (await fetch(`${gatewayUrl}/api/mentions`, { headers: { Cookie: vic } })).json() as { mentions: Array<{ author: string; cell: string; docTitle: string }> };
    assert.deepEqual(vicMentions.mentions.map((m) => [m.author, m.cell, m.docTitle]), [["sara", "3:0", "Targets"]]);
    const aliMentions = await (await fetch(`${gatewayUrl}/api/mentions`, { headers: { Cookie: ali } })).json() as { mentions: unknown[] };
    assert.equal(aliMentions.mentions.length, 1, "mentions match usernames case-insensitively");
    const saraMentions = await (await fetch(`${gatewayUrl}/api/mentions`, { headers: { Cookie: sara } })).json() as { mentions: unknown[] };
    assert.equal(saraMentions.mentions.length, 0);

    const forged = JSON.parse(JSON.stringify(stored.doc));
    forged.sheets[0].comments["1:0"][0].text = "Rewritten";
    const latest = await (await fetch(`${gatewayUrl}/api/sheets/doc-prot/version`, { headers: { Cookie: sara } })).json() as { version: number };
    assert.equal((await put(sara, { baseVersion: latest.version, doc: forged })).status, 403, "saves can't rewrite comments");
  });
});

test("keeps sessions across gateway restarts", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "gateway-restart-"));
  try {
    const first = createAdminGatewayServer(loadAdminGatewayConfig({ ...env, GATEWAY_STATE_DIR: stateDir }));
    const firstUrl = await listen(first);
    const { cookie } = await login(firstUrl);
    await close(first);
    const second = createAdminGatewayServer(loadAdminGatewayConfig({ ...env, GATEWAY_STATE_DIR: stateDir }));
    const secondUrl = await listen(second);
    try {
      assert.equal((await fetch(`${secondUrl}/api/me`, { headers: { Cookie: cookie } })).status, 200);
    } finally {
      await close(second);
    }
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("saves editor documents with optimistic versioning and version history", async () => {
  await withGateway({}, async (gatewayUrl) => {
    const { cookie } = await login(gatewayUrl);
    const doc = { id: "doc-1234", title: "Budget", sheets: [{ id: "s1", name: "Sheet1", rows: 100, cols: 26, cells: { "0:0": { v: "Hello" } } }], active: 0 };
    const put = (body: unknown, headers: Record<string, string> = {}) => fetch(`${gatewayUrl}/api/sheets/doc-1234`, { method: "PUT", headers: app(cookie, headers), body: JSON.stringify(body) });

    assert.equal((await put({ baseVersion: 0, doc }, { "X-Requested-With": "" })).status, 403, "cross-site writes are refused");
    assert.equal((await put({ baseVersion: 0, doc: { ...doc, id: "other-id" } })).status, 400);
    assert.equal((await put({ baseVersion: 0, doc: { ...doc, sheets: [] } })).status, 400);
    assert.equal((await (await put({ baseVersion: 0, doc })).json() as { version: number }).version, 1);
    assert.equal((await (await put({ baseVersion: 1, doc: { ...doc, title: "Budget 2026" } })).json() as { version: number }).version, 2);

    const stale = await put({ baseVersion: 1, doc: { ...doc, title: "Stale" } });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as { doc: { title: string } }).doc.title, "Budget 2026");

    const history = await (await fetch(`${gatewayUrl}/api/sheets/doc-1234/history`, { headers: { Cookie: cookie } })).json() as { versions: Array<{ version: number; updatedBy: string }> };
    assert.equal(history.versions[0]!.version, 1, "the first save is snapshotted; later saves within 5 minutes are not");
    assert.equal(history.versions[0]!.updatedBy, "admin");
    const old = await (await fetch(`${gatewayUrl}/api/sheets/doc-1234/history/1`, { headers: { Cookie: cookie } })).json() as { doc: { title: string } };
    assert.equal(old.doc.title, "Budget");
    assert.equal((await fetch(`${gatewayUrl}/api/sheets/doc-1234/history/99`, { headers: { Cookie: cookie } })).status, 404);

    assert.equal((await fetch(`${gatewayUrl}/api/sheets/..%2Fescape`, { headers: { Cookie: cookie } })).status, 404);
    assert.equal((await fetch(`${gatewayUrl}/api/sheets/doc-1234`, { method: "DELETE", headers: app(cookie) })).status, 200);
    assert.equal((await fetch(`${gatewayUrl}/api/sheets/doc-1234`, { headers: { Cookie: cookie } })).status, 404);
  });
});

test("serves the signed-in pages and assets, and signs out", async () => {
  const upstream = createServer((request, response) => response.end(`upstream:${request.url}`));
  const upstreamUrl = await listen(upstream);
  try {
    await withGateway({ GRIST_ORIGIN: upstreamUrl }, async (gatewayUrl) => {
      assert.deepEqual(await (await fetch(`${gatewayUrl}/healthz`)).json(), { status: "ok", service: "punchdeck-admin-gateway" });
      const loginHtml = await (await fetch(`${gatewayUrl}/login`)).text();
      assert.match(loginHtml, /Welcome back/);
      assert.match(loginHtml, /autocomplete="current-password"/);
      assert.equal((await fetch(`${gatewayUrl}/assets/aureum-logo.png`)).headers.get("content-type"), "image/png");
      assert.equal((await fetch(`${gatewayUrl}/`, { redirect: "manual" })).status, 303);
      assert.equal((await fetch(`${gatewayUrl}/assets/sheet/home.js`, { redirect: "manual" })).status, 303, "assets need a session");

      const { cookie } = await login(gatewayUrl);
      assert.ok(cookie);
      const home = await (await fetch(`${gatewayUrl}/`, { headers: { Cookie: cookie } })).text();
      assert.match(home, /Aureum Data Sheet/);
      assert.match(home, /src="\/assets\/sheet\/home\.js"/);
      assert.match(home, /href="\/editor\?new=todo"/);
      const editorHtml = await (await fetch(`${gatewayUrl}/editor`, { headers: { Cookie: cookie } })).text();
      assert.match(editorHtml, /src="\/assets\/sheet\/sheet\.js"/);
      for (const asset of ["sheet.css", "sheet.js", "home.css", "home.js", "control.css", "control.js"]) {
        assert.equal((await fetch(`${gatewayUrl}/assets/sheet/${asset}`, { headers: { Cookie: cookie } })).status, 200, asset);
      }
      assert.match(await (await fetch(`${gatewayUrl}/control`, { headers: { Cookie: cookie } })).text(), /Admin dashboard/);
      assert.equal(await (await fetch(`${gatewayUrl}/admin`, { headers: { Cookie: cookie } })).text(), "upstream:/admin");

      const logout = await fetch(`${gatewayUrl}/logout`, { redirect: "manual", headers: { Cookie: cookie } });
      assert.equal(logout.headers.get("location"), "/login");
      assert.equal((await fetch(`${gatewayUrl}/editor`, { redirect: "manual", headers: { Cookie: cookie } })).status, 303);
    });
  } finally {
    await close(upstream);
  }
});
