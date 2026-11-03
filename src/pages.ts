import type { UserAccount } from "./auth.js";

export function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

const SHEET_ICON = `<span class="sheet-icon" aria-hidden="true"><span></span></span>`;

const TEMPLATES: Array<{ id: string; label: string; preview: string }> = [
  { id: "blank", label: "Blank spreadsheet", preview: `<span class="blank-preview"><span class="blank-plus"></span></span>` },
  { id: "todo", label: "To-do list", preview: `<span class="mini-grid green"></span>` },
  { id: "annual-budget", label: "Annual budget", preview: `<span class="mini-budget"></span>` },
  { id: "monthly-budget", label: "Monthly budget", preview: `<span class="mini-budget"></span>` },
  { id: "team-tracker", label: "Team tracker", preview: `<span class="mini-grid blue"></span>` },
];

function userAttributes(user: UserAccount): string {
  return `data-user="${htmlEscape(user.username)}" data-role="${htmlEscape(user.role)}"`;
}

export function renderHome(user: UserAccount): string {
  const canEdit = user.role !== "viewer";
  const templates = TEMPLATES.map((t) => canEdit
    ? `<div class="template" data-search="${htmlEscape(t.label.toLowerCase())}"><a class="template-card" href="/editor?new=${t.id}" aria-label="${htmlEscape(t.label)}">${t.preview}</a><span class="template-label">${htmlEscape(t.label)}</span></div>`
    : "").join("");
  const adminLinks = user.role === "admin" ? `<a href="/control">Admin control</a><a href="/grist/">Grist data store</a>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aureum Data Sheet</title><link rel="stylesheet" href="/assets/sheet/home.css"></head>
<body ${userAttributes(user)}><header class="topbar"><button id="nav-toggle" class="hamburger" aria-label="Open navigation" aria-expanded="false">☰</button><div class="brand">${SHEET_ICON}<span class="brand-label">Aureum Data Sheet</span></div><label class="search"><span aria-hidden="true">⌕</span><span class="sr-only">Search files</span><input id="file-search" placeholder="Search" aria-label="Search files"></label><div class="top-actions"><button id="apps-button" class="icon-button" aria-label="Apps" aria-haspopup="true">⠿</button><button id="avatar-button" class="avatar" aria-label="Account: ${htmlEscape(user.username)}" aria-haspopup="true">${htmlEscape(user.username.slice(0, 1).toUpperCase())}</button></div></header>
<div id="apps-menu" class="popover" hidden><a href="/">Spreadsheets home</a><a href="/editor?id=webhook-leads">Webhook leads</a>${adminLinks}</div>
<div id="account-menu" class="popover" hidden><div class="who"><strong>${htmlEscape(user.username)}</strong><span>${htmlEscape(user.role)}</span></div><a href="/logout">Sign out</a></div>
<aside id="nav-drawer" class="drawer" aria-hidden="true"><h2>Navigate</h2><a href="/">Home</a><a href="/editor?id=webhook-leads">Webhook leads</a>${adminLinks}<p class="drawer-status">Spreadsheets are saved on this server and shared with everyone who signs in.</p></aside>
<main class="main"><div class="content">${canEdit ? `<div class="section-head"><h1>Start a new data sheet</h1><div class="toolbar"><button id="toggle-templates" aria-expanded="true">Hide templates</button></div></div>
<div class="template-row" id="template-row">${templates}</div>` : ""}
<section id="mentions" class="mentions" hidden aria-label="Mentions"><div class="section-head"><h1>Mentions <span id="mention-count" class="badge"></span></h1><button id="mentions-read" class="signout" type="button">Mark all as read</button></div><div id="mention-list" class="files"></div></section>
<div class="section-head"><h1>Recent data sheets</h1><a class="signout" href="/logout">Sign out</a></div><section class="files" aria-label="Recent data sheets"><div class="files-head"><div>Name</div><div>Last edited by</div><div>Last modified</div><div></div></div><div id="recent-list"></div><div id="empty-state" class="empty-state">No data sheets match your search.</div><div id="no-files" class="empty-state">No spreadsheets yet.${canEdit ? " Pick a template above to create one." : ""}</div></section></div></main>
<div id="file-menu" class="popover" hidden></div><div id="toast" class="toast" role="status" aria-live="polite"></div>
<script src="/assets/sheet/home.js"></script></body></html>`;
}

export interface ControlInfo {
  gristOrigin: string;
  webhookEnabled: boolean;
  gristForwarding: string | null;
  metaEnabled: boolean;
  stateDir: string;
}

export function renderControl(user: UserAccount, info: ControlInfo): string {
  const pill = (on: boolean, yes: string, no: string) => `<span class="pill ${on ? "on" : "off"}">${on ? yes : no}</span>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aureum Data Control</title><link rel="stylesheet" href="/assets/sheet/control.css"></head>
<body ${userAttributes(user)}><main class="wrap"><div class="top"><div><div class="eyebrow">Aureum Data Sheet</div><h1>Admin dashboard</h1><p class="muted">Signed in as ${htmlEscape(user.username)} (${htmlEscape(user.role)}).</p></div><div><a class="link" href="/">← Spreadsheets</a> · <a class="link" href="/logout">Sign out</a></div></div>
<div class="grid"><section class="card"><h2>Spreadsheets</h2><p class="muted">Open the shared spreadsheet editor.</p><a class="link" href="/">Open spreadsheets →</a></section>
<section class="card"><h2>Webhook ingestion</h2><p>${pill(info.webhookEnabled, "Enabled", "Disabled: set WEBHOOK_SECRET")}</p><p class="muted">POST /api/webhooks/ingest/&lt;source&gt; · Grist forwarding: ${info.gristForwarding ? htmlEscape(info.gristForwarding) : "off"} · Meta direct: ${info.metaEnabled ? "on" : "off"}</p><a class="link" href="/editor?id=webhook-leads">Open Webhook leads →</a></section>
<section class="card"><h2>Grist data store</h2><p class="muted">Upstream: ${htmlEscape(info.gristOrigin)}</p><a class="link" href="/grist/">Open Grist →</a></section></div>
<section class="section" id="users"><h2>Users</h2><p class="muted">Admins manage users and see this page. Editors can create and change spreadsheets. Viewers can only read. Changing a password or role signs that user out.</p>
<table class="data"><thead><tr><th>User</th><th>Role</th><th>Created</th><th></th></tr></thead><tbody id="user-rows"><tr><td colspan="4" class="muted">Loading…</td></tr></tbody></table>
<form class="inline" id="user-form"><input name="username" placeholder="Username or email" required autocomplete="off"><input name="password" type="password" placeholder="Password (12+ characters)" autocomplete="new-password"><select name="role"><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select><button class="btn" type="submit">Add or update user</button></form><div class="msg" id="user-msg" role="status"></div></section>
<section class="section" id="audit"><h2>Audit log</h2><p class="muted">Sign-ins, failed sign-ins, user changes, sheet creation and deletion, and webhook calls. Stored in ${htmlEscape(info.stateDir)}/audit.log.</p>
<table class="data"><thead><tr><th>Time</th><th>Event</th><th>User</th><th>Details</th></tr></thead><tbody id="audit-rows"><tr><td colspan="4" class="muted">Loading…</td></tr></tbody></table></section>
</main><script src="/assets/sheet/control.js"></script></body></html>`;
}

export function renderForbidden(user: UserAccount): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not allowed</title><link rel="stylesheet" href="/assets/sheet/control.css"></head><body><main class="wrap"><h1>Not allowed</h1><p class="muted">${htmlEscape(user.username)} (${htmlEscape(user.role)}) cannot open this page. Ask an admin for access.</p><a class="link" href="/">← Back to spreadsheets</a></main></body></html>`;
}
