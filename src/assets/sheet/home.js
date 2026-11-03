/* Home page: recent spreadsheets (server + this browser), file menus, and account/app menus. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const role = document.body.dataset.role || "viewer";
  const canEdit = role === "admin" || role === "editor";
  const list = $("recent-list");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let entries = [];

  function localIndex() {
    try { return JSON.parse(localStorage.getItem("aureum-sheet:index") || "[]"); } catch { return []; }
  }
  function when(t) {
    if (!t) return "";
    const d = Date.now() - t;
    if (d < 6e4) return "Just now";
    if (d < 36e5) return Math.floor(d / 6e4) + " min ago";
    const day = new Date(t);
    return day.toDateString() === new Date().toDateString() ? day.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : day.toLocaleDateString();
  }
  function toast(message) {
    const t = $("toast");
    t.textContent = message;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 3200);
  }
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

  function render() {
    list.innerHTML = entries.map((e, i) =>
      '<div class="file-row" data-search="' + esc(String(e.title).toLowerCase()) + '"><div class="file-name"><span class="row-icon">+</span><a href="/editor?id=' + encodeURIComponent(e.id) + '">' + esc(e.title) + "</a>" +
      (e.starred ? '<span class="star" aria-label="Starred">★</span>' : "") +
      (e.localOnly ? '<span class="badge" title="Only saved in this browser; open it once to upload it">this browser</span>' : "") +
      '</div><div class="file-meta">' + esc(e.updatedBy || "me") + '</div><div class="file-meta last-opened">' + when(e.updated) +
      '</div><button class="menu" data-file="' + i + '" aria-label="More options for ' + esc(e.title) + '" aria-haspopup="true">⋮</button></div>').join("");
    $("no-files").classList.toggle("visible", !entries.length);
    applySearch();
  }
  async function load() {
    const local = localIndex().map((e) => ({ id: e.id, title: e.title, starred: e.starred, updated: e.updated, localOnly: true }));
    entries = local;
    render();
    try {
      const res = await api("GET", "/api/sheets");
      if (!res.data || !Array.isArray(res.data.documents)) return;
      const ids = new Set(res.data.documents.map((d) => d.id));
      entries = res.data.documents.map((d) => ({ id: d.id, title: d.title, starred: d.starred, updated: Date.parse(d.updatedAt), updatedBy: d.updatedBy }))
        .concat(local.filter((e) => !ids.has(e.id)));
      entries.sort((a, b) => (b.starred - a.starred) || (b.updated - a.updated));
      render();
    } catch { /* offline: keep the browser list */ }
  }

  // ---------------------------------------------------------------- popovers
  let openPopover = null;
  function closePopover() {
    if (openPopover) openPopover.hidden = true;
    openPopover = null;
  }
  function showPopover(pop, anchor) {
    closePopover();
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const left = Math.min(window.scrollX + r.right - pop.offsetWidth, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8);
    pop.style.left = Math.max(8, left) + "px";
    pop.style.top = window.scrollY + r.bottom + 4 + "px";
    openPopover = pop;
  }
  document.addEventListener("click", (e) => {
    if (openPopover && !openPopover.contains(e.target) && !e.target.closest("[aria-haspopup]")) closePopover();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopover(); });
  $("apps-button").addEventListener("click", (e) => showPopover($("apps-menu"), e.currentTarget));
  $("avatar-button").addEventListener("click", (e) => showPopover($("account-menu"), e.currentTarget));

  // ---------------------------------------------------------------- file menu
  async function updateDoc(entry, change) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const got = await api("GET", "/api/sheets/" + encodeURIComponent(entry.id));
      if (got.status !== 200) throw new Error("Couldn't load the spreadsheet");
      change(got.data.doc);
      const put = await api("PUT", "/api/sheets/" + encodeURIComponent(entry.id), { baseVersion: got.data.version, doc: got.data.doc });
      if (put.status === 200) return;
      if (put.status !== 409) throw new Error((put.data && put.data.error) || "Save failed");
    }
    throw new Error("The spreadsheet kept changing; try again");
  }
  function renameDialog(entry) {
    const back = document.createElement("div");
    back.className = "dialog-backdrop";
    back.innerHTML = '<form class="dialog"><h2>Rename</h2><input name="title" maxlength="200" required><div class="actions"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">OK</button></div></form>';
    document.body.appendChild(back);
    const input = back.querySelector("input");
    input.value = entry.title;
    input.select();
    const close = () => back.remove();
    back.querySelector("[data-cancel]").addEventListener("click", close);
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    back.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = input.value.trim();
      close();
      if (!title || title === entry.title) return;
      try {
        await updateDoc(entry, (doc) => { doc.title = title; });
        toast("Renamed");
        load();
      } catch (error) { toast(error.message); }
    });
  }
  function confirmDialog(message, action, onConfirm) {
    const back = document.createElement("div");
    back.className = "dialog-backdrop";
    back.innerHTML = '<div class="dialog" role="alertdialog"><h2></h2><div class="actions"><button class="btn" data-cancel>Cancel</button><button class="btn danger" data-ok></button></div></div>';
    back.querySelector("h2").textContent = message;
    back.querySelector("[data-ok]").textContent = action;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.querySelector("[data-cancel]").addEventListener("click", close);
    back.querySelector("[data-ok]").addEventListener("click", () => { close(); onConfirm(); });
    back.querySelector("[data-ok]").focus();
  }
  list.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-file]");
    if (!button) return;
    const entry = entries[+button.dataset.file];
    const menu = $("file-menu");
    const editable = canEdit && !entry.localOnly;
    menu.innerHTML =
      '<a href="/editor?id=' + encodeURIComponent(entry.id) + '">Open</a>' +
      '<a href="/editor?id=' + encodeURIComponent(entry.id) + '" target="_blank" rel="noopener">Open in new tab</a><hr>' +
      "<button data-act=\"rename\"" + (editable ? "" : " disabled") + ">Rename</button>" +
      "<button data-act=\"star\"" + (editable ? "" : " disabled") + ">" + (entry.starred ? "Remove star" : "Add star") + "</button>" +
      "<hr><button data-act=\"delete\"" + (canEdit ? "" : " disabled") + ">" + (entry.localOnly ? "Remove from this browser" : "Delete") + "</button>";
    menu.onclick = async (ev) => {
      const act = ev.target.closest("button[data-act]");
      if (!act || act.disabled) return;
      closePopover();
      if (act.dataset.act === "rename") renameDialog(entry);
      if (act.dataset.act === "star") {
        try {
          await updateDoc(entry, (doc) => { doc.starred = !entry.starred; });
          load();
        } catch (error) { toast(error.message); }
      }
      if (act.dataset.act === "delete") {
        confirmDialog("Delete “" + entry.title + "”?", "Delete", async () => {
          if (!entry.localOnly) {
            const res = await api("DELETE", "/api/sheets/" + encodeURIComponent(entry.id));
            if (res.status !== 200 && res.status !== 404) { toast((res.data && res.data.error) || "Delete failed"); return; }
          }
          try {
            localStorage.removeItem("aureum-sheet:doc:" + entry.id);
            localStorage.setItem("aureum-sheet:index", JSON.stringify(localIndex().filter((x) => x.id !== entry.id)));
          } catch { /* ignore */ }
          toast("Deleted");
          load();
        });
      }
    };
    showPopover(menu, button);
  });

  // ---------------------------------------------------------------- navigation, templates, search
  const toggle = $("nav-toggle");
  const drawer = $("nav-drawer");
  toggle.addEventListener("click", () => {
    const open = !drawer.classList.contains("open");
    drawer.classList.toggle("open", open);
    drawer.setAttribute("aria-hidden", String(!open));
    toggle.setAttribute("aria-expanded", String(open));
  });
  const templatesButton = $("toggle-templates");
  if (templatesButton) {
    const row = $("template-row");
    const apply = (hidden) => {
      row.classList.toggle("collapsed", hidden);
      templatesButton.textContent = hidden ? "Show templates" : "Hide templates";
      templatesButton.setAttribute("aria-expanded", String(!hidden));
    };
    let hidden = false;
    try { hidden = localStorage.getItem("aureum-sheet:hide-templates") === "1"; } catch { /* ignore */ }
    apply(hidden);
    templatesButton.addEventListener("click", () => {
      hidden = !hidden;
      apply(hidden);
      try { localStorage.setItem("aureum-sheet:hide-templates", hidden ? "1" : "0"); } catch { /* ignore */ }
    });
  }
  const search = $("file-search");
  function applySearch() {
    const query = search.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll("#recent-list [data-search], #template-row [data-search]").forEach((item) => {
      const visible = !query || item.dataset.search.includes(query);
      item.style.display = visible ? "" : "none";
      if (visible) shown++;
    });
    $("empty-state").classList.toggle("visible", !!query && shown === 0);
  }
  search.addEventListener("input", applySearch);

  // ---------------------------------------------------------------- @mentions inbox
  const seenKey = "aureum-sheet:mentions-seen:" + (document.body.dataset.user || "");
  async function loadMentions() {
    let res;
    try { res = await api("GET", "/api/mentions"); } catch { return; }
    if (res.status !== 200 || !res.data) return;
    const mentions = res.data.mentions;
    let seen = "";
    try { seen = localStorage.getItem(seenKey) || ""; } catch { /* ignore */ }
    const section = $("mentions");
    section.hidden = !mentions.length;
    const unread = mentions.filter((m) => m.at > seen).length;
    $("mention-count").textContent = unread ? String(unread) : "";
    const listEl = $("mention-list");
    listEl.innerHTML = "";
    for (const m of mentions.slice(0, 20)) {
      const a = document.createElement("a");
      a.className = "mention" + (m.at > seen ? " unread" : "") + (m.resolved ? " resolved" : "");
      a.href = "/editor?id=" + encodeURIComponent(m.docId) + "&sheet=" + encodeURIComponent(m.sheetId) + "&cell=" + encodeURIComponent(m.cell);
      const [r, c] = m.cell.split(":").map(Number);
      let col = "", n = c + 1;
      while (n > 0) { const k = (n - 1) % 26; col = String.fromCharCode(65 + k) + col; n = Math.floor((n - 1) / 26); }
      a.innerHTML = '<div class="meta"><strong></strong> mentioned you in <span class="where"></span> · <span class="when"></span></div><div class="text"></div>';
      a.querySelector("strong").textContent = m.author;
      a.querySelector(".where").textContent = m.docTitle + " › " + m.sheetName + "!" + col + (r + 1) + (m.resolved ? " (resolved)" : "");
      a.querySelector(".when").textContent = when(Date.parse(m.at));
      a.querySelector(".text").textContent = m.text;
      listEl.appendChild(a);
    }
    $("mentions-read").onclick = () => {
      try { if (mentions[0]) localStorage.setItem(seenKey, mentions[0].at); } catch { /* ignore */ }
      loadMentions();
    };
  }
  load();
  loadMentions();
})();
