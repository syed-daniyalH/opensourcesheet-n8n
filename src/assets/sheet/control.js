/* Admin control page: user management and the audit log. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const me = document.body.dataset.user || "";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  async function api(method, path, body) {
    const init = { method, credentials: "same-origin", headers: {} };
    if (method !== "GET") init.headers["X-Requested-With"] = "aureum-sheet";
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(path, init);
    const type = res.headers.get("content-type") || "";
    return { status: res.status, data: type.includes("application/json") ? await res.json() : null };
  }
  function message(text, isError) {
    const el = $("user-msg");
    el.textContent = text;
    el.classList.toggle("error", !!isError);
  }

  async function loadUsers() {
    const res = await api("GET", "/api/users");
    if (res.status !== 200) { $("user-rows").innerHTML = '<tr><td colspan="4">Could not load users</td></tr>'; return; }
    $("user-rows").innerHTML = res.data.users.map((u) => {
      const self = u.username.toLowerCase() === me.toLowerCase();
      const roleCell = u.builtIn
        ? esc(u.role) + ' <span class="muted">(built-in, set by ADMIN_USERNAME / ADMIN_PASSWORD)</span>'
        : '<select data-role="' + esc(u.username) + '"' + (self ? " disabled" : "") + ">" + ["admin", "editor", "viewer"].map((r) => '<option value="' + r + '"' + (r === u.role ? " selected" : "") + ">" + r + "</option>").join("") + "</select>";
      const actions = u.builtIn || self ? "" : '<button class="btn small" data-reset="' + esc(u.username) + '">Reset password</button> <button class="btn small danger" data-remove="' + esc(u.username) + '">Remove</button>';
      return "<tr><td>" + esc(u.username) + (self ? ' <span class="pill">you</span>' : "") + "</td><td>" + roleCell + "</td><td>" + esc(u.createdAt ? new Date(u.createdAt).toLocaleString() : "") + "</td><td>" + actions + "</td></tr>";
    }).join("");
  }
  $("user-rows").addEventListener("change", async (e) => {
    const select = e.target.closest("select[data-role]");
    if (!select) return;
    const res = await api("PUT", "/api/users/" + encodeURIComponent(select.dataset.role), { role: select.value });
    message(res.status < 300 ? "Role updated for " + select.dataset.role : (res.data && res.data.error) || "Update failed", res.status >= 300);
    loadUsers();
    loadAudit();
  });
  $("user-rows").addEventListener("click", async (e) => {
    const reset = e.target.closest("[data-reset]");
    const remove = e.target.closest("[data-remove]");
    if (reset) {
      const name = reset.dataset.reset;
      const password = prompt("New password for " + name + " (at least 12 characters):");
      if (!password) return;
      const row = reset.closest("tr").querySelector("select");
      const res = await api("PUT", "/api/users/" + encodeURIComponent(name), { role: row ? row.value : "editor", password });
      message(res.status < 300 ? "Password changed; " + name + " was signed out" : (res.data && res.data.error) || "Update failed", res.status >= 300);
      loadAudit();
    }
    if (remove) {
      const name = remove.dataset.remove;
      if (!confirm("Remove " + name + "? They are signed out immediately.")) return;
      const res = await api("DELETE", "/api/users/" + encodeURIComponent(name));
      message(res.status < 300 ? "Removed " + name : (res.data && res.data.error) || "Remove failed", res.status >= 300);
      loadUsers();
      loadAudit();
    }
  });
  $("user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = { role: form.role.value };
    if (form.password.value) body.password = form.password.value;
    const res = await api("PUT", "/api/users/" + encodeURIComponent(form.username.value.trim()), body);
    if (res.status < 300) {
      message((res.status === 201 ? "Created " : "Updated ") + res.data.username);
      form.reset();
    } else message((res.data && res.data.error) || "Save failed", true);
    loadUsers();
    loadAudit();
  });

  async function loadAudit() {
    const res = await api("GET", "/api/audit?limit=200");
    if (res.status !== 200) { $("audit-rows").innerHTML = '<tr><td colspan="4">Could not load the audit log</td></tr>'; return; }
    if (!res.data.events.length) { $("audit-rows").innerHTML = '<tr><td colspan="4" class="muted">No events yet</td></tr>'; return; }
    $("audit-rows").innerHTML = res.data.events.map((ev) => {
      const details = Object.keys(ev).filter((k) => !["at", "event", "user"].includes(k)).map((k) => esc(k) + "=" + esc(typeof ev[k] === "object" ? JSON.stringify(ev[k]) : ev[k])).join(" · ");
      return "<tr><td>" + esc(new Date(ev.at).toLocaleString()) + "</td><td>" + esc(ev.event) + "</td><td>" + esc(ev.user || "") + "</td><td><code>" + details + "</code></td></tr>";
    }).join("");
  }
  loadUsers();
  loadAudit();
})();
