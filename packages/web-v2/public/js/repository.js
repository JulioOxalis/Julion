import { requireUser, esc, formatBytes, formatDate, renderSidebar, showError } from "./app.js";

const params   = new URLSearchParams(location.search);
const repoName = params.get("repo");
const snapName = params.get("snapshot");

// ── State ─────────────────────────────────────────────────────────────────────
let allSnapshots   = [];  // for compare dropdown
let currentFile    = null;
let monacoEditor   = null;
let monacoLoaded   = false;
let treeData       = null; // { files, checksums, manifest, ... }

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

const BINARY_RE = /\.(png|jpg|jpeg|gif|ico|webp|bmp|pdf|zip|tar|gz|7z|rar|exe|dll|wasm|mp3|mp4|wav|ogg|ttf|woff|woff2)$/i;

// ── Tree builder ──────────────────────────────────────────────────────────────
function buildTree(files) {
  const root = {};
  for (const path of files) {
    const parts = path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = { __dir: true, __kids: {} };
      node = node[parts[i]].__kids;
    }
    const fname = parts[parts.length - 1];
    node[fname] = { __dir: false, __path: path };
  }
  return root;
}

function renderTreeHTML(node, level = 0) {
  const sorted = Object.entries(node).sort(([an, av], [bn, bv]) => {
    if (av.__dir !== bv.__dir) return av.__dir ? -1 : 1;
    return an.localeCompare(bn, undefined, { sensitivity: "base" });
  });
  return sorted.map(([name, item]) => {
    const pl = (level * 14) + 8;
    if (item.__dir) {
      return `<div class="tree-folder">
        <div class="tree-row tree-folder-hdr" style="padding-left:${pl}px">
          <span class="tree-chevron">▸</span>
          <span class="tree-icon">📁</span>
          <span class="tree-label">${esc(name)}</span>
        </div>
        <div class="tree-children" hidden>${renderTreeHTML(item.__kids, level + 1)}</div>
      </div>`;
    }
    return `<div class="tree-row tree-file" style="padding-left:${pl + 16}px"
        data-file="${esc(item.__path)}" tabindex="0" role="button" aria-label="Open ${esc(name)}">
      <span class="tree-icon">${fileIcon(name)}</span>
      <span class="tree-label">${esc(name)}</span>
    </div>`;
  }).join("");
}

// ── Monaco ────────────────────────────────────────────────────────────────────
function loadMonaco() {
  if (monacoLoaded) return Promise.resolve();
  monacoLoaded = true;
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs/loader.js";
    s.onload = () => {
      require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs" } });
      require(["vs/editor/editor.main"], resolve);
    };
    document.head.appendChild(s);
  });
}

async function openInMonaco(filename) {
  const statusEl = document.getElementById("editor-status");
  document.getElementById("editor-path").textContent = filename;
  document.getElementById("editor-modal").classList.add("editor-open");
  document.getElementById("editor-save-btn").disabled = true;
  statusEl.textContent = "Loading…";

  const res  = await fetch(`/api/files?repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(snapName)}&file=${encodeURIComponent(filename)}`);
  const json = await res.json();

  if (!json.success || json.data.binary) {
    statusEl.textContent = json.data?.binary ? "Binary file — cannot edit" : (json.error || "Error loading file");
    return;
  }

  await loadMonaco();
  currentFile = filename;
  const container = document.getElementById("monaco-container");

  if (monacoEditor) {
    monacoEditor.getModel()?.dispose();
    monacoEditor.setModel(monaco.editor.createModel(json.data.content, detectLang(filename)));
  } else {
    monacoEditor = monaco.editor.create(container, {
      value: json.data.content,
      language: detectLang(filename),
      theme: "vs-dark",
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
    });
    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFile);
  }

  statusEl.textContent = "Ready";
  document.getElementById("editor-save-btn").disabled = false;
}

function closeEditor() {
  document.getElementById("editor-modal").classList.remove("editor-open");
  currentFile = null;
}

async function saveFile() {
  if (!currentFile || !monacoEditor) return;
  const statusEl = document.getElementById("editor-status");
  const saveBtn  = document.getElementById("editor-save-btn");
  saveBtn.disabled = true;
  statusEl.textContent = "Saving…";
  try {
    const res  = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoName, snapshot: snapName, file: currentFile, content: monacoEditor.getValue() }),
    });
    const json = await res.json();
    statusEl.textContent = json.success ? "Saved ✓" : ("Error: " + (json.error || "unknown"));
  } catch {
    statusEl.textContent = "Network error";
  } finally {
    saveBtn.disabled = false;
  }
}

// ── File click handler ────────────────────────────────────────────────────────
async function handleFileClick(filename) {
  // Mark active
  document.querySelectorAll(".tree-file").forEach(el => el.classList.remove("tree-file-active"));
  document.querySelector(`.tree-file[data-file="${CSS.escape(filename)}"]`)?.classList.add("tree-file-active");

  // README → render inline
  if (/readme(\.(md|txt|rst))?$/i.test(filename.split("/").pop())) {
    await renderReadmeInline(filename);
    return;
  }

  // Binary → show message
  if (BINARY_RE.test(filename)) {
    setContentPane(`<div class="repo-welcome"><span style="font-size:2.5rem">🖼️</span><p>Binary file — cannot display <code>${esc(filename)}</code></p></div>`);
    return;
  }

  // Text → Monaco
  openInMonaco(filename);
}

async function renderReadmeInline(filename) {
  const pane = document.getElementById("repo-content-pane");
  pane.innerHTML = `<div style="padding:32px 36px;color:rgba(247,248,251,0.5);font-size:0.88rem">Loading ${esc(filename)}…</div>`;

  try {
    const res  = await fetch(`/api/files?repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(snapName)}&file=${encodeURIComponent(filename)}`);
    const json = await res.json();
    if (!json.success || json.data.binary) {
      pane.innerHTML = `<div class="repo-welcome"><p>Could not load ${esc(filename)}</p></div>`;
      return;
    }
    const raw = json.data.content;
    // Simple markdown-to-HTML (headings, code, bold, italic, lists)
    const html = simpleMarkdown(raw);
    pane.innerHTML = `<div class="readme-view">${html}</div>`;
  } catch {
    pane.innerHTML = `<div class="repo-welcome"><p>Failed to load file.</p></div>`;
  }
}

function simpleMarkdown(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^#{6}\s(.+)/gm, "<h6>$1</h6>")
    .replace(/^#{5}\s(.+)/gm, "<h5>$1</h5>")
    .replace(/^#{4}\s(.+)/gm, "<h4>$1</h4>")
    .replace(/^###\s(.+)/gm, "<h3>$1</h3>")
    .replace(/^##\s(.+)/gm,  "<h2>$1</h2>")
    .replace(/^#\s(.+)/gm,   "<h1>$1</h1>")
    .replace(/```[\w]*\n([\s\S]*?)```/gm, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/^\s*[-*+]\s+(.+)/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[hpuloc])/gm, "")
    .replace(/^(.+)$/gm, (m) => m.startsWith("<") ? m : `<p>${m}</p>`);
}

function setContentPane(html) {
  const pane = document.getElementById("repo-content-pane");
  if (pane) pane.innerHTML = html;
}

// ── Snapshot detail view ──────────────────────────────────────────────────────
async function renderSnapshotDetail(main) {
  // Show loading skeleton
  main.classList.add("repo-snap-mode");
  main.innerHTML = `<div style="padding:40px;color:rgba(247,248,251,0.4)">Loading snapshot…</div>`;

  let treeRes, snapsRes;
  try {
    [treeRes, snapsRes] = await Promise.all([
      fetch(`/api/snapshot?action=tree&repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(snapName)}`).then(r => r.json()),
      fetch(`/api/snapshots?repo=${encodeURIComponent(repoName)}`).then(r => r.json()),
    ]);
  } catch {
    showError(main, "Network error loading snapshot.");
    return;
  }

  if (!treeRes.success) { showError(main, treeRes.error || "Failed to load snapshot."); return; }

  treeData     = treeRes.data;
  allSnapshots = snapsRes.success ? snapsRes.data : [];

  const { files, checksums, manifest, totalFiles, size, modifiedTime, readmeFile } = treeData;
  const tree = buildTree(files);

  // Search filter state
  let searchQuery = "";

  main.innerHTML = `
    <div class="repo-snap-layout">

      <!-- Top bar -->
      <div class="repo-snap-bar">
        <a class="repo-snap-back" href="/repository?repo=${encodeURIComponent(repoName)}">← ${esc(repoName)}</a>
        <span class="repo-snap-sep">/</span>
        <span class="repo-snap-name">${esc(snapName)}</span>
        <div class="repo-snap-meta-pills">
          <span class="snap-pill">${totalFiles} files</span>
          <span class="snap-pill">${formatBytes(size)}</span>
          <span class="snap-pill">${formatDate(modifiedTime)}</span>
          ${manifest.projectName ? `<span class="snap-pill snap-pill-accent">${esc(manifest.projectName)}</span>` : ""}
        </div>
        <div class="repo-snap-actions">
          <button class="snap-action-btn" id="verify-btn" title="Verify file checksums">🔒 Verify</button>
          <button class="snap-action-btn" id="compare-btn" title="Compare with another snapshot" ${allSnapshots.length < 2 ? "disabled" : ""}>⚡ Compare</button>
          <button class="snap-action-btn snap-action-btn-terminal" id="open-terminal-btn" title="Open terminal (Ctrl+`)">⌘ Terminal</button>
        </div>
      </div>

      <!-- Body: file tree + content pane -->
      <div class="repo-snap-body">

        <!-- File tree panel -->
        <div class="repo-file-panel" id="repo-file-panel">
          <div class="tree-search-wrap">
            <input class="tree-search" id="tree-search" type="text" placeholder="Filter files…" autocomplete="off"/>
          </div>
          <div class="tree-container" id="tree-container">
            ${renderTreeHTML(tree)}
          </div>
        </div>

        <!-- Content pane -->
        <div class="repo-content-pane" id="repo-content-pane">
          <div class="repo-welcome">
            <div class="repo-welcome-icon">📦</div>
            <h3>${esc(snapName)}</h3>
            <p>${totalFiles} files · ${formatBytes(size)} · ${formatDate(modifiedTime)}</p>
            <p class="repo-welcome-hint">Select a file from the tree to open it.<br/>
              README files render inline. Code files open in the editor.</p>
            ${readmeFile ? `<button class="snap-action-btn snap-action-btn-accent" id="open-readme-btn">📝 Open README</button>` : ""}
          </div>
        </div>

      </div>
    </div>`;

  // Auto-load readme
  if (readmeFile) {
    document.getElementById("open-readme-btn")?.addEventListener("click", () => {
      document.querySelector(`.tree-file[data-file="${CSS.escape(readmeFile)}"]`)?.scrollIntoView({ block: "nearest" });
      handleFileClick(readmeFile);
    });
  }

  // Tree search filter
  document.getElementById("tree-search").addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    filterTree(searchQuery, files, checksums);
  });

  wireTreeEvents();
  wireActionButtons();
}

function filterTree(query, files, checksums) {
  const container = document.getElementById("tree-container");
  if (!query) {
    container.innerHTML = renderTreeHTML(buildTree(files));
    wireTreeEvents();
    return;
  }
  const matched = files.filter(f => f.toLowerCase().includes(query));
  if (!matched.length) {
    container.innerHTML = `<p style="padding:12px 16px;color:rgba(247,248,251,0.35);font-size:0.82rem">No files match "${esc(query)}"</p>`;
    return;
  }
  // Flat list when searching
  container.innerHTML = matched.map(f => {
    const parts = f.split("/");
    const name  = parts[parts.length - 1];
    return `<div class="tree-row tree-file tree-file-flat" data-file="${esc(f)}" tabindex="0" role="button">
      <span class="tree-icon">${fileIcon(name)}</span>
      <span class="tree-label">${esc(f)}</span>
    </div>`;
  }).join("");
  wireTreeEvents();
}

function wireTreeEvents() {
  // Folder toggle
  document.querySelectorAll(".tree-folder-hdr").forEach(hdr => {
    hdr.onclick = () => {
      const folder   = hdr.closest(".tree-folder");
      const children = folder.querySelector(".tree-children");
      const chevron  = hdr.querySelector(".tree-chevron");
      const icon     = hdr.querySelector(".tree-icon");
      const isOpen   = !children.hidden;
      children.hidden = isOpen;
      chevron.textContent = isOpen ? "▸" : "▾";
      icon.textContent    = isOpen ? "📁" : "📂";
    };
  });
  // File click
  document.querySelectorAll(".tree-file").forEach(el => {
    el.onclick = () => handleFileClick(el.dataset.file);
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleFileClick(el.dataset.file); } };
  });
}

function wireActionButtons() {
  document.getElementById("verify-btn")?.addEventListener("click", openVerifyModal);
  document.getElementById("compare-btn")?.addEventListener("click", openCompareModal);
  document.getElementById("open-terminal-btn")?.addEventListener("click", toggleTerminal);
}

// ── Compare modal ─────────────────────────────────────────────────────────────
function openCompareModal() {
  const modal  = document.getElementById("compare-modal");
  const select = document.getElementById("compare-select");
  const others = allSnapshots.filter(s => s.name !== snapName);
  select.innerHTML = others.map(s => `<option value="${esc(s.name)}">${esc(s.name)} — ${s.sizeFormatted} — ${formatDate(s.modifiedTime)}</option>`).join("");
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
    const res  = await fetch(`/api/snapshot?action=compare&repo=${encodeURIComponent(repoName)}&snapshot1=${encodeURIComponent(snapName)}&snapshot2=${encodeURIComponent(snap2)}`);
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
      ${added.length   ? `<div class="diff-group"><div class="diff-group-label diff-added-label">Added</div>${added.map(f=>`<div class="diff-item diff-item-added">+ ${esc(f)}</div>`).join("")}</div>` : ""}
      ${removed.length ? `<div class="diff-group"><div class="diff-group-label diff-removed-label">Removed</div>${removed.map(f=>`<div class="diff-item diff-item-removed">- ${esc(f)}</div>`).join("")}</div>` : ""}
      ${modified.length? `<div class="diff-group"><div class="diff-group-label diff-modified-label">Modified</div>${modified.map(f=>`<div class="diff-item diff-item-modified">~ ${esc(f)}</div>`).join("")}</div>` : ""}
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
    const res  = await fetch(`/api/snapshot?action=verify&repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(snapName)}`);
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

// ── Repo overview (snapshot history) ─────────────────────────────────────────
function renderRepoOverview(snapshots, main) {
  if (!snapshots.length) {
    main.innerHTML = `
      <div class="page-header"><a class="back-link" href="/repositories">← Repositories</a><h1 class="page-title">${esc(repoName)}</h1></div>
      <div class="empty-state">
        <p>No snapshots in <strong>${esc(repoName)}</strong> yet.</p>
        <p style="margin-top:10px"><code>julion seal --deposit --repository ${esc(repoName)}</code></p>
      </div>`;
    return;
  }

  const rows = snapshots.map((s, i) => `
    <div class="commit-row">
      <div class="commit-timeline">
        <div class="commit-dot ${i === 0 ? "commit-dot-latest" : ""}"></div>
        ${i < snapshots.length - 1 ? `<div class="commit-line"></div>` : ""}
      </div>
      <div class="commit-info">
        <div class="commit-top">
          <a class="commit-name" href="/repository?repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(s.name)}">${esc(s.name)}</a>
          ${i === 0 ? `<span class="commit-badge-latest">latest</span>` : ""}
        </div>
        <div class="commit-meta">
          <span class="commit-size">${s.sizeFormatted}</span>
          <span class="commit-date">${formatDate(s.modifiedTime)}</span>
        </div>
      </div>
      <div class="commit-actions">
        <a class="commit-btn" href="/repository?repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(s.name)}">Open →</a>
      </div>
    </div>`).join("");

  main.innerHTML = `
    <div class="page-header" style="margin-bottom:28px">
      <a class="back-link" href="/repositories">← Repositories</a>
      <h1 class="page-title">${esc(repoName)}</h1>
      <p class="page-subtitle">${snapshots.length} snapshot${snapshots.length !== 1 ? "s" : ""}</p>
    </div>
    <div class="commit-log">${rows}</div>`;
}

// ── Terminal ──────────────────────────────────────────────────────────────────
function toggleTerminal() {
  const panel = document.getElementById("terminal-panel");
  const open  = panel.classList.toggle("open");
  panel.setAttribute("aria-hidden", String(!open));
  if (open) document.getElementById("terminal-input")?.focus();
}

function initTerminal() {
  const panel  = document.getElementById("terminal-panel");
  const output = document.getElementById("terminal-output");
  const input  = document.getElementById("terminal-input");
  if (!panel) return;

  appendTermLine("Welcome to Julion Terminal — type \`help\` for available commands.", "info");

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

  // Wire terminal toggle button in sidebar
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

  if (snapName) {
    await renderSnapshotDetail(main);
  } else {
    main.style.padding = "40px 44px";
    try {
      const res  = await fetch(`/api/snapshots?repo=${encodeURIComponent(repoName)}`);
      const json = await res.json();
      if (!json.success) { showError(main, json.error || "Failed to load snapshots."); return; }
      renderRepoOverview(json.data, main);
    } catch {
      showError(main, "Failed to load snapshots.");
    }
  }
}

init();
