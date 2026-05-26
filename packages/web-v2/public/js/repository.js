import { requireUser, esc, formatBytes, formatDate, renderSidebar, showError } from "./app.js";

const params   = new URLSearchParams(location.search);
const repoName = params.get("repo");

// ── State ─────────────────────────────────────────────────────────────────────
let allSnapshots = [];
let currentSnap  = params.get("snapshot") || null;
let treeData     = null;
let currentPath  = "";
let currentFile = null;

// ── File icons ────────────────────────────────────────────────────────────────
const EXT_ICONS = {
  ts:"🟦", tsx:"🟦", js:"🟨", jsx:"🟨", mjs:"🟨", cjs:"🟨",
  py:"🐍", go:"🐹", rs:"🦀", java:"☕", kt:"🟣", swift:"🧡",
  c:"⚙️", cpp:"⚙️", h:"⚙️", hpp:"⚙️",
  json:"🔧", yaml:"🔧", yml:"🔧", toml:"🔧", ini:"🔧", env:"🔧",
  html:"🌐", htm:"🌐", css:"🎨", scss:"🎨", less:"🎨",
  md:"📝", mdx:"📝", txt:"📝", rst:"📝",
  sh:"💲", bash:"💲", zsh:"💲",
  sql:"🗃️", graphql:"🔷",
  png:"🖼️", jpg:"🖼️", jpeg:"🖼️", gif:"🖼️", svg:"🖼️", ico:"🖼️", webp:"🖼️",
  pdf:"📕", zip:"📦", tar:"📦", gz:"📦",
};
function fileIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return EXT_ICONS[ext] || "📄";
}

// ── Language map ──────────────────────────────────────────────────────────────
function detectLang(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return ({
    ts:"typescript", tsx:"typescript", js:"javascript", jsx:"javascript",
    mjs:"javascript", cjs:"javascript", py:"python", go:"go", rs:"rust",
    json:"json", jsonc:"json", css:"css", scss:"scss", less:"less",
    html:"html", htm:"html", md:"markdown", mdx:"markdown", sh:"shell",
    bash:"shell", yaml:"yaml", yml:"yaml", toml:"ini", sql:"sql",
    xml:"xml", graphql:"graphql", java:"java", kt:"kotlin",
    swift:"swift", c:"c", cpp:"cpp",
  })[ext] || "plaintext";
}

const IMAGE_RE  = /\.(png|jpg|jpeg|gif|ico|webp|bmp|svg)$/i;
const BINARY_RE = /\.(pdf|zip|tar|gz|7z|rar|exe|dll|wasm|mp3|mp4|wav|ogg|ttf|woff|woff2)$/i;

// ── File table builder ────────────────────────────────────────────────────────
function getItemsAtPath(files, path) {
  const prefix = path ? path + "/" : "";
  const entries = new Map();
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const rest  = file.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      if (!entries.has(rest)) entries.set(rest, { type: "file", fullPath: file });
    } else {
      const dirName = rest.slice(0, slash);
      if (!entries.has(dirName)) entries.set(dirName, { type: "dir", name: dirName });
    }
  }
  return [...entries.entries()]
    .sort(([an, av], [bn, bv]) => {
      if (av.type !== bv.type) return av.type === "dir" ? -1 : 1;
      return an.localeCompare(bn, undefined, { sensitivity: "base" });
    })
    .map(([name, info]) => ({ name, ...info }));
}

function renderFileTable(files, checksums, path) {
  const items = getItemsAtPath(files, path);
  if (!items.length) return `<div class="gh-empty">No files in this directory.</div>`;
  return items.map(item => {
    const icon = item.type === "dir" ? "📁" : fileIcon(item.name);
    const chk  = item.type === "file" && checksums[item.fullPath]
      ? `<span class="gh-file-chk" title="${esc(checksums[item.fullPath])}">sha256</span>` : "";
    return `<div class="gh-file-row gh-file-${item.type}"
        data-name="${esc(item.name)}" data-type="${item.type}"
        ${item.fullPath ? `data-file="${esc(item.fullPath)}"` : ""}
        tabindex="0" role="button">
      <span class="gh-file-icon">${icon}</span>
      <span class="gh-file-name">${esc(item.name)}</span>
      <span class="gh-file-meta">${chk}</span>
    </div>`;
  }).join("");
}

function renderPathBar(path) {
  const parts = path ? path.split("/") : [];
  const isLast = (i) => i === parts.length - 1;
  let crumbs = `<span class="gh-path-crumb${parts.length ? "" : " gh-path-crumb-active"}" data-path="" role="button" tabindex="0">${esc(repoName)}</span>`;
  let built = "";
  parts.forEach((part, i) => {
    built = built ? built + "/" + part : part;
    const p = built;
    crumbs += `<span class="gh-path-sep">/</span><span class="gh-path-crumb${isLast(i) ? " gh-path-crumb-active" : ""}" data-path="${esc(p)}" role="button" tabindex="0">${esc(part)}</span>`;
  });
  return crumbs;
}

// ── Simple text editor ────────────────────────────────────────────────────────
async function openEditor(filename) {
  const statusEl  = document.getElementById("editor-status");
  const container = document.getElementById("monaco-container");
  document.getElementById("editor-path").textContent = filename;
  document.getElementById("editor-modal").classList.add("editor-open");
  document.getElementById("editor-save-btn").disabled = true;
  statusEl.textContent = "Loading…";
  container.innerHTML = "";

  try {
    const res  = await fetch(`/api/files?repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(currentSnap)}&file=${encodeURIComponent(filename)}`);
    const json = await res.json();
    if (!json.success) { statusEl.textContent = json.error || "Error loading file"; return; }

    const d = json.data;

    if (d.excluded) {
      container.innerHTML = `<div class="editor-notice">🔒 This file is excluded for security (environment file — content not stored in snapshot)</div>`;
      statusEl.textContent = "Excluded";
      return;
    }

    if (d.image) {
      container.innerHTML = `<div class="editor-image-wrap"><img src="data:${d.mime};base64,${d.content}" alt="${esc(filename)}" class="editor-image"/></div>`;
      statusEl.textContent = "Image";
      return;
    }

    if (d.binary) {
      container.innerHTML = `<div class="editor-notice">Binary file — cannot display</div>`;
      statusEl.textContent = "Binary";
      return;
    }

    currentFile = filename;
    const ta = document.createElement("textarea");
    ta.id        = "editor-textarea";
    ta.className = "editor-textarea";
    ta.value     = d.content;
    ta.spellcheck = false;
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveFile(); }
      if (e.key === "Tab") {
        e.preventDefault();
        const s = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = s + 2;
      }
    });
    container.appendChild(ta);
    ta.focus();
    statusEl.textContent = "Ready";
    document.getElementById("editor-save-btn").disabled = false;
  } catch {
    statusEl.textContent = "Failed to load file";
  }
}

function closeEditor() {
  document.getElementById("editor-modal").classList.remove("editor-open");
  document.getElementById("monaco-container").innerHTML = "";
  currentFile = null;
}

async function saveFile() {
  const ta = document.getElementById("editor-textarea");
  if (!currentFile || !ta) return;
  const statusEl = document.getElementById("editor-status");
  const saveBtn  = document.getElementById("editor-save-btn");
  saveBtn.disabled = true;
  statusEl.textContent = "Saving…";
  try {
    const res  = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoName, snapshot: currentSnap, file: currentFile, content: ta.value }),
    });
    const json = await res.json();
    statusEl.textContent = json.success ? "Saved ✓" : ("Error: " + (json.error || "unknown"));
  } catch {
    statusEl.textContent = "Network error";
  } finally {
    saveBtn.disabled = false;
  }
}

// ── Markdown ──────────────────────────────────────────────────────────────────
function simpleMarkdown(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^#{6}\s(.+)/gm, "<h6>$1</h6>").replace(/^#{5}\s(.+)/gm, "<h5>$1</h5>")
    .replace(/^#{4}\s(.+)/gm, "<h4>$1</h4>").replace(/^###\s(.+)/gm, "<h3>$1</h3>")
    .replace(/^##\s(.+)/gm,  "<h2>$1</h2>").replace(/^#\s(.+)/gm,   "<h1>$1</h1>")
    .replace(/```[\w]*\n([\s\S]*?)```/gm, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/^\s*[-*+]\s+(.+)/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(.+)$/gm, (m) => m.startsWith("<") ? m : `<p>${m}</p>`);
}

// ── Main content render ───────────────────────────────────────────────────────
function renderMainContent() {
  const { files, checksums, manifest, totalFiles, size, modifiedTime, readmeFile } = treeData;
  const snapOpts = allSnapshots.map(s =>
    `<option value="${esc(s.name)}" ${s.name === currentSnap ? "selected" : ""}>${esc(s.name)}</option>`
  ).join("");

  const main = document.getElementById("repo-main");
  main.style.cssText = "padding:0;overflow:hidden;display:flex;flex-direction:column;height:100vh";

  main.innerHTML = `
    <div class="gh-repo-bar">
      <div class="gh-repo-bar-left">
        <a class="gh-back-link" href="/repositories">← Repositories</a>
        <span class="gh-bar-sep">/</span>
        <span class="gh-repo-name">${esc(repoName)}</span>
      </div>
      <div class="gh-repo-bar-right">
        <div class="gh-snap-select-wrap">
          <span class="gh-snap-label">Snapshot</span>
          <select class="gh-snap-select" id="snap-selector">${snapOpts}</select>
        </div>
        <button class="gh-action-btn" id="download-btn" title="Download .on snapshot">&#11015; Download</button>
        <button class="gh-action-btn" id="verify-btn" title="Verify checksums">&#128274; Verify</button>
        <button class="gh-action-btn" id="compare-btn" title="Compare snapshots" ${allSnapshots.length < 2 ? "disabled" : ""}>&#9889; Compare</button>
        <button class="gh-action-btn gh-action-terminal" id="open-terminal-btn" title="Terminal (Ctrl+\`)">&#8984;</button>
      </div>
    </div>

    <div class="gh-repo-content" id="gh-repo-content">
      <div class="gh-file-card" id="gh-file-card">
        <div class="gh-file-card-header">
          <div class="gh-path-bar" id="gh-path-bar">${renderPathBar("")}</div>
          <div class="gh-snap-pills" id="gh-snap-pills">
            <span class="gh-pill">${totalFiles} files</span>
            <span class="gh-pill">${formatBytes(size)}</span>
            <span class="gh-pill">${formatDate(modifiedTime)}</span>
            ${manifest.projectName ? `<span class="gh-pill gh-pill-accent">${esc(manifest.projectName)}</span>` : ""}
          </div>
        </div>
        <div class="gh-file-list" id="gh-file-list">${renderFileTable(files, checksums, "")}</div>
      </div>

      <div class="gh-readme-card" id="gh-readme-card" ${!readmeFile ? "hidden" : ""}>
        <div class="gh-readme-header">
          <span class="gh-readme-icon">📝</span>
          <span id="gh-readme-title">${readmeFile ? esc(readmeFile.split("/").pop()) : ""}</span>
        </div>
        <div class="gh-readme-body" id="gh-readme-body">
          <p style="color:rgba(247,248,251,0.4);padding:20px 28px">Loading README…</p>
        </div>
      </div>
    </div>`;

  // Snapshot selector
  document.getElementById("snap-selector").addEventListener("change", async (e) => {
    currentSnap = e.target.value;
    currentPath = "";
    const url = new URL(location.href);
    url.searchParams.set("snapshot", currentSnap);
    history.pushState(null, "", url.toString());
    await switchSnapshot(currentSnap);
  });

  // Path bar (event delegation)
  document.getElementById("gh-path-bar").addEventListener("click", (e) => {
    const crumb = e.target.closest(".gh-path-crumb");
    if (crumb) navigateTo(crumb.dataset.path || "");
  });

  // File list (event delegation)
  document.getElementById("gh-file-list").addEventListener("click", (e) => {
    const row = e.target.closest(".gh-file-row");
    if (!row) return;
    if (row.dataset.type === "dir") {
      navigateTo(currentPath ? currentPath + "/" + row.dataset.name : row.dataset.name);
    } else if (row.dataset.file) {
      handleFileOpen(row.dataset.file);
    }
  });

  // Keyboard nav for file rows
  document.getElementById("gh-file-list").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest(".gh-file-row");
    if (!row) return;
    e.preventDefault();
    row.click();
  });

  document.getElementById("download-btn")?.addEventListener("click", () => {
    window.location.href = `/api/snapshot?action=download&repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(currentSnap)}`;
  });
  document.getElementById("verify-btn")?.addEventListener("click", openVerifyModal);
  document.getElementById("compare-btn")?.addEventListener("click", openCompareModal);
  document.getElementById("open-terminal-btn")?.addEventListener("click", toggleTerminal);

  if (readmeFile) loadReadme(readmeFile);
}

function navigateTo(path) {
  currentPath = path;
  const { files, checksums, readmeFile } = treeData;
  document.getElementById("gh-path-bar").innerHTML = renderPathBar(path);
  document.getElementById("gh-file-list").innerHTML = renderFileTable(files, checksums, path);
  // Re-wire path bar after innerHTML replace
  document.getElementById("gh-path-bar").addEventListener("click", (e) => {
    const crumb = e.target.closest(".gh-path-crumb");
    if (crumb) navigateTo(crumb.dataset.path || "");
  });
  const readmeCard = document.getElementById("gh-readme-card");
  if (readmeCard) readmeCard.hidden = (path !== "");
}

async function switchSnapshot(snapName) {
  const fileCard = document.getElementById("gh-file-card");
  if (fileCard) fileCard.style.opacity = "0.5";
  try {
    const res  = await fetch(`/api/snapshot?action=tree&repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(snapName)}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Failed");
    treeData = json.data;
    const { files, checksums, manifest, totalFiles, size, modifiedTime, readmeFile } = treeData;
    currentPath = "";
    document.getElementById("gh-path-bar").innerHTML = renderPathBar("");
    document.getElementById("gh-file-list").innerHTML = renderFileTable(files, checksums, "");
    document.getElementById("gh-snap-pills").innerHTML = `
      <span class="gh-pill">${totalFiles} files</span>
      <span class="gh-pill">${formatBytes(size)}</span>
      <span class="gh-pill">${formatDate(modifiedTime)}</span>
      ${manifest.projectName ? `<span class="gh-pill gh-pill-accent">${esc(manifest.projectName)}</span>` : ""}`;
    const readmeCard = document.getElementById("gh-readme-card");
    if (readmeFile && readmeCard) {
      readmeCard.hidden = false;
      document.getElementById("gh-readme-title").textContent = readmeFile.split("/").pop();
      document.getElementById("gh-readme-body").innerHTML = `<p style="color:rgba(247,248,251,0.4);padding:20px 28px">Loading README…</p>`;
      loadReadme(readmeFile);
    } else if (readmeCard) {
      readmeCard.hidden = true;
    }
    document.getElementById("compare-btn").disabled = allSnapshots.length < 2;
  } catch (err) {
    showError(document.getElementById("repo-main"), err.message || "Failed to load snapshot.");
  } finally {
    if (fileCard) fileCard.style.opacity = "";
  }
}

async function loadReadme(filename) {
  const body = document.getElementById("gh-readme-body");
  if (!body) return;
  try {
    const res  = await fetch(`/api/files?repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(currentSnap)}&file=${encodeURIComponent(filename)}`);
    const json = await res.json();
    if (!json.success || json.data.binary) {
      body.innerHTML = `<p style="color:rgba(247,248,251,0.4);padding:20px 28px">Could not load README.</p>`;
      return;
    }
    body.innerHTML = `<div class="readme-view">${simpleMarkdown(json.data.content)}</div>`;
  } catch {
    body.innerHTML = `<p style="color:rgba(247,248,251,0.4);padding:20px 28px">Failed to load README.</p>`;
  }
}

function handleFileOpen(filename) {
  if (BINARY_RE.test(filename)) {
    const existing = document.getElementById("gh-binary-notice");
    if (existing) existing.remove();
    const notice = document.createElement("div");
    notice.id = "gh-binary-notice";
    notice.className = "gh-binary-notice";
    notice.textContent = `Binary file — cannot display: ${filename}`;
    document.getElementById("gh-file-card").appendChild(notice);
    setTimeout(() => notice?.remove(), 3000);
    return;
  }
  openEditor(filename);
}

// ── Compare modal ─────────────────────────────────────────────────────────────
function openCompareModal() {
  const modal  = document.getElementById("compare-modal");
  const select = document.getElementById("compare-select");
  const others = allSnapshots.filter(s => s.name !== currentSnap);
  select.innerHTML = others.map(s =>
    `<option value="${esc(s.name)}">${esc(s.name)} — ${s.sizeFormatted} — ${formatDate(s.modifiedTime)}</option>`
  ).join("");
  document.getElementById("compare-results").innerHTML = "";
  modal.hidden = false;
}

document.getElementById("compare-close-btn").addEventListener("click", () => { document.getElementById("compare-modal").hidden = true; });
document.getElementById("compare-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });

document.getElementById("compare-run-btn").addEventListener("click", async () => {
  const snap2   = document.getElementById("compare-select").value;
  const results = document.getElementById("compare-results");
  results.innerHTML = `<p style="color:rgba(247,248,251,0.5)">Comparing…</p>`;
  try {
    const res  = await fetch(`/api/snapshot?action=compare&repo=${encodeURIComponent(repoName)}&snapshot1=${encodeURIComponent(currentSnap)}&snapshot2=${encodeURIComponent(snap2)}`);
    const json = await res.json();
    if (!json.success) { results.innerHTML = `<p class="overlay-error">${esc(json.error)}</p>`; return; }
    const { added, removed, modified, unchanged, summary } = json.data;
    results.innerHTML = `
      <div class="diff-summary">
        <span class="diff-badge diff-added-badge">+${summary.added} added</span>
        <span class="diff-badge diff-removed-badge">-${summary.removed} removed</span>
        <span class="diff-badge diff-modified-badge">~${summary.modified} modified</span>
        <span class="diff-badge diff-unchanged-badge">${summary.unchanged} unchanged</span>
      </div>
      ${added.length    ? `<div class="diff-group"><div class="diff-group-label diff-added-label">Added</div>${added.map(f=>`<div class="diff-item diff-item-added">+ ${esc(f)}</div>`).join("")}</div>` : ""}
      ${removed.length  ? `<div class="diff-group"><div class="diff-group-label diff-removed-label">Removed</div>${removed.map(f=>`<div class="diff-item diff-item-removed">- ${esc(f)}</div>`).join("")}</div>` : ""}
      ${modified.length ? `<div class="diff-group"><div class="diff-group-label diff-modified-label">Modified</div>${modified.map(f=>`<div class="diff-item diff-item-modified">~ ${esc(f)}</div>`).join("")}</div>` : ""}
      ${(!added.length && !removed.length && !modified.length) ? `<p style="color:#5dd8a0;margin-top:12px">✓ Snapshots are identical</p>` : ""}`;
  } catch {
    results.innerHTML = `<p class="overlay-error">Network error</p>`;
  }
});

// ── Verify modal ──────────────────────────────────────────────────────────────
async function openVerifyModal() {
  const modal = document.getElementById("verify-modal");
  const body  = document.getElementById("verify-body");
  modal.hidden = false;
  body.innerHTML = `<p class="overlay-modal-sub">Verifying checksums… this may take a moment.</p><div class="verify-spinner"></div>`;
  try {
    const res  = await fetch(`/api/snapshot?action=verify&repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(currentSnap)}`);
    const json = await res.json();
    if (!json.success) { body.innerHTML = `<p class="overlay-error">${esc(json.error)}</p>`; return; }
    const { results, summary, clean } = json.data;
    const integrity = clean
      ? `<div class="verify-badge verify-badge-ok">✓ All checksums verified — snapshot is intact</div>`
      : `<div class="verify-badge verify-badge-fail">⚠ ${summary.failed} file(s) may be tampered</div>`;
    const rows = Object.entries(results).map(([file, status]) => {
      const icon = status === "ok" ? "✓" : status === "tampered" ? "✗" : "·";
      const cls  = status === "ok" ? "verify-ok" : status === "tampered" ? "verify-fail" : "verify-skip";
      return `<div class="verify-row"><span class="verify-icon ${cls}">${icon}</span><span class="verify-file">${esc(file)}</span></div>`;
    }).join("");
    body.innerHTML = `
      ${integrity}
      <div class="verify-summary">
        <span class="diff-badge diff-added-badge">${summary.passed} passed</span>
        <span class="diff-badge diff-removed-badge">${summary.failed} failed</span>
        <span class="diff-badge diff-unchanged-badge">${summary.skipped} skipped</span>
      </div>
      <div class="verify-list">${rows}</div>`;
  } catch {
    body.innerHTML = `<p class="overlay-error">Network error during verification.</p>`;
  }
}

document.getElementById("verify-close-btn").addEventListener("click", () => { document.getElementById("verify-modal").hidden = true; });
document.getElementById("verify-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });

// ── Editor events ─────────────────────────────────────────────────────────────
document.getElementById("editor-close-btn").addEventListener("click", closeEditor);
document.getElementById("editor-save-btn").addEventListener("click", saveFile);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeEditor();
  if ((e.ctrlKey || e.metaKey) && e.key === "`") { e.preventDefault(); toggleTerminal(); }
});

// ── Terminal ──────────────────────────────────────────────────────────────────
function toggleTerminal() {
  const panel = document.getElementById("terminal-panel");
  const open  = panel.classList.toggle("open");
  panel.setAttribute("aria-hidden", String(!open));
  const btn = document.querySelector("[data-action=toggle-terminal]");
  if (btn) { btn.classList.toggle("sidebar-terminal-btn--active", open); btn.blur(); }
  if (open) document.getElementById("terminal-input")?.focus();
}

function initTerminal() {
  const panel  = document.getElementById("terminal-panel");
  const output = document.getElementById("terminal-output");
  const input  = document.getElementById("terminal-input");
  if (!panel) return;
  appendTermLine("Welcome to Julion Terminal — type `help` for available commands.", "info");
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const cmd = input.value.trim();
    if (!cmd) return;
    input.value = "";
    appendTermLine("julion> " + cmd, "prompt");
    if (cmd === "clear") { output.innerHTML = ""; return; }
    input.disabled = true;
    try {
      const res  = await fetch(`/api/terminal?cmd=${encodeURIComponent(cmd)}`);
      const json = await res.json();
      if (json.success) {
        if (json.data.output === "__CLEAR__") output.innerHTML = "";
        else appendTermLine(json.data.output, json.data.diff ? "diff" : (json.data.type || "result"));
      } else {
        appendTermLine("Error: " + (json.error || "unknown"), "error");
      }
    } catch {
      appendTermLine("Network error", "error");
    } finally {
      input.disabled = false;
      input.focus();
      output.scrollTop = output.scrollHeight;
    }
  });
  document.getElementById("terminal-close-btn").addEventListener("click", () => {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  });
  document.getElementById("terminal-clear-btn").addEventListener("click", () => { output.innerHTML = ""; });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-action=toggle-terminal]")) toggleTerminal();
  });
}

function appendTermLine(text, type = "result") {
  const output = document.getElementById("terminal-output");
  if (!output) return;
  const el = document.createElement("pre");
  el.className = `terminal-line terminal-line-${type}`;
  el.textContent = text;
  output.appendChild(el);
  output.scrollTop = output.scrollHeight;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function init() {
  if (!repoName) { window.location.href = "/repositories"; return; }
  const user = await requireUser();
  if (!user) return;
  document.getElementById("sidebar").innerHTML = renderSidebar(user, "repositories");
  initTerminal();

  const main = document.getElementById("repo-main");
  main.innerHTML = `<div style="color:rgba(247,248,251,0.4);padding:40px;font-size:0.85rem">Loading…</div>`;

  try {
    const snapsRes  = await fetch(`/api/snapshots?repo=${encodeURIComponent(repoName)}`);
    const snapsJson = await snapsRes.json();
    if (!snapsJson.success) { showError(main, snapsJson.error || "Failed to load snapshots."); return; }
    allSnapshots = snapsJson.data;

    if (!allSnapshots.length) {
      main.style.padding = "40px 44px";
      main.innerHTML = `
        <div class="page-header" style="margin-bottom:28px">
          <a class="back-link" href="/repositories">← Repositories</a>
          <h1 class="page-title">${esc(repoName)}</h1>
        </div>
        <div class="empty-state">
          <p>No snapshots in <strong>${esc(repoName)}</strong> yet.</p>
          <p style="margin-top:10px;color:rgba(247,248,251,0.45)">Run: <code>julion seal --deposit --repository ${esc(repoName)}</code></p>
        </div>`;
      return;
    }

    // Pick snapshot from URL or default to latest
    currentSnap = (currentSnap && allSnapshots.some(s => s.name === currentSnap))
      ? currentSnap
      : allSnapshots[0].name;

    const url = new URL(location.href);
    url.searchParams.set("snapshot", currentSnap);
    history.replaceState(null, "", url.toString());

    const treeRes  = await fetch(`/api/snapshot?action=tree&repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(currentSnap)}`);
    const treeJson = await treeRes.json();
    if (!treeJson.success) { showError(main, treeJson.error || "Failed to load snapshot."); return; }
    treeData = treeJson.data;

    renderMainContent();
  } catch (err) {
    showError(main, err.message || "Failed to load repository.");
  }
}

init();
