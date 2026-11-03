import { createHash, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { join, resolve } from "node:path";
import { connect as tcpConnect } from "node:net";
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { URL } from "node:url";
import { AuditLog } from "./audit.js";
import { RateLimiter, SessionStore, type UserAccount, UserStore } from "./auth.js";
import { type ApiContext, handleAuditApi, handleMentionsApi, handleMetaWebhook, handleSheetsApi, handleUsersApi, handleWebhook, type MetaConfig, readBody, sendJson, webhookStatus } from "./gateway-api.js";
import { GristClient } from "./grist-client.js";
import { htmlEscape, renderControl, renderForbidden, renderHome } from "./pages.js";
import { SheetStore } from "./sheet-store.js";
import type { GristWriter } from "./types.js";
import type { WebhookGristTarget } from "./webhook.js";

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_LOGIN_BODY_BYTES = 16 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const modulePath = fileURLToPath(import.meta.url);
function assetPath(name: string): string {
  const alongsideModule = resolve(modulePath, "..", "assets", name);
  return existsSync(alongsideModule) ? alongsideModule : resolve(modulePath, "..", "..", "src", "assets", name);
}

const aureumLogo = readFileSync(assetPath("aureum-logo.png"));
const aureumMallDesign = readFileSync(assetPath("aureum-mall-design.jpg"));
const loginScript = readFileSync(assetPath("login.js"));
const standaloneEditorHtml = readFileSync(assetPath("sheet/editor.html"), "utf8");
const SHEET_ASSET_TYPES: Record<string, string> = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
// Signed-in-only static files for the editor, home, and admin pages.
const sheetAssets = new Map<string, { body: Buffer; type: string }>(
  ["sheet.css", "sheet.js", "home.css", "home.js", "control.css", "control.js"].map((name) => [
    `/assets/sheet/${name}`,
    { body: readFileSync(assetPath(`sheet/${name}`)), type: SHEET_ASSET_TYPES[name.slice(name.lastIndexOf("."))]! },
  ]),
);

export interface AdminGatewayConfig {
  host: string;
  port: number;
  gristOrigin: string;
  username: string;
  passwordDigest: Buffer;
  passwordSalt: Buffer;
  sessionSecret: string;
  sessionTtlMs: number;
  secureCookie: boolean;
  stateDir: string;
  sheetDataDir: string;
  trustProxy: boolean;
  loginMaxAttempts: number;
  webhookRatePerMinute: number;
  webhookSecret: string | null;
  webhookGrist: WebhookGristConfig | null;
  meta: MetaConfig | null;
}

export interface WebhookGristConfig {
  baseUrl: string;
  docId: string;
  tableId: string;
  apiKey: string;
  batchSize: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

export interface AdminGatewayDependencies {
  gristWriter?: GristWriter;
  fetchImpl?: typeof fetch;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function booleanValue(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  throw new Error(`${name} must be true or false`);
}

function parseOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("GRIST_ORIGIN must be a valid HTTP(S) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("GRIST_ORIGIN must use HTTP or HTTPS");
  }
  return parsed.toString().replace(/\/$/, "");
}

function derivePassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32);
}

export function loadAdminGatewayConfig(env: NodeJS.ProcessEnv = process.env): AdminGatewayConfig {
  const sessionSecret = required(env, "ADMIN_SESSION_SECRET");
  if (sessionSecret.length < 32) throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters");
  const password = required(env, "ADMIN_PASSWORD");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");
  const passwordSalt = createHash("sha256").update(sessionSecret).digest().subarray(0, 16);
  const stateDir = resolve(env.GATEWAY_STATE_DIR?.trim() || "data");

  return {
    host: env.ADMIN_GATEWAY_HOST?.trim() || "127.0.0.1",
    port: positiveInteger(env, "ADMIN_GATEWAY_PORT", 3000),
    gristOrigin: parseOrigin(required(env, "GRIST_ORIGIN")),
    username: env.ADMIN_USERNAME?.trim() || "admin",
    passwordDigest: derivePassword(password, passwordSalt),
    passwordSalt,
    sessionSecret,
    sessionTtlMs: positiveInteger(env, "ADMIN_SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS),
    secureCookie: booleanValue(env, "ADMIN_COOKIE_SECURE", false),
    stateDir,
    sheetDataDir: resolve(env.SHEET_DATA_DIR?.trim() || join(stateDir, "sheets")),
    trustProxy: booleanValue(env, "TRUST_PROXY", false),
    loginMaxAttempts: positiveInteger(env, "LOGIN_MAX_ATTEMPTS", 5),
    webhookRatePerMinute: positiveInteger(env, "WEBHOOK_RATE_LIMIT_PER_MINUTE", 120),
    webhookSecret: loadWebhookSecret(env),
    webhookGrist: loadWebhookGrist(env),
    meta: loadMeta(env),
  };
}

function loadMeta(env: NodeJS.ProcessEnv): MetaConfig | null {
  const verifyToken = env.META_VERIFY_TOKEN?.trim() ?? "";
  const appSecret = env.META_APP_SECRET?.trim() ?? "";
  if (!verifyToken && !appSecret) return null;
  if (!verifyToken || !appSecret) throw new Error("META_VERIFY_TOKEN and META_APP_SECRET must be set together");
  if (verifyToken.length < 16) throw new Error("META_VERIFY_TOKEN must be at least 16 characters");
  return { verifyToken, appSecret, accessToken: env.META_ACCESS_TOKEN?.trim() || null };
}

function loadWebhookSecret(env: NodeJS.ProcessEnv): string | null {
  const secret = env.WEBHOOK_SECRET?.trim();
  if (!secret) return null;
  if (secret.length < 24) throw new Error("WEBHOOK_SECRET must be at least 24 characters");
  return secret;
}

// Webhook records are forwarded to Grist only when the Grist API settings are present and DRY_RUN=false.
function loadWebhookGrist(env: NodeJS.ProcessEnv): WebhookGristConfig | null {
  if (booleanValue(env, "DRY_RUN", true)) return null;
  const names = ["GRIST_BASE_URL", "GRIST_DOC_ID", "GRIST_TABLE_ID", "GRIST_API_KEY"] as const;
  const values = names.map((name) => env[name]?.trim() ?? "");
  if (values.every((value) => !value)) return null;
  const missing = names.filter((_, index) => !values[index]);
  if (missing.length) throw new Error(`DRY_RUN=false requires ${missing.join(", ")}`);
  const [baseUrl, docId, tableId, apiKey] = values as [string, string, string, string];
  let parsed: URL | null = null;
  try {
    parsed = new URL(baseUrl);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) throw new Error("GRIST_BASE_URL must be a valid HTTP(S) URL");
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    docId,
    tableId,
    apiKey,
    batchSize: positiveInteger(env, "BATCH_SIZE", 100),
    maxRetries: positiveInteger(env, "MAX_RETRIES", 3),
    retryBaseDelayMs: positiveInteger(env, "RETRY_BASE_DELAY_MS", 500),
  };
}

// No page uses inline scripts, so the policy blocks injected script even if escaping were ever missed.
const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'";

function securityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  securityHeaders(response);
  response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
}

function sendAsset(response: ServerResponse, asset: Buffer, contentType: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Cache-Control", "public, max-age=300");
  response.end(asset);
}

function redirect(response: ServerResponse, location: string): void {
  response.statusCode = 303;
  response.setHeader("Location", location);
  response.end();
}

function renderLogin(errorMessage?: string): string {
  const error = errorMessage ? `<p class="error" role="alert">${htmlEscape(errorMessage)}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aureum Sales CRM</title>
<style>
:root{color-scheme:dark;font-family:"DM Sans",Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0c141b;color:#fffdf9}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0c141b}.login-page{position:relative;isolation:isolate;min-height:100vh;display:grid;grid-template-columns:minmax(0,1.08fr) minmax(430px,.92fr);overflow:hidden;background:#0c141b}.login-page:before{content:"";position:absolute;z-index:-2;inset:0;background-image:linear-gradient(90deg,rgba(5,8,9,.18) 0%,rgba(5,8,9,.36) 42%,rgba(8,16,22,.88) 74%,#0c141b 100%),url("/assets/aureum-mall-design.jpg");background-position:center;background-size:cover}.login-page:after{content:"";position:absolute;z-index:-1;inset:auto 0 0;height:130px;background:linear-gradient(transparent,rgba(4,7,9,.82))}.hero{display:flex;flex-direction:column;justify-content:space-between;min-height:100vh;padding:42px 48px 42px;color:#fffdf9}.brand-lockup{display:flex;align-items:center;gap:13px}.brand-logo-wrap{width:48px;height:42px;overflow:hidden}.brand-logo{display:block;width:54px;height:auto;transform:translateY(-1px)}.brand-caption{display:grid;gap:3px}.brand-caption strong{font-family:"Playfair Display",Georgia,serif;font-size:18px;line-height:1.1}.brand-caption span{color:#e2c67a;font-size:10px;letter-spacing:.13em;text-transform:uppercase}.location{margin:13px 0 0;color:#e2c67a;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.hero-copy{max-width:570px;margin-top:auto;margin-bottom:32px}.eyebrow{display:inline-flex;margin:0 0 15px;padding:7px 10px;border:1px solid rgba(226,198,122,.45);border-radius:999px;color:#e2c67a;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.hero h2{max-width:570px;margin:0;font-family:"Playfair Display",Georgia,serif;font-size:clamp(42px,5vw,66px);line-height:1.02;letter-spacing:-.045em}.hero-copy p:not(.eyebrow){max-width:490px;margin:20px 0 0;color:#efe4d2;font-size:14px;line-height:1.65}.feature-list{display:flex;gap:10px;margin:0;padding:0;list-style:none}.feature-list li{min-width:132px;padding:14px 12px;border:1px solid rgba(198,161,91,.5);border-radius:11px;background:rgba(13,19,23,.78);box-shadow:0 10px 28px rgba(0,0,0,.16);font-family:"Playfair Display",Georgia,serif;font-size:15px;font-weight:700}.feature-list li span{display:block;margin-top:5px;color:#c9bda9;font-family:"DM Sans",Inter,sans-serif;font-size:9px;font-weight:500;letter-spacing:.04em;text-transform:uppercase}.login-side{display:flex;align-items:center;justify-content:center;padding:42px 52px 42px 24px}.panel{width:min(100%,470px);padding:46px 50px;border:1px solid rgba(198,161,91,.62);border-radius:22px;background:rgba(16,27,34,.94);box-shadow:0 24px 70px rgba(0,0,0,.32);color:#fffdf9}.panel-inner{width:100%}.panel-brand{display:flex;align-items:center;gap:12px;margin-bottom:48px}.panel-brand .brand-logo-wrap{width:47px;height:40px}.panel-brand .brand-logo{width:51px}.panel-brand-copy{display:grid;gap:4px}.panel-brand-copy strong{font-family:"Playfair Display",Georgia,serif;font-size:19px}.panel-brand-copy span{color:#e2c67a;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.panel .eyebrow{padding:0;border:0;border-radius:0;color:#e2c67a}.panel h1{margin:0;font-family:"Playfair Display",Georgia,serif;font-size:32px;line-height:1.1;letter-spacing:-.035em}.panel .intro{margin:12px 0 28px;color:#b6c3cb;font-size:13px;line-height:1.55}.error{margin:0 0 18px;padding:12px 14px;border:1px solid rgba(240,129,127,.42);border-radius:10px;background:rgba(185,74,72,.14);color:#ffd4d2;font-size:13px;line-height:1.45}.field{margin-top:18px}.field-label{display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;color:#efe4d2;font-size:12px;font-weight:800}.field-control{position:relative}.field-control input{width:100%;padding:14px 44px 14px 14px;border:1px solid #485b6d;border-radius:9px;background:#293b50;color:#fff;font:inherit;font-size:14px;transition:border-color .15s,box-shadow .15s}.field-control input::placeholder{color:#aab7c2}.field-control input:focus{outline:0;border-color:#e2c67a;box-shadow:0 0 0 4px rgba(198,161,91,.2)}.password-toggle{position:absolute;right:8px;top:50%;width:34px;height:32px;transform:translateY(-50%);border:0;border-radius:8px;background:transparent;color:#e2c67a;font-size:13px;cursor:pointer}.password-toggle:hover,.password-toggle:focus-visible{background:rgba(226,198,122,.16);color:#fff}.submit{width:100%;margin-top:28px;padding:14px 16px;border:0;border-radius:9px;background:#c6a15b;box-shadow:0 10px 22px rgba(198,161,91,.18);color:#111;font:inherit;font-size:14px;font-weight:800;cursor:pointer;transition:background-color .15s,transform .15s}.submit:hover{background:#e2c67a;transform:translateY(-1px)}.submit:focus-visible{outline:3px solid rgba(226,198,122,.45);outline-offset:3px}.security-note{margin:18px 0 0;color:#f0e6d7;font-size:10px;line-height:1.5}.security-note:before{content:none}
@media(max-width:900px){.login-page{display:block;overflow:auto}.login-page:before{background-image:linear-gradient(rgba(8,16,22,.72),rgba(8,16,22,.96)),url("/assets/aureum-mall-design.jpg");background-position:center top}.hero{min-height:auto;padding:30px 24px 20px}.hero-copy{margin-top:100px;margin-bottom:28px}.hero h2{font-size:44px}.feature-list{flex-wrap:wrap}.login-side{padding:20px 24px 40px}.panel{padding:34px 30px}.panel-brand{margin-bottom:32px}}
@media(max-width:480px){.hero{padding:24px 18px 16px}.hero-copy{margin-top:80px}.hero h2{font-size:38px}.feature-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.feature-list li{min-width:0;padding:10px 8px;font-size:12px}.feature-list li span{font-size:8px}.login-side{padding:16px 14px 30px}.panel{padding:30px 22px;border-radius:18px}}
</style></head>
<body><main class="login-page"><section class="hero" aria-labelledby="hero-title"><header><div class="brand-lockup"><span class="brand-logo-wrap"><img class="brand-logo" src="/assets/aureum-logo.png" alt="Aureum"></span><span class="brand-caption"><strong>Aureum Mall &amp; Residences</strong><span>Sales operations platform</span></span></div><p class="location">✦ Lahore · Pakistan</p></header><div class="hero-copy"><p class="eyebrow">Aureum Sales CRM</p><h2 id="hero-title">Keep every customer relationship moving.</h2><p>Manage leads, customer activity, follow-ups, and team performance from one focused workspace.</p></div><ul class="feature-list"><li>Leads<span>Organize your pipeline</span></li><li>Customers<span>Build stronger relationships</span></li><li>Follow-ups<span>Never miss the next step</span></li></ul></section><section class="login-side"><div class="panel" aria-labelledby="login-title"><div class="panel-inner"><div class="panel-brand"><span class="brand-logo-wrap"><img class="brand-logo" src="/assets/aureum-logo.png" alt="Aureum"></span><span class="panel-brand-copy"><strong>Aureum Sales CRM</strong><span>Sales operations platform</span></span></div><p class="eyebrow">Sign in to continue</p><h1 id="login-title">Welcome back</h1><p class="intro">Use your company credentials to access your assigned workspace.</p>${error}<form method="post" action="/login"><div class="field"><label class="field-label" for="username">Work email or username</label><div class="field-control"><input id="username" name="username" autocomplete="username" placeholder="you@aureum.com" required></div></div><div class="field"><label class="field-label" for="password">Password</label><div class="field-control"><input id="password" name="password" type="password" autocomplete="current-password" required><button id="show-password" class="password-toggle" type="button" aria-controls="password" aria-pressed="false" aria-label="Show password">◉</button></div></div><button class="submit" type="submit">▪ Sign in</button></form><p class="security-note">Access is managed by your organization. Contact your administrator if you need help signing in.</p></div></div></section></main><script src="/assets/login.js"></script></body></html>`;
}

function getCookies(request: IncomingMessage): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key && valueParts.length > 0) result.set(key, valueParts.join("="));
  }
  return result;
}

function cookieHeader(token: string, config: AdminGatewayConfig): string {
  const secure = config.secureCookie ? "; Secure" : "";
  return `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(config.sessionTtlMs / 1000)}${secure}`;
}

function copyResponseHeaders(response: ServerResponse, headers: IncomingHttpHeaders): void {
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && name.toLowerCase() !== "connection") response.setHeader(name, value);
  }
}

function proxyHttp(request: IncomingMessage, response: ServerResponse, config: AdminGatewayConfig, stripPrefix = ""): void {
  const requested = new URL(request.url ?? "/", "http://gateway.local");
  const upstreamPath = stripPrefix && (requested.pathname === stripPrefix || requested.pathname.startsWith(`${stripPrefix}/`))
    ? requested.pathname.slice(stripPrefix.length) || "/"
    : requested.pathname;
  const target = new URL(config.gristOrigin);
  target.pathname = upstreamPath;
  target.search = requested.search;
  const headers: IncomingHttpHeaders = { ...request.headers };
  headers.host = target.host;
  headers["x-forwarded-host"] = request.headers.host ?? "";
  headers["x-forwarded-proto"] = "http";
  headers["x-forwarded-for"] = request.socket.remoteAddress ?? "";

  const requestFunction = target.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = requestFunction({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    method: request.method,
    path: `${target.pathname}${target.search}`,
    headers,
  }, (upstreamResponse) => {
    response.statusCode = upstreamResponse.statusCode ?? 502;
    copyResponseHeaders(response, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", (error: Error) => {
    if (!response.headersSent) {
      response.statusCode = 502;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    response.end(`Grist upstream unavailable: ${error.message}`);
  });
  request.pipe(upstream);
}

function writeUnauthorized(socket: Duplex): void {
  socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
}

function proxyUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, config: AdminGatewayConfig, stripPrefix = ""): void {
  const requested = new URL(request.url ?? "/", "http://gateway.local");
  const upstreamPath = stripPrefix && (requested.pathname === stripPrefix || requested.pathname.startsWith(`${stripPrefix}/`))
    ? requested.pathname.slice(stripPrefix.length) || "/"
    : requested.pathname;
  const target = new URL(config.gristOrigin);
  target.pathname = upstreamPath;
  target.search = requested.search;
  const isTls = target.protocol === "https:";
  const upstream = isTls
    ? tlsConnect({ host: target.hostname, port: Number(target.port || 443), servername: target.hostname })
    : tcpConnect(Number(target.port || 80), target.hostname);

  upstream.once("connect", () => {
    const headers = Object.entries(request.headers)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
    headers.push(`host: ${target.host}`);
    headers.push("x-forwarded-proto: http");
    upstream.write(`${request.method ?? "GET"} ${target.pathname}${target.search} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

function clientIpFor(config: AdminGatewayConfig): (request: IncomingMessage) => string {
  return (request) => {
    if (config.trustProxy) {
      const forwarded = request.headers["x-forwarded-for"];
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
      if (first) return first;
    }
    return request.socket.remoteAddress ?? "unknown";
  };
}

function methodNotAllowed(response: ServerResponse, allow: string): void {
  response.statusCode = 405;
  response.setHeader("Allow", allow);
  response.end();
}

export function createAdminGatewayServer(config: AdminGatewayConfig, dependencies: AdminGatewayDependencies = {}): Server {
  const users = new UserStore(join(config.stateDir, "users.json"), { username: config.username, passwordDigest: config.passwordDigest, passwordSalt: config.passwordSalt });
  const sessions = new SessionStore(join(config.stateDir, "sessions.json"), config.sessionTtlMs);
  const audit = new AuditLog(join(config.stateDir, "audit.log"));
  const clientIp = clientIpFor(config);
  // Failed sign-ins: per IP+username, and a looser cap per IP across usernames.
  const loginByUser = new RateLimiter(config.loginMaxAttempts, LOGIN_WINDOW_MS);
  const loginByIp = new RateLimiter(config.loginMaxAttempts * 4, LOGIN_WINDOW_MS);
  const gristConfig = config.webhookGrist;
  const gristTarget: WebhookGristTarget | null = gristConfig
    ? {
      writer: dependencies.gristWriter ?? new GristClient(gristConfig.baseUrl, gristConfig.docId, gristConfig.apiKey),
      tableId: gristConfig.tableId,
      batchSize: gristConfig.batchSize,
      maxRetries: gristConfig.maxRetries,
      retryBaseDelayMs: gristConfig.retryBaseDelayMs,
    }
    : null;
  const ctx: ApiContext = {
    store: new SheetStore(config.sheetDataDir),
    users,
    sessions,
    audit,
    grist: gristTarget,
    webhookSecret: config.webhookSecret,
    meta: config.meta,
    webhookLimiter: new RateLimiter(config.webhookRatePerMinute, 60_000),
    fetchImpl: dependencies.fetchImpl ?? fetch,
    clientIp,
  };

  async function currentUser(request: IncomingMessage): Promise<UserAccount | null> {
    const session = await sessions.get(getCookies(request).get("admin_session"));
    if (!session) return null;
    // Role changes and removals apply immediately because the account is looked up on every request.
    return users.get(session.username);
  }

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://gateway.local");
    const pathname = url.pathname;

    if (pathname === "/api/webhooks/ingest" || pathname.startsWith("/api/webhooks/ingest/")) {
      await handleWebhook(request, response, url, ctx);
      return;
    }
    if (pathname === "/api/webhooks/meta") {
      await handleMetaWebhook(request, response, url, ctx);
      return;
    }

    if (pathname === "/assets/aureum-logo.png" || pathname === "/assets/aureum-mall-design.jpg") {
      if (request.method !== "GET") return methodNotAllowed(response, "GET");
      sendAsset(response, pathname.endsWith(".png") ? aureumLogo : aureumMallDesign, pathname.endsWith(".png") ? "image/png" : "image/jpeg");
      return;
    }

    if (pathname === "/assets/login.js") {
      if (request.method !== "GET") return methodNotAllowed(response, "GET");
      securityHeaders(response);
      sendAsset(response, loginScript, "text/javascript; charset=utf-8");
      return;
    }

    if (pathname === "/healthz") {
      sendJson(response, 200, { status: "ok", service: "punchdeck-admin-gateway" });
      return;
    }

    if (pathname === "/login") {
      if (request.method === "GET") {
        sendHtml(response, 200, renderLogin());
        return;
      }
      if (request.method !== "POST") return methodNotAllowed(response, "GET, POST");
      const ip = clientIp(request);
      let username = "";
      let password = "";
      try {
        const form = new URLSearchParams(await readBody(request, MAX_LOGIN_BODY_BYTES));
        username = (form.get("username") ?? "").trim();
        password = form.get("password") ?? "";
      } catch (error) {
        sendHtml(response, 400, renderLogin(error instanceof Error ? error.message : "Invalid request."));
        return;
      }
      const userKey = `${ip}|${username.toLowerCase()}`;
      const limited = [loginByUser.check(userKey), loginByIp.check(ip)].find((r) => !r.allowed);
      if (limited) {
        response.setHeader("Retry-After", String(limited.retryAfterSeconds));
        void audit.record("login_locked", { ip, user: username });
        sendHtml(response, 429, renderLogin(`Too many failed sign-in attempts. Try again in ${Math.ceil(limited.retryAfterSeconds / 60)} minute(s).`));
        return;
      }
      const account = await users.verify(username, password);
      if (!account) {
        loginByUser.hit(userKey);
        loginByIp.hit(ip);
        void audit.record("login_failed", { ip, user: username });
        sendHtml(response, 401, renderLogin("Invalid username or password."));
        return;
      }
      loginByUser.reset(userKey);
      const token = await sessions.create(account.username);
      void audit.record("login", { ip, user: account.username, role: account.role });
      response.setHeader("Set-Cookie", cookieHeader(token, config));
      redirect(response, "/");
      return;
    }

    if (pathname === "/logout") {
      const token = getCookies(request).get("admin_session");
      const session = await sessions.get(token);
      await sessions.delete(token);
      if (session) void audit.record("logout", { user: session.username, ip: clientIp(request) });
      response.setHeader("Set-Cookie", `admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.secureCookie ? "; Secure" : ""}`);
      redirect(response, "/login");
      return;
    }

    const user = await currentUser(request);
    if (!user) {
      if (pathname.startsWith("/api/")) sendJson(response, 401, { error: "Sign in required" });
      else redirect(response, "/login");
      return;
    }

    if (pathname === "/api/me") {
      sendJson(response, 200, { username: user.username, role: user.role });
      return;
    }
    if (pathname === "/api/sheets" || pathname.startsWith("/api/sheets/")) {
      await handleSheetsApi(request, response, url, user, ctx);
      return;
    }
    if (pathname === "/api/users" || pathname.startsWith("/api/users/")) {
      await handleUsersApi(request, response, url, user, ctx);
      return;
    }
    if (pathname === "/api/mentions") {
      await handleMentionsApi(request, response, user, ctx);
      return;
    }
    if (pathname === "/api/audit") {
      await handleAuditApi(request, response, url, user, ctx);
      return;
    }
    if (pathname === "/api/webhooks/status") {
      sendJson(response, 200, webhookStatus(ctx));
      return;
    }

    const asset = sheetAssets.get(pathname);
    if (asset) {
      if (request.method !== "GET") return methodNotAllowed(response, "GET");
      response.statusCode = 200;
      securityHeaders(response);
      response.setHeader("Content-Type", asset.type);
      response.setHeader("Cache-Control", "no-store");
      response.end(asset.body);
      return;
    }

    if (pathname === "/") {
      sendHtml(response, 200, renderHome(user));
      return;
    }

    if (pathname === "/editor") {
      if (request.method !== "GET") return methodNotAllowed(response, "GET");
      sendHtml(response, 200, standaloneEditorHtml);
      return;
    }

    // Everything below (admin page and the Grist upstream) is for admins only.
    if (user.role !== "admin") {
      sendHtml(response, 403, renderForbidden(user));
      return;
    }

    if (pathname === "/control") {
      sendHtml(response, 200, renderControl(user, {
        gristOrigin: config.gristOrigin,
        webhookEnabled: !!config.webhookSecret,
        gristForwarding: config.webhookGrist ? `${config.webhookGrist.tableId}` : null,
        metaEnabled: !!config.meta,
        stateDir: config.stateDir,
      }));
      return;
    }

    proxyHttp(request, response, config, "/grist");
  };
  // An error escaping an async handler would be an unhandled rejection, which stops Node.
  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "gateway_request_failed", path: request.url, error: String(error) }));
      if (!response.headersSent) sendJson(response, 500, { error: "Internal error" });
      else response.destroy();
    });
  });

  server.on("upgrade", (request, socket, head) => {
    currentUser(request).then((user) => {
      if (!user || user.role !== "admin") {
        writeUnauthorized(socket);
        return;
      }
      proxyUpgrade(request, socket, head, config, "/grist");
    }).catch(() => socket.destroy());
  });

  server.on("close", () => { void sessions.flush(); });

  return server;
}

export async function startAdminGateway(env: NodeJS.ProcessEnv = process.env): Promise<Server> {
  const config = loadAdminGatewayConfig(env);
  const server = createAdminGatewayServer(config);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(config.port, config.host, () => resolveListen());
  });
  console.log(JSON.stringify({ event: "admin_gateway_started", host: config.host, port: config.port, gristOrigin: config.gristOrigin, stateDir: config.stateDir, webhook: !!config.webhookSecret, meta: !!config.meta }));
  return server;
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entrypoint === fileURLToPath(import.meta.url)) {
  startAdminGateway().catch((error: unknown) => {
    console.error(JSON.stringify({ event: "admin_gateway_fatal", error: String(error) }));
    process.exitCode = 1;
  });
}
