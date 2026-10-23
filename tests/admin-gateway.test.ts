import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createAdminGatewayServer, loadAdminGatewayConfig } from "../src/admin-gateway.js";

const env = {
  ADMIN_GATEWAY_HOST: "127.0.0.1",
  ADMIN_GATEWAY_PORT: "3000",
  GRIST_ORIGIN: "http://127.0.0.1:1",
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "correct-horse-battery",
  ADMIN_SESSION_SECRET: "a-session-secret-that-is-at-least-32-characters-long",
  ADMIN_COOKIE_SECURE: "false",
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

test("loads a secure gateway configuration and rejects weak secrets", () => {
  const config = loadAdminGatewayConfig(env);
  assert.equal(config.username, "admin");
  assert.equal(config.gristOrigin, "http://127.0.0.1:1");
  assert.throws(() => loadAdminGatewayConfig({ ...env, ADMIN_PASSWORD: "short" }), /at least 12/);
  assert.throws(() => loadAdminGatewayConfig({ ...env, ADMIN_SESSION_SECRET: "short" }), /at least 32/);
});

test("requires login, redirects a valid login to Grist, and proxies the workspace", async () => {
  const upstream = createServer((request, response) => {
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/plain");
    response.end(`upstream:${request.url}`);
  });
  const upstreamUrl = await listen(upstream);
  const gateway = createAdminGatewayServer(loadAdminGatewayConfig({ ...env, GRIST_ORIGIN: upstreamUrl }));
  const gatewayUrl = await listen(gateway);

  try {
    const healthResponse = await fetch(`${gatewayUrl}/healthz`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { status: "ok", service: "punchdeck-admin-gateway" });

    const loginPageResponse = await fetch(`${gatewayUrl}/login`);
    assert.equal(loginPageResponse.status, 200);
    const loginHtml = await loginPageResponse.text();
    assert.match(loginHtml, /Welcome back/);
    assert.match(loginHtml, /Punchdeck workspace/);
    assert.match(loginHtml, /id="show-password"/);
    assert.match(loginHtml, /autocomplete="current-password"/);
    assert.match(loginHtml, /Protected admin access/);

    const protectedResponse = await fetch(`${gatewayUrl}/`, { redirect: "manual" });
    assert.equal(protectedResponse.status, 303);
    assert.equal(protectedResponse.headers.get("location"), "/login");

    const invalidResponse = await fetch(`${gatewayUrl}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "username=admin&password=wrong-password",
    });
    assert.equal(invalidResponse.status, 401);

    const loginResponse = await fetch(`${gatewayUrl}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "username=admin&password=correct-horse-battery",
    });
    assert.equal(loginResponse.status, 303);
    assert.equal(loginResponse.headers.get("location"), "/");
    const cookie = loginResponse.headers.get("set-cookie");
    assert.ok(cookie?.includes("HttpOnly"));

    const homeResponse = await fetch(`${gatewayUrl}/`, { headers: { Cookie: cookie?.split(";", 1)[0] ?? "" } });
    assert.equal(homeResponse.status, 200);
    assert.match(await homeResponse.text(), /Punchdeck Sheets/);

    const editorResponse = await fetch(gatewayUrl + "/editor", { headers: { Cookie: cookie?.split(";", 1)[0] ?? "" } });
    assert.equal(editorResponse.status, 200);
    const editorHtml = await editorResponse.text();
    for (const label of ["File", "Edit", "View", "Insert", "Format", "Data", "Tools", "Extensions", "Help"]) {
      assert.match(editorHtml, new RegExp(`>${label}<`));
    }
    assert.match(editorHtml, /Currency format/);
    assert.match(editorHtml, /Grist spreadsheet workspace/);
    for (const label of ["Home", "Insert", "Draw", "Page Layout", "Formulas", "Data", "Review", "View", "Help"]) {
      assert.match(editorHtml, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(editorHtml, /Formula guide/);
    assert.match(editorHtml, /Function reference/);
    assert.match(editorHtml, /CRM pipeline status/);

    const workspaceResponse = await fetch(`${gatewayUrl}/grist/`, { headers: { Cookie: cookie?.split(";", 1)[0] ?? "" } });
    assert.equal(workspaceResponse.status, 200);
    assert.equal(await workspaceResponse.text(), "upstream:/");

    const controlResponse = await fetch(`${gatewayUrl}/control`, { headers: { Cookie: cookie?.split(";", 1)[0] ?? "" } });
    assert.equal(controlResponse.status, 200);
    assert.match(await controlResponse.text(), /Admin dashboard/);

    const adminResponse = await fetch(`${gatewayUrl}/admin`, { headers: { Cookie: cookie?.split(";", 1)[0] ?? "" } });
    assert.equal(adminResponse.status, 200);
    assert.match(await adminResponse.text(), /upstream/);

    const logoutResponse = await fetch(`${gatewayUrl}/logout`, {
      redirect: "manual",
      headers: { Cookie: cookie?.split(";", 1)[0] ?? "" },
    });
    assert.equal(logoutResponse.status, 303);
    assert.equal(logoutResponse.headers.get("location"), "/login");

    const afterLogoutResponse = await fetch(`${gatewayUrl}/editor`, { redirect: "manual", headers: { Cookie: cookie?.split(";", 1)[0] ?? "" } });
    assert.equal(afterLogoutResponse.status, 303);
    assert.equal(afterLogoutResponse.headers.get("location"), "/login");
  } finally {
    await close(gateway);
    await close(upstream);
  }
});
