import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { connect as tcpConnect } from "node:net";
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { URL } from "node:url";
import { renderEditorShell } from "./editor-shell.js";

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_LOGIN_BODY_BYTES = 16 * 1024;
const modulePath = fileURLToPath(import.meta.url);
function assetPath(name: string): string {
  const alongsideModule = resolve(modulePath, "..", "assets", name);
  return existsSync(alongsideModule) ? alongsideModule : resolve(modulePath, "..", "..", "src", "assets", name);
}

const aureumLogo = readFileSync(assetPath("aureum-logo.png"));
const aureumMallDesign = readFileSync(assetPath("aureum-mall-design.jpg"));

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
}

interface Session {
  expiresAt: number;
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
  };
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function sendHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
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
<body><main class="login-page"><section class="hero" aria-labelledby="hero-title"><header><div class="brand-lockup"><span class="brand-logo-wrap"><img class="brand-logo" src="/assets/aureum-logo.png" alt="Aureum"></span><span class="brand-caption"><strong>Aureum Mall &amp; Residences</strong><span>Sales operations platform</span></span></div><p class="location">✦ Lahore · Pakistan</p></header><div class="hero-copy"><p class="eyebrow">Aureum Sales CRM</p><h2 id="hero-title">Keep every customer relationship moving.</h2><p>Manage leads, customer activity, follow-ups, and team performance from one focused workspace.</p></div><ul class="feature-list"><li>Leads<span>Organize your pipeline</span></li><li>Customers<span>Build stronger relationships</span></li><li>Follow-ups<span>Never miss the next step</span></li></ul></section><section class="login-side"><div class="panel" aria-labelledby="login-title"><div class="panel-inner"><div class="panel-brand"><span class="brand-logo-wrap"><img class="brand-logo" src="/assets/aureum-logo.png" alt="Aureum"></span><span class="panel-brand-copy"><strong>Aureum Sales CRM</strong><span>Sales operations platform</span></span></div><p class="eyebrow">Sign in to continue</p><h1 id="login-title">Welcome back</h1><p class="intro">Use your company credentials to access your assigned workspace.</p>${error}<form method="post" action="/login"><div class="field"><label class="field-label" for="username">Work email or username</label><div class="field-control"><input id="username" name="username" autocomplete="username" placeholder="you@aureum.com" required></div></div><div class="field"><label class="field-label" for="password">Password</label><div class="field-control"><input id="password" name="password" type="password" autocomplete="current-password" required><button id="show-password" class="password-toggle" type="button" aria-controls="password" aria-pressed="false" aria-label="Show password">◉</button></div></div><button class="submit" type="submit">▪ Sign in</button></form><p class="security-note">Access is managed by your organization. Contact your administrator if you need help signing in.</p></div></div></section></main><script>const password=document.getElementById('password');const showPassword=document.getElementById('show-password');showPassword.addEventListener('click',()=>{const visible=password.type==='text';password.type=visible?'password':'text';showPassword.setAttribute('aria-label',visible?'Show password':'Hide password');showPassword.setAttribute('aria-pressed',String(!visible));});</script></body></html>`;
}

function renderControl(config: AdminGatewayConfig): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Punchdeck Control</title>
<style>:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0b1020;color:#eef2ff}body{margin:0;background:#0b1020}.wrap{width:min(920px,calc(100vw - 40px));margin:0 auto;padding:48px 0}.top{display:flex;justify-content:space-between;gap:20px;align-items:start}.eyebrow{color:#86a7ff;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.muted{color:#aab7d9}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:30px}.card{padding:22px;border:1px solid #33436f;border-radius:18px;background:#111a36}.card h2{margin:0 0 8px;font-size:18px}.link{display:inline-block;margin-top:14px;color:#a9bcff;font-weight:700;text-decoration:none}.link:hover{text-decoration:underline}.button{border:1px solid #435487;border-radius:9px;padding:9px 12px;color:#eef2ff;text-decoration:none}.status{color:#77e0ad;font-weight:700}</style></head>
<body><main class="wrap"><div class="top"><div><div class="eyebrow">Punchdeck control</div><h1>Admin dashboard</h1><p class="muted">Authenticated gateway for the local Grist instance.</p></div><a class="button" href="/logout">Sign out</a></div>
<div class="grid"><section class="card"><h2>Grist workspace</h2><p class="muted">Open the spreadsheet editor with the Sheets-style menu and formatting bars.</p><a class="link" href="/editor">Open spreadsheet editor →</a></section>
<section class="card"><h2>Grist administration</h2><p class="muted">Manage the Grist deployment settings.</p><a class="link" href="/admin">Open Grist admin →</a></section>
<section class="card"><h2>Gateway status</h2><p class="status">Authenticated</p><p class="muted">Upstream: ${htmlEscape(config.gristOrigin)}</p><a class="link" href="/healthz">View health JSON →</a></section></div></main></body></html>`;
}

function renderHome(): string {
  const sheetIcon = `<span class="sheet-icon" aria-hidden="true"><span></span></span>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Punchdeck Sheets</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202124;background:#fff}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#fff}.topbar{height:72px;display:flex;align-items:center;gap:20px;padding:0 26px;border-bottom:1px solid #e5e7eb;background:#fff}.hamburger{border:0;background:transparent;font-size:23px;color:#4b5563;cursor:pointer}.brand{display:flex;align-items:center;gap:11px;min-width:185px;font-size:21px;color:#202124}.sheet-icon{position:relative;display:inline-grid;place-items:center;width:36px;height:36px;border-radius:7px;background:#11a36a;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}.sheet-icon:before,.sheet-icon:after{content:"";position:absolute;background:#fff;border-radius:2px}.sheet-icon:before{width:22px;height:4px}.sheet-icon:after{width:4px;height:22px}.sheet-icon span{position:absolute;right:4px;top:5px;width:7px;height:7px;border-radius:2px;background:#8ee0bc}.search{flex:1;max-width:720px;display:flex;align-items:center;gap:12px;background:#f1f5f9;border-radius:30px;padding:0 18px;height:48px;color:#526070}.search input{border:0;outline:0;background:transparent;width:100%;font-size:16px;color:#202124}.top-actions{margin-left:auto;display:flex;align-items:center;gap:20px;color:#4b5563}.apps{font-size:22px;letter-spacing:2px}.avatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(140deg,#d6a06e,#435b93);color:#fff;font-weight:700;font-size:14px}
.main{background:#f4f7fb;min-height:calc(100vh - 72px);padding:28px 34px 70px}.content{max-width:1120px;margin:0 auto}.section-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 18px}.section-head h1{font-size:18px;font-weight:500;margin:0}.section-head .muted{color:#5f6368;font-size:14px}.template-row{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:18px;margin-bottom:48px}.template{min-width:0}.template-card{height:126px;border:1px solid #d7dce2;border-radius:5px;background:#fff;display:grid;place-items:center;overflow:hidden;cursor:pointer;transition:box-shadow .15s,border-color .15s}.template-card:hover{border-color:#0b8f5a;box-shadow:0 2px 8px rgba(15,23,42,.12)}.template-label{display:block;margin-top:10px;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.blank-preview{width:100%;height:100%;display:grid;place-items:center}.blank-plus{width:42px;height:42px;border-radius:50%;background:linear-gradient(90deg,#f7b500 0 50%,#4285f4 50%);position:relative}.blank-plus:before,.blank-plus:after{content:"";position:absolute;background:#fff}.blank-plus:before{width:34px;height:7px;left:4px;top:18px}.blank-plus:after{width:7px;height:34px;left:18px;top:4px}.mini-grid{width:76%;height:78%;border:1px solid #d5dbe3;background:repeating-linear-gradient(0deg,#fff 0 16px,#dfe5eb 17px),repeating-linear-gradient(90deg,transparent 0 45px,#dfe5eb 46px)}.mini-grid.green{border-top:18px solid #0b9f66}.mini-grid.blue{border-top:17px solid #4d85ee}.mini-budget{width:76%;height:78%;padding:13px;background:#fff;border:1px solid #d4dae3}.mini-budget:before{content:"";display:block;width:60%;height:4px;background:#1f3f65;box-shadow:0 12px 0 #d9e2ee,0 24px 0 #d9e2ee}.mini-budget:after{content:"";display:block;margin-top:33px;width:76%;height:23px;background:linear-gradient(90deg,#f4b400 0 28%,#5a8dee 28% 58%,#dce6f6 58%)}
.files{background:#fff;border-radius:4px;padding:0 16px 18px}.files-head,.file-row{display:grid;grid-template-columns:minmax(280px,1fr) 150px 170px 42px;align-items:center;gap:18px}.files-head{height:54px;border-bottom:1px solid #e2e6eb;color:#5f6368;font-size:13px}.file-row{min-height:58px;border-bottom:1px solid #e8ebef;font-size:14px}.file-row:last-child{border-bottom:0}.file-name{display:flex;align-items:center;gap:14px;min-width:0}.file-name a{color:#202124;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.file-name a:hover{text-decoration:underline}.file-meta{color:#5f6368}.row-icon{display:grid;place-items:center;width:24px;height:24px;border-radius:4px;background:#0b9f66;color:#fff;font-weight:800;font-size:15px}.people{font-size:16px;color:#5f6368}.menu{border:0;background:transparent;color:#5f6368;font-size:21px;cursor:pointer}.toolbar{display:flex;align-items:center;gap:16px;color:#5f6368}.toolbar button{border:0;background:transparent;color:#5f6368;font-size:17px;cursor:pointer}.signout{color:#3568c8;text-decoration:none;font-size:13px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:820px){.topbar{padding:0 14px;gap:10px}.brand{min-width:auto}.brand-label{display:none}.main{padding:22px 14px}.template-row{grid-template-columns:repeat(2,minmax(140px,1fr))}.template-row .template:last-child{display:none}.files-head,.file-row{grid-template-columns:minmax(180px,1fr) 100px 30px}.files-head div:nth-child(3),.file-row .last-opened{display:none}.search{max-width:none}.top-actions{gap:8px}}
.drawer{position:fixed;inset:72px auto 0 0;width:270px;padding:20px;background:#fff;border-right:1px solid #dfe4ea;box-shadow:10px 0 28px rgba(15,23,42,.12);transform:translateX(-105%);transition:transform .18s ease;z-index:5}.drawer.open{transform:translateX(0)}.drawer h2{margin:0 0 14px;font-size:14px;color:#5f6368;text-transform:uppercase;letter-spacing:.08em}.drawer a{display:block;padding:12px 10px;border-radius:8px;color:#202124;text-decoration:none}.drawer a:hover{background:#eef5ff}.drawer .drawer-status{margin-top:28px;color:#5f6368;font-size:12px;line-height:1.5}.empty-state{display:none;padding:28px;color:#5f6368;text-align:center}.empty-state.visible{display:block}
</style></head>
<body><header class="topbar"><button id="nav-toggle" class="hamburger" aria-label="Open navigation" aria-expanded="false">☰</button><div class="brand">${sheetIcon}<span class="brand-label">Punchdeck Sheets</span></div><label class="search"><span aria-hidden="true">⌕</span><span class="sr-only">Search files</span><input id="file-search" placeholder="Search" aria-label="Search files"></label><div class="top-actions"><span class="apps" aria-label="Apps">⠿</span><span class="avatar" aria-label="Admin account">A</span></div></header>
<aside id="nav-drawer" class="drawer" aria-hidden="true"><h2>Navigate</h2><a href="/">Home</a><a href="/editor">All spreadsheets</a><a href="/control">Admin control</a><a href="/admin">Grist administration</a><p class="drawer-status">This shell controls navigation. Grist remains the open-source spreadsheet engine underneath.</p></aside>
<main class="main"><div class="content"><div class="section-head"><h1>Start a new spreadsheet</h1><div class="toolbar"><span class="muted">Template gallery</span><button aria-label="More templates">⌄</button><button aria-label="More options">⋮</button></div></div>
<div class="template-row"><div class="template" data-search="blank spreadsheet"><a class="template-card" href="/editor" aria-label="Blank spreadsheet"><span class="blank-preview"><span class="blank-plus"></span></span></a><span class="template-label">Blank spreadsheet</span></div><div class="template" data-search="to-do list"><a class="template-card" href="/editor" aria-label="To-do list"><span class="mini-grid green"></span></a><span class="template-label">To-do list</span></div><div class="template" data-search="annual budget"><a class="template-card" href="/editor" aria-label="Annual budget"><span class="mini-budget"></span></a><span class="template-label">Annual budget</span></div><div class="template" data-search="monthly budget"><a class="template-card" href="/editor" aria-label="Monthly budget"><span class="mini-budget"></span></a><span class="template-label">Monthly budget</span></div><div class="template" data-search="team tracker"><a class="template-card" href="/editor" aria-label="Team tracker"><span class="mini-grid blue"></span></a><span class="template-label">Team tracker</span></div></div>
<div class="section-head"><h1>Recent files</h1><a class="signout" href="/logout">Sign out</a></div><section class="files" aria-label="Recent files"><div class="files-head"><div>Name</div><div>Owner</div><div>Last opened by me</div><div></div></div><div class="file-row" data-search="punchdeck data workspace"><div class="file-name"><span class="row-icon">+</span><a href="/editor">Punchdeck data workspace</a><span class="people" aria-label="Shared with team">♧</span></div><div class="file-meta">me</div><div class="file-meta last-opened">Just now</div><button class="menu" aria-label="More options">⋮</button></div><div class="file-row" data-search="team sheet"><div class="file-name"><span class="row-icon">+</span><a href="/editor">Team sheet</a><span class="people" aria-label="Shared with team">♧</span></div><div class="file-meta">me</div><div class="file-meta last-opened">Today</div><button class="menu" aria-label="More options">⋮</button></div><div class="file-row" data-search="api records"><div class="file-name"><span class="row-icon">+</span><a href="/editor">API records</a></div><div class="file-meta">me</div><div class="file-meta last-opened">Earlier</div><button class="menu" aria-label="More options">⋮</button></div><div id="empty-state" class="empty-state">No spreadsheets match your search.</div></section></div></main>
<script>const toggle=document.getElementById('nav-toggle');const drawer=document.getElementById('nav-drawer');const search=document.getElementById('file-search');const items=[...document.querySelectorAll('[data-search]')];const empty=document.getElementById('empty-state');toggle.addEventListener('click',()=>{const open=!drawer.classList.contains('open');drawer.classList.toggle('open',open);drawer.setAttribute('aria-hidden',String(!open));toggle.setAttribute('aria-expanded',String(open));});search.addEventListener('input',()=>{const query=search.value.trim().toLowerCase();let shown=0;items.forEach(item=>{const visible=!query||item.dataset.search.includes(query);item.style.display=visible?'':'none';if(visible)shown++;});empty.classList.toggle('visible',shown===0);});</script></body></html>`;
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

function isAuthenticated(request: IncomingMessage, sessions: Map<string, Session>): boolean {
  const token = getCookies(request).get("admin_session");
  const session = token ? sessions.get(token) : undefined;
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token!);
    return false;
  }
  return true;
}

async function readBody(request: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_LOGIN_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function verifyLogin(username: string, password: string, config: AdminGatewayConfig): boolean {
  const supplied = derivePassword(password, config.passwordSalt);
  return username === config.username && supplied.length === config.passwordDigest.length && timingSafeEqual(supplied, config.passwordDigest);
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

export function createAdminGatewayServer(config: AdminGatewayConfig): Server {
  const sessions = new Map<string, Session>();
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;

    if (pathname === "/assets/aureum-logo.png" || pathname === "/assets/aureum-mall-design.jpg") {
      if (request.method !== "GET") {
        response.statusCode = 405;
        response.setHeader("Allow", "GET");
        response.end();
        return;
      }
      sendAsset(response, pathname.endsWith(".png") ? aureumLogo : aureumMallDesign, pathname.endsWith(".png") ? "image/png" : "image/jpeg");
      return;
    }

    if (pathname === "/healthz") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ status: "ok", service: "punchdeck-admin-gateway" }));
      return;
    }

    if (pathname === "/login") {
      if (request.method === "GET") {
        sendHtml(response, 200, renderLogin());
        return;
      }
      if (request.method === "POST") {
        try {
          const form = new URLSearchParams(await readBody(request));
          const username = form.get("username") ?? "";
          const password = form.get("password") ?? "";
          if (!verifyLogin(username, password, config)) {
            sendHtml(response, 401, renderLogin("Invalid username or password."));
            return;
          }
          const token = randomBytes(32).toString("base64url");
          sessions.set(token, { expiresAt: Date.now() + config.sessionTtlMs });
          response.setHeader("Set-Cookie", cookieHeader(token, config));
          redirect(response, "/");
        } catch (error) {
          sendHtml(response, 400, renderLogin(error instanceof Error ? error.message : "Invalid request."));
        }
        return;
      }
      response.statusCode = 405;
      response.setHeader("Allow", "GET, POST");
      response.end();
      return;
    }

    if (pathname === "/logout") {
      const token = getCookies(request).get("admin_session");
      if (token) sessions.delete(token);
      response.setHeader("Set-Cookie", "admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      redirect(response, "/login");
      return;
    }

    if (!isAuthenticated(request, sessions)) {
      redirect(response, "/login");
      return;
    }

    if (pathname === "/") {
      sendHtml(response, 200, renderHome());
      return;
    }

    if (pathname === "/editor") {
      sendHtml(response, 200, renderEditorShell());
      return;
    }

    if (pathname === "/control") {
      sendHtml(response, 200, renderControl(config));
      return;
    }

    proxyHttp(request, response, config, "/grist");
  });

  server.on("upgrade", (request, socket, head) => {
    if (!isAuthenticated(request, sessions)) {
      writeUnauthorized(socket);
      return;
    }
    proxyUpgrade(request, socket, head, config, "/grist");
  });

  return server;
}

export async function startAdminGateway(env: NodeJS.ProcessEnv = process.env): Promise<Server> {
  const config = loadAdminGatewayConfig(env);
  const server = createAdminGatewayServer(config);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(config.port, config.host, () => resolveListen());
  });
  console.log(JSON.stringify({ event: "admin_gateway_started", host: config.host, port: config.port, gristOrigin: config.gristOrigin }));
  return server;
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entrypoint === fileURLToPath(import.meta.url)) {
  startAdminGateway().catch((error: unknown) => {
    console.error(JSON.stringify({ event: "admin_gateway_fatal", error: String(error) }));
    process.exitCode = 1;
  });
}
