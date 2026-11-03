import { randomBytes } from "node:crypto";
import type { SheetDocument, SheetTab } from "./sheet-store.js";

// Server-side rules for shared spreadsheets: protected ranges and comment authorship.

export class SheetPermissionError extends Error {}
export class CommentInputError extends Error {}

export interface Actor {
  username: string;
  role: "admin" | "editor" | "viewer";
}

export interface ProtectedRange {
  id: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  owner: string;
  // Usernames (besides admins and the owner) who may edit the range.
  editors: string[];
  description?: string;
}

export interface CommentReply {
  id: string;
  author: string;
  at: string;
  text: string;
}

export interface CommentThread extends CommentReply {
  resolved?: boolean;
  replies: CommentReply[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const lower = (s: string) => s.toLowerCase();

function protections(sheet: SheetTab): ProtectedRange[] {
  return Array.isArray(sheet.protected) ? (sheet.protected as ProtectedRange[]).filter((p) => p && typeof p.id === "string") : [];
}

export function canEditRange(rule: ProtectedRange, actor: Actor): boolean {
  if (actor.role === "admin") return true;
  const me = lower(actor.username);
  return lower(rule.owner ?? "") === me || (Array.isArray(rule.editors) && rule.editors.some((u) => lower(String(u)) === me));
}

// Cell content inside the rectangle, keyed by offset from its top-left corner (comments excluded).
function contents(sheet: SheetTab, rule: ProtectedRange): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const i = key.indexOf(":");
    const r = Number(key.slice(0, i)), c = Number(key.slice(i + 1));
    if (r < rule.r1 || r > rule.r2 || c < rule.c1 || c > rule.c2) continue;
    if (cell.v === "" && !cell.s && !cell.note) continue;
    out.set(`${r - rule.r1}:${c - rule.c1}`, JSON.stringify({ v: cell.v, s: cell.s ?? null, note: cell.note ?? null }));
  }
  return out;
}

// Rejects a save that changes a protected range the actor may not edit, or tampers with the rules.
export function checkProtectedRanges(before: SheetDocument | null, after: SheetDocument, actor: Actor): void {
  const afterSheets = new Map(after.sheets.map((s) => [s.id, s]));
  if (before) {
    for (const oldSheet of before.sheets) {
      const rules = protections(oldSheet).filter((rule) => !canEditRange(rule, actor));
      if (!rules.length) continue;
      const newSheet = afterSheets.get(oldSheet.id);
      if (!newSheet) throw new SheetPermissionError(`The sheet "${oldSheet.name}" has protected ranges you can't edit, so it can't be deleted.`);
      const newRules = new Map(protections(newSheet).map((r) => [r.id, r]));
      for (const rule of rules) {
        const moved = newRules.get(rule.id);
        const label = rule.description ? `"${rule.description}"` : "a protected range";
        if (!moved) throw new SheetPermissionError(`Only the owner or an admin can remove ${label}.`);
        if (!same(moved.editors, rule.editors) || moved.owner !== rule.owner || (moved.description ?? "") !== (rule.description ?? "")) {
          throw new SheetPermissionError(`Only the owner or an admin can change who may edit ${label}.`);
        }
        if (moved.r2 - moved.r1 !== rule.r2 - rule.r1 || moved.c2 - moved.c1 !== rule.c2 - rule.c1 || !same([...contents(oldSheet, rule)].sort(), [...contents(newSheet, moved)].sort())) {
          throw new SheetPermissionError(`You can't edit ${label}; ask ${rule.owner} or an admin.`);
        }
      }
    }
  }
  // New rules must belong to the person adding them.
  const known = new Set(before ? before.sheets.flatMap((s) => protections(s).map((r) => r.id)) : []);
  for (const sheet of after.sheets) {
    for (const rule of protections(sheet)) {
      if (known.has(rule.id)) continue;
      if (lower(rule.owner ?? "") !== lower(actor.username)) throw new SheetPermissionError("A new protected range must be owned by the person creating it.");
      if (!Array.isArray(rule.editors)) throw new SheetPermissionError("A protected range needs an editors list.");
    }
  }
}

function threadsOf(doc: SheetDocument | null): Map<string, { author: string; text: string; at: string }> {
  const out = new Map<string, { author: string; text: string; at: string }>();
  if (!doc) return out;
  for (const sheet of doc.sheets) {
    const comments = sheet.comments as Record<string, CommentThread[]> | undefined;
    if (!comments || typeof comments !== "object") continue;
    for (const list of Object.values(comments)) {
      if (!Array.isArray(list)) continue;
      for (const t of list) {
        out.set(t.id, { author: t.author, text: t.text, at: t.at });
        for (const reply of t.replies ?? []) out.set(reply.id, { author: reply.author, text: reply.text, at: reply.at });
      }
    }
  }
  return out;
}

// Comments are created and edited only through the comments endpoint (which stamps the author);
// a normal save may move, resolve, or drop them (e.g. by deleting a row) but not invent or rewrite them.
export function checkComments(before: SheetDocument | null, after: SheetDocument): void {
  const old = threadsOf(before);
  for (const [id, comment] of threadsOf(after)) {
    const previous = old.get(id);
    if (!previous) throw new SheetPermissionError("Comments must be added through the comments endpoint.");
    if (previous.author !== comment.author || previous.text !== comment.text || previous.at !== comment.at) throw new SheetPermissionError("Comments can't be edited by saving the sheet.");
  }
}

export interface CommentAction {
  action: "add" | "reply" | "resolve" | "reopen" | "delete";
  sheetId: string;
  cell: string;
  text?: string;
  threadId?: string;
  replyId?: string;
}

const MAX_COMMENT_LENGTH = 4000;

function newId(): string {
  return randomBytes(9).toString("base64url");
}

export function parseCommentAction(body: unknown): CommentAction {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CommentInputError("Body must be a JSON object");
  const b = body as Record<string, unknown>;
  const action = b.action;
  if (action !== "add" && action !== "reply" && action !== "resolve" && action !== "reopen" && action !== "delete") throw new CommentInputError("action must be add, reply, resolve, reopen, or delete");
  if (typeof b.sheetId !== "string" || typeof b.cell !== "string" || !/^\d{1,7}:\d{1,5}$/.test(b.cell)) throw new CommentInputError("sheetId and cell (\"row:col\") are required");
  const out: CommentAction = { action, sheetId: b.sheetId, cell: b.cell };
  if (typeof b.text === "string") out.text = b.text;
  if (typeof b.threadId === "string") out.threadId = b.threadId;
  if (typeof b.replyId === "string") out.replyId = b.replyId;
  if ((action === "add" || action === "reply") && (!out.text || !out.text.trim())) throw new CommentInputError("Comment text is required");
  if (out.text && out.text.length > MAX_COMMENT_LENGTH) throw new CommentInputError(`Comments are limited to ${MAX_COMMENT_LENGTH} characters`);
  if (action !== "add" && !out.threadId) throw new CommentInputError("threadId is required");
  return out;
}

// Applies a comment action to the document, stamping the author and time on the server.
export function applyCommentAction(doc: SheetDocument, action: CommentAction, actor: Actor, now = new Date()): void {
  const sheet = doc.sheets.find((s) => s.id === action.sheetId);
  if (!sheet) throw new CommentInputError("Sheet not found");
  const comments = (sheet.comments && typeof sheet.comments === "object" ? sheet.comments : (sheet.comments = {})) as Record<string, CommentThread[]>;
  const at = now.toISOString();
  if (action.action === "add") {
    (comments[action.cell] ??= []).push({ id: newId(), author: actor.username, at, text: action.text!.trim(), replies: [] });
    return;
  }
  const list = comments[action.cell] ?? [];
  const thread = list.find((t) => t.id === action.threadId);
  if (!thread) throw new CommentInputError("Comment not found");
  const mine = (author: string) => lower(author) === lower(actor.username) || actor.role === "admin";
  switch (action.action) {
    case "reply":
      thread.replies.push({ id: newId(), author: actor.username, at, text: action.text!.trim() });
      return;
    case "resolve":
    case "reopen":
      if (actor.role === "viewer" && !mine(thread.author)) throw new SheetPermissionError("Only editors or the comment's author can resolve it");
      thread.resolved = action.action === "resolve";
      return;
    case "delete": {
      if (action.replyId) {
        const reply = thread.replies.find((r) => r.id === action.replyId);
        if (!reply) throw new CommentInputError("Reply not found");
        if (!mine(reply.author)) throw new SheetPermissionError("Only the author or an admin can delete a reply");
        thread.replies = thread.replies.filter((r) => r.id !== action.replyId);
        return;
      }
      if (!mine(thread.author)) throw new SheetPermissionError("Only the author or an admin can delete a comment");
      comments[action.cell] = list.filter((t) => t.id !== thread.id);
      if (!comments[action.cell]!.length) delete comments[action.cell];
    }
  }
}
