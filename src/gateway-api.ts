import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditLog } from "./audit.js";
import { isRole, type RateLimiter, type Role, type SessionStore, type UserAccount, UserInputError, type UserStore } from "./auth.js";
import { enrichMetaLeads, metaChallenge, verifyHmacSignature } from "./meta.js";
import { applyCommentAction, checkComments, checkProtectedRanges, CommentInputError, parseCommentAction, SheetPermissionError } from "./sheet-rules.js";
import { DocumentValidationError, isValidDocumentId, type SheetStore, validateSheetDocument, VersionConflictError } from "./sheet-store.js";
import type { JsonValue } from "./types.js";
import { extractItems, ingestWebhook, WEBHOOK_DOCUMENT_ID, type WebhookGristTarget } from "./webhook.js";

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const MAX_SHEET_BODY_BYTES = 10 * 1024 * 1024;
const MAX_SMALL_BODY_BYTES = 16 * 1024;

export interface MetaConfig {
  verifyToken: string;
  appSecret: string;
  accessToken: string | null;
}

export interface ApiContext {
  store: SheetStore;
  users: UserStore;
  sessions: SessionStore;
  audit: AuditLog;
  grist: WebhookGristTarget | null;
  webhookSecret: string | null;
  meta: MetaConfig | null;
  webhookLimiter: RateLimiter;
  fetchImpl: typeof fetch;
  clientIp: (request: IncomingMessage) => string;
}

export class BodyTooLargeError extends Error {}

export async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new BodyTooLargeError("Request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new SyntaxError("Request body is not valid JSON");
  }
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function methodNotAllowed(response: ServerResponse, allow: string): void {
  response.setHeader("Allow", allow);
  sendJson(response, 405, { error: "Method not allowed" });
}

export function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isJsonRequest(request: IncomingMessage): boolean {
  return (request.headers["content-type"] ?? "").toLowerCase().includes("application/json");
}

// State-changing calls must come from the app's own scripts (custom header + JSON), never a cross-site form.
function fromAppScript(request: IncomingMessage): boolean {
  return request.headers["x-requested-with"] === "aureum-sheet";
}

function secretMatches(supplied: string, expected: string): boolean {
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function bearerCredential(request: IncomingMessage): string {
  const header = request.headers["x-webhook-secret"];
  if (typeof header === "string" && header) return header;
  const authorization = request.headers.authorization ?? "";
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}

function canEdit(user: UserAccount): boolean {
  return user.role === "admin" || user.role === "editor";
}

function forbidden(response: ServerResponse, message = "Your role does not allow this"): void {
  sendJson(response, 403, { error: message });
}

function rateLimited(response: ServerResponse, retryAfterSeconds: number): void {
  response.setHeader("Retry-After", String(retryAfterSeconds));
  sendJson(response, 429, { error: "Too many requests", retryAfterSeconds });
}

function handleError(response: ServerResponse, error: unknown): void {
  if (error instanceof BodyTooLargeError) sendJson(response, 413, { error: error.message });
  else if (error instanceof SyntaxError || error instanceof DocumentValidationError || error instanceof UserInputError || error instanceof CommentInputError) sendJson(response, 400, { error: error.message });
  else if (error instanceof SheetPermissionError) sendJson(response, 403, { error: error.message });
  else throw error;
}

// ---------------------------------------------------------------- webhooks (secret-authenticated)

// POST /api/webhooks/ingest[/<source>][?dryRun=1] — n8n or any HTTP client.
// Auth: "Authorization: Bearer <secret>", "X-Webhook-Secret: <secret>", or "X-Signature-256: sha256=<HMAC of body>".
export async function handleWebhook(request: IncomingMessage, response: ServerResponse, url: URL, ctx: ApiContext): Promise<void> {
  if (!ctx.webhookSecret) {
    sendJson(response, 503, { error: "Webhook ingestion is disabled. Set WEBHOOK_SECRET on the gateway." });
    return;
  }
  if (request.method !== "POST") return methodNotAllowed(response, "POST");
  const ip = ctx.clientIp(request);
  const limit = ctx.webhookLimiter.consume(ip);
  if (!limit.allowed) return rateLimited(response, limit.retryAfterSeconds);
  const bearer = bearerCredential(request);
  const signature = request.headers["x-signature-256"];
  if (bearer && !secretMatches(bearer, ctx.webhookSecret)) {
    void ctx.audit.record("webhook_rejected", { ip, reason: "bad secret" });
    sendJson(response, 401, { error: "Missing or invalid webhook secret" });
    return;
  }
  if (!bearer && typeof signature !== "string") {
    sendJson(response, 401, { error: "Missing or invalid webhook secret" });
    return;
  }
  if (!isJsonRequest(request)) {
    sendJson(response, 415, { error: "Content-Type must be application/json" });
    return;
  }
  const source = safeDecode(url.pathname.slice("/api/webhooks/ingest".length).replace(/^\//, ""));
  if (source === null) {
    sendJson(response, 400, { error: "Invalid source name in the webhook URL" });
    return;
  }
  let text: string;
  try {
    text = await readBody(request, MAX_WEBHOOK_BODY_BYTES);
  } catch (error) {
    return handleError(response, error);
  }
  if (!bearer && !verifyHmacSignature(text, signature as string, ctx.webhookSecret)) {
    void ctx.audit.record("webhook_rejected", { ip, reason: "bad signature" });
    sendJson(response, 401, { error: "Invalid X-Signature-256" });
    return;
  }
  let body: JsonValue;
  try {
    body = parseJson(text);
  } catch (error) {
    return handleError(response, error);
  }
  const dryRun = ["1", "true", "yes"].includes((url.searchParams.get("dryRun") ?? "").toLowerCase());
  await runIngest(response, body, source || null, dryRun, ip, ctx);
}

async function runIngest(response: ServerResponse, body: JsonValue, source: string | null, dryRun: boolean, ip: string, ctx: ApiContext): Promise<void> {
  try {
    const result = await ingestWebhook(body, source, { store: ctx.store, grist: dryRun ? null : ctx.grist, dryRun, user: `webhook:${source ?? "n8n"}` });
    if (!dryRun) {
      void ctx.audit.record("webhook_ingested", { ip, source: source ?? "n8n", received: result.received, accepted: result.accepted, failed: result.failed, added: result.sheet.added, updated: result.sheet.updated, grist: result.grist.status });
    }
    // A 5xx makes n8n retry; writes are idempotent by CanonicalKey, so retries are safe.
    const status = result.grist.status === "failed" ? 502 : result.accepted === 0 ? 422 : 200;
    sendJson(response, status, result);
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

// GET/POST /api/webhooks/meta — Meta Lead Ads calling the gateway directly.
export async function handleMetaWebhook(request: IncomingMessage, response: ServerResponse, url: URL, ctx: ApiContext): Promise<void> {
  if (!ctx.meta) {
    sendJson(response, 503, { error: "Meta webhooks are disabled. Set META_VERIFY_TOKEN and META_APP_SECRET." });
    return;
  }
  if (request.method === "GET") {
    const challenge = metaChallenge(url.searchParams, ctx.meta.verifyToken);
    if (challenge === null) {
      sendJson(response, 403, { error: "Verification failed" });
      return;
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(challenge);
    return;
  }
  if (request.method !== "POST") return methodNotAllowed(response, "GET, POST");
  const ip = ctx.clientIp(request);
  const limit = ctx.webhookLimiter.consume(ip);
  if (!limit.allowed) return rateLimited(response, limit.retryAfterSeconds);
  let text: string;
  try {
    text = await readBody(request, MAX_WEBHOOK_BODY_BYTES);
  } catch (error) {
    return handleError(response, error);
  }
  if (!verifyHmacSignature(text, request.headers["x-hub-signature-256"] as string | undefined, ctx.meta.appSecret)) {
    void ctx.audit.record("webhook_rejected", { ip, source: "meta", reason: "bad signature" });
    sendJson(response, 401, { error: "Invalid X-Hub-Signature-256" });
    return;
  }
  let body: JsonValue;
  try {
    body = parseJson(text);
  } catch (error) {
    return handleError(response, error);
  }
  const items = ctx.meta.accessToken ? await enrichMetaLeads(extractItems(body), ctx.meta.accessToken, ctx.fetchImpl) : extractItems(body);
  await runIngest(response, items, "meta", false, ip, ctx);
}

// GET /api/webhooks/status — what the "Data sources" dialog shows (no secrets).
export function webhookStatus(ctx: ApiContext): Record<string, unknown> {
  return {
    ingestPath: "/api/webhooks/ingest/<source>",
    enabled: !!ctx.webhookSecret,
    grist: ctx.grist ? { enabled: true, table: ctx.grist.tableId } : { enabled: false },
    meta: ctx.meta ? { enabled: true, path: "/api/webhooks/meta", fetchesLeadFields: !!ctx.meta.accessToken } : { enabled: false },
    documentId: WEBHOOK_DOCUMENT_ID,
  };
}

// ---------------------------------------------------------------- signed-in APIs

// /api/sheets, /api/sheets/<id>, /api/sheets/<id>/version, /api/sheets/<id>/history[/<version>]
export async function handleSheetsApi(request: IncomingMessage, response: ServerResponse, url: URL, user: UserAccount, ctx: ApiContext): Promise<void> {
  const parts = url.pathname.split("/").filter(Boolean).slice(2);
  try {
    if (parts.length === 0) {
      if (request.method !== "GET") return methodNotAllowed(response, "GET");
      sendJson(response, 200, { documents: await ctx.store.list() });
      return;
    }
    const id = safeDecode(parts[0]!) ?? "";
    const sub = parts[1];
    if (!isValidDocumentId(id) || parts.length > 3 || (sub !== undefined && sub !== "version" && sub !== "history" && sub !== "comments") || (parts.length === 3 && sub !== "history")) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (sub === "comments") {
      // Viewers may comment too; the author and time are set here, never by the client.
      if (request.method !== "POST") return methodNotAllowed(response, "POST");
      if (!fromAppScript(request)) return forbidden(response, "Missing X-Requested-With header");
      if (!isJsonRequest(request)) {
        sendJson(response, 415, { error: "Content-Type must be application/json" });
        return;
      }
      const action = parseCommentAction(parseJson(await readBody(request, MAX_SMALL_BODY_BYTES)));
      if (!(await ctx.store.get(id))) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const stored = await ctx.store.update(id, () => { throw new CommentInputError("Not found"); }, (doc) => applyCommentAction(doc, action, user), user.username);
      sendJson(response, 200, stored);
      return;
    }
    if (sub === "version" || sub === "history") {
      if (request.method !== "GET") return methodNotAllowed(response, "GET");
      if (sub === "version") {
        const stored = await ctx.store.get(id);
        sendJson(response, stored ? 200 : 404, stored ? { version: stored.version, updatedAt: stored.updatedAt, updatedBy: stored.updatedBy ?? null } : { error: "Not found" });
      } else if (parts.length === 2) sendJson(response, 200, { versions: await ctx.store.history(id) });
      else {
        const snapshot = await ctx.store.historyVersion(id, Number(parts[2]));
        sendJson(response, snapshot ? 200 : 404, snapshot ?? { error: "Not found" });
      }
      return;
    }
    if (request.method === "GET") {
      const stored = await ctx.store.get(id);
      sendJson(response, stored ? 200 : 404, stored ?? { error: "Not found" });
      return;
    }
    if (request.method !== "PUT" && request.method !== "DELETE") return methodNotAllowed(response, "GET, PUT, DELETE");
    if (!fromAppScript(request)) return forbidden(response, "Missing X-Requested-With header");
    if (!canEdit(user)) return forbidden(response, "View-only users cannot change spreadsheets");
    if (request.method === "DELETE") {
      const deleted = await ctx.store.delete(id);
      if (deleted) void ctx.audit.record("sheet_deleted", { user: user.username, ip: ctx.clientIp(request), doc: id });
      sendJson(response, deleted ? 200 : 404, { deleted: id });
      return;
    }
    if (!isJsonRequest(request)) {
      sendJson(response, 415, { error: "Content-Type must be application/json" });
      return;
    }
    const body = parseJson(await readBody(request, MAX_SHEET_BODY_BYTES));
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.baseVersion !== "number") {
      sendJson(response, 400, { error: "Body must be { baseVersion, doc }" });
      return;
    }
    const doc = validateSheetDocument(body.doc, id);
    try {
      const stored = await ctx.store.put(id, doc, body.baseVersion, user.username, (current) => {
        checkProtectedRanges(current, doc, user);
        checkComments(current, doc);
      });
      if (body.baseVersion === 0) void ctx.audit.record("sheet_created", { user: user.username, doc: id, title: doc.title });
      if (typeof body.restoredFrom === "number") void ctx.audit.record("sheet_restored", { user: user.username, doc: id, fromVersion: body.restoredFrom });
      sendJson(response, 200, { version: stored.version, updatedAt: stored.updatedAt });
    } catch (error) {
      if (error instanceof VersionConflictError) sendJson(response, 409, error.current);
      else throw error;
    }
  } catch (error) {
    handleError(response, error);
  }
}

// /api/users and /api/users/<name> — admin only.
export async function handleUsersApi(request: IncomingMessage, response: ServerResponse, url: URL, user: UserAccount, ctx: ApiContext): Promise<void> {
  if (user.role !== "admin") return forbidden(response);
  const parts = url.pathname.split("/").filter(Boolean).slice(2);
  try {
    if (parts.length === 0) {
      if (request.method !== "GET") return methodNotAllowed(response, "GET");
      sendJson(response, 200, { users: await ctx.users.list() });
      return;
    }
    const name = safeDecode(parts[0]!) ?? "";
    if (parts.length > 1 || !name) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (request.method !== "PUT" && request.method !== "DELETE") return methodNotAllowed(response, "PUT, DELETE");
    if (!fromAppScript(request)) return forbidden(response, "Missing X-Requested-With header");
    if (request.method === "DELETE") {
      if (name.toLowerCase() === user.username.toLowerCase()) throw new UserInputError("You cannot remove your own account");
      const removed = await ctx.users.remove(name);
      if (removed) {
        await ctx.sessions.deleteForUser(name);
        void ctx.audit.record("user_removed", { user: user.username, target: name });
      }
      sendJson(response, removed ? 200 : 404, { removed: name });
      return;
    }
    const body = parseJson(await readBody(request, MAX_SMALL_BODY_BYTES));
    if (!body || typeof body !== "object" || Array.isArray(body) || !isRole(body.role)) throw new UserInputError("Body must be { role, password? }");
    const password = typeof body.password === "string" && body.password !== "" ? body.password : null;
    const role = body.role as Role;
    if (name.toLowerCase() === user.username.toLowerCase() && role !== "admin") throw new UserInputError("You cannot remove your own admin role");
    const existing = await ctx.users.get(name);
    const account = await ctx.users.upsert(name, password, role);
    // A changed password or a downgraded role signs the user out everywhere.
    if (existing && (password || existing.role !== role)) await ctx.sessions.deleteForUser(name);
    void ctx.audit.record(existing ? "user_updated" : "user_created", { user: user.username, target: account.username, role, passwordChanged: !!password });
    sendJson(response, existing ? 200 : 201, account);
  } catch (error) {
    handleError(response, error);
  }
}

// GET /api/audit?limit=200 — admin only.
export async function handleAuditApi(request: IncomingMessage, response: ServerResponse, url: URL, user: UserAccount, ctx: ApiContext): Promise<void> {
  if (user.role !== "admin") return forbidden(response);
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit")) || 200));
  sendJson(response, 200, { events: await ctx.audit.recent(limit) });
}

export interface Mention {
  docId: string;
  docTitle: string;
  sheetId: string;
  sheetName: string;
  cell: string;
  threadId: string;
  author: string;
  at: string;
  text: string;
  resolved: boolean;
}

// GET /api/mentions — comments and replies across all spreadsheets that @mention the signed-in user.
export async function handleMentionsApi(request: IncomingMessage, response: ServerResponse, user: UserAccount, ctx: ApiContext): Promise<void> {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  const handle = user.username.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^A-Za-z0-9._@+-])@${handle}(?![A-Za-z0-9._@+-])`, "i");
  const mentions: Mention[] = [];
  for (const summary of await ctx.store.list()) {
    const stored = await ctx.store.get(summary.id);
    if (!stored) continue;
    for (const sheet of stored.doc.sheets) {
      const comments = sheet.comments as Record<string, Array<{ id: string; author: string; at: string; text: string; resolved?: boolean; replies?: Array<{ author: string; at: string; text: string }> }>> | undefined;
      if (!comments || typeof comments !== "object") continue;
      for (const [cell, threads] of Object.entries(comments)) {
        if (!Array.isArray(threads)) continue;
        for (const thread of threads) {
          for (const entry of [thread, ...(thread.replies ?? [])]) {
            if (typeof entry.text !== "string" || !pattern.test(entry.text) || entry.author.toLowerCase() === user.username.toLowerCase()) continue;
            mentions.push({ docId: summary.id, docTitle: stored.doc.title, sheetId: sheet.id, sheetName: sheet.name, cell, threadId: thread.id, author: entry.author, at: entry.at, text: entry.text.slice(0, 300), resolved: !!thread.resolved });
          }
        }
      }
    }
  }
  mentions.sort((a, b) => b.at.localeCompare(a.at));
  sendJson(response, 200, { mentions: mentions.slice(0, 100) });
}