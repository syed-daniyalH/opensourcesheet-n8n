import assert from "node:assert/strict";
import test from "node:test";
import { applyCommentAction, checkComments, checkProtectedRanges, parseCommentAction, SheetPermissionError, type ProtectedRange } from "../src/sheet-rules.js";
import type { SheetDocument } from "../src/sheet-store.js";

const sara = { username: "sara", role: "editor" as const };
const ali = { username: "ali", role: "editor" as const };
const admin = { username: "admin", role: "admin" as const };
const vic = { username: "vic", role: "viewer" as const };

function docWith(cells: Record<string, { v: string }>, rules: ProtectedRange[] = [], comments?: unknown): SheetDocument {
  const sheet: Record<string, unknown> = { id: "s1", name: "Targets", rows: 50, cols: 10, cells, protected: rules };
  if (comments) sheet.comments = comments;
  return { id: "doc", title: "T", sheets: [sheet as never] };
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const rule: ProtectedRange = { id: "p1", r1: 0, c1: 0, r2: 2, c2: 1, owner: "sara", editors: [], description: "Targets" };

test("protected ranges: owners and admins may edit, others may not", () => {
  const before = docWith({ "0:0": { v: "Target" }, "1:0": { v: "100" }, "5:5": { v: "free" } }, [rule]);
  const edited = clone(before);
  edited.sheets[0]!.cells["1:0"] = { v: "999" };
  assert.throws(() => checkProtectedRanges(before, edited, ali), (e) => e instanceof SheetPermissionError && /ask sara/.test(e.message));
  assert.doesNotThrow(() => checkProtectedRanges(before, edited, sara));
  assert.doesNotThrow(() => checkProtectedRanges(before, edited, admin));

  const outside = clone(before);
  outside.sheets[0]!.cells["5:5"] = { v: "changed" };
  assert.doesNotThrow(() => checkProtectedRanges(before, outside, ali), "cells outside the range stay editable");

  const shared = clone(before);
  (shared.sheets[0]!.protected as ProtectedRange[])[0]!.editors = ["ali"];
  assert.throws(() => checkProtectedRanges(before, shared, ali), /change who may edit/);
  const allowed = docWith(before.sheets[0]!.cells, [{ ...rule, editors: ["Ali"] }]);
  const allowedEdit = clone(allowed);
  allowedEdit.sheets[0]!.cells["1:0"] = { v: "5" };
  assert.doesNotThrow(() => checkProtectedRanges(allowed, allowedEdit, ali), "listed editors may edit (case-insensitive)");
});

test("protected ranges: moving with inserted rows is allowed, removing or deleting the sheet is not", () => {
  const before = docWith({ "0:0": { v: "Target" }, "1:0": { v: "100" } }, [rule]);
  const shifted = docWith({ "3:0": { v: "Target" }, "4:0": { v: "100" } }, [{ ...rule, r1: 3, r2: 5 }]);
  assert.doesNotThrow(() => checkProtectedRanges(before, shifted, ali));
  const removed = docWith(before.sheets[0]!.cells, []);
  assert.throws(() => checkProtectedRanges(before, removed, ali), /Only the owner or an admin can remove/);
  const noSheet: SheetDocument = { id: "doc", title: "T", sheets: [{ id: "other", name: "Other", rows: 1, cols: 1, cells: {} }] };
  assert.throws(() => checkProtectedRanges(before, noSheet, ali), /can't be deleted/);
  const forged = docWith({}, [{ ...rule, id: "new", owner: "sara" }]);
  assert.throws(() => checkProtectedRanges(docWith({}), forged, ali), /owned by the person creating it/);
  assert.doesNotThrow(() => checkProtectedRanges(docWith({}), forged, sara));
});

test("comments: the server stamps authors and only authors or admins delete", () => {
  const doc = docWith({});
  applyCommentAction(doc, parseCommentAction({ action: "add", sheetId: "s1", cell: "2:3", text: "  Call back Monday " }), vic, new Date("2026-11-03T09:00:00Z"));
  const thread = (doc.sheets[0]!.comments as Record<string, Array<{ id: string; author: string; text: string; at: string; replies: unknown[] }>>)["2:3"]![0]!;
  assert.deepEqual([thread.author, thread.text, thread.at], ["vic", "Call back Monday", "2026-11-03T09:00:00.000Z"]);
  applyCommentAction(doc, parseCommentAction({ action: "reply", sheetId: "s1", cell: "2:3", threadId: thread.id, text: "Done" }), sara);
  assert.equal(thread.replies.length, 1);
  assert.throws(() => applyCommentAction(doc, parseCommentAction({ action: "delete", sheetId: "s1", cell: "2:3", threadId: thread.id }), ali), /Only the author or an admin/);
  assert.throws(() => applyCommentAction(doc, parseCommentAction({ action: "resolve", sheetId: "s1", cell: "2:3", threadId: "missing" }), sara), /not found/);
  applyCommentAction(doc, parseCommentAction({ action: "resolve", sheetId: "s1", cell: "2:3", threadId: thread.id }), sara);
  assert.equal((thread as { resolved?: boolean }).resolved, true);
  applyCommentAction(doc, parseCommentAction({ action: "delete", sheetId: "s1", cell: "2:3", threadId: thread.id }), admin);
  assert.equal(doc.sheets[0]!.comments && (doc.sheets[0]!.comments as Record<string, unknown>)["2:3"], undefined);
  assert.throws(() => parseCommentAction({ action: "add", sheetId: "s1", cell: "2:3", text: "   " }), /text is required/);
  assert.throws(() => parseCommentAction({ action: "edit", sheetId: "s1", cell: "2:3" }), /action must be/);
});

test("comments: a normal save may move or drop comments but not forge or rewrite them", () => {
  const thread = { id: "t1", author: "vic", at: "2026-11-03T09:00:00.000Z", text: "Original", replies: [] };
  const before = docWith({}, [], { "2:3": [thread] });
  const moved = docWith({}, [], { "4:3": [thread] });
  assert.doesNotThrow(() => checkComments(before, moved));
  assert.doesNotThrow(() => checkComments(before, docWith({}, [], {})));
  assert.throws(() => checkComments(before, docWith({}, [], { "2:3": [{ ...thread, text: "Rewritten" }] })), /can't be edited/);
  assert.throws(() => checkComments(before, docWith({}, [], { "2:3": [thread, { ...thread, id: "t2", author: "admin" }] })), /comments endpoint/);
});
