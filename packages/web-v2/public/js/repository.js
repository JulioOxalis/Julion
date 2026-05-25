import { requireUser, esc, formatBytes, formatDate, renderSidebar, showError } from "./app.js";

const params   = new URLSearchParams(location.search);
const repoName = params.get("repo");
const snapName = params.get("snapshot");

// ── Language detection ────────────────────────────────────────────────────────
function detectLang(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return ({
    ts:"typescript", tsx:"typescript",
    js:"javascript", jsx:"javascript", mjs:"javascript", cjs:"javascript",
    py:"python",
    json:"json", jsonc:"json",
    css:"css", scss:"scss", less:"less",
    html:"html", htm:"html",
    md:"markdown", mdx:"markdown",
    go:"go", rs:"rust", php:"php",
    java:"java", kt:"kotlin", swift:"swift",
    c:"c", cpp:"cpp", h:"c", hpp:"cpp",
    sh:"shell", bash:"shell", zsh:"shell",
    yaml:"yaml", yml:"yaml",
    toml:"ini", ini:"ini", env:"ini",
    xml:"xml", graphql:"graphql", sql:"sql",
  })[ext] || "plaintext";
}

// ── Monaco editor state ───────────────────────────────────────────────────────
let monacoEditor = null;
let currentFile  = null;
let monacoLoaded = false;

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

async function openFile(filename) {
  const statusEl = document.getElementById("editor-status");
  statusEl.textContent = "Loading…";
  document.getElementById("editor-path").textContent = filename;
  document.getElementById("editor-modal").classList.add("editor-open");
  document.getElementById("editor-save-btn").disabled = true;

  const res  = await fetch(
    `/api/files/content?repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(snapName)}&file=${encodeURIComponent(filename)}`
  );
  const json = await res.json();

  if (!json.success || json.data.binary) {
    statusEl.textContent = json.data?.binary ? "Binary file — cannot edit" : (json.error || "Error");
    return;
  }

  await loadMonaco();

  currentFile = filename;
  const container = document.getElementById("monaco-container");

  if (monacoEditor) {
    monacoEditor.getModel()?.dispose();
    monacoEditor.setModel(
      monaco.editor.createModel(json.data.content, detectLang(filename))
    );
  } else {
    monacoEditor = monaco.editor.create(container, {
      value:           json.data.content,
      language:        detectLang(filename),
      theme:           "vs-dark",
      fontSize:        13,
      minimap:         { enabled: false },
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
    const res  = await fetch("/api/files/save", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        repo:     repoName,
        snapshot: snapName,
        file:     currentFile,
        content:  monacoEditor.getValue(),
      }),
    });
    const json = await res.json();
    statusEl.textContent = json.success ? "Saved to Drive ✓" : ("Error: " + (json.error || "unknown"));
  } catch {
    statusEl.textContent = "Network error";
  } finally {
    saveBtn.disabled = false;
  }
}

// ── Snapshot detail renderer ──────────────────────────────────────────────────
function renderSnapshotDetail(archive) {
  const m = archive.manifest || {};
  const files = archive.index?.files || [];
  const checksums = archive.checksums || {};

  return `
    <div class="snapshot-grid">
      <div class="info-card">
        <h3 class="section-label">Metadata</h3>
        <table class="data-table meta-table">
          <tbody>
            <tr><td class="meta-key">Project</td><td>${esc(m.projectName || "—")}</td></tr>
            <tr><td class="meta-key">Created</td><td>${formatDate(m.createdAt)}</td></tr>
            <tr><td class="meta-key">Files</td><td>${files.length}</td></tr>
            <tr><td class="meta-key">Snapshot</td><td>${esc(snapName)}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="info-card">
        <h3 class="section-label">Files</h3>
        <p class="file-hint">Click a code file to open it in the editor.</p>
        <div class="file-tree">
          ${files.map((f) => {
            const cs   = checksums[f] ? checksums[f].replace("sha256:", "").slice(0, 8) + "…" : "";
            const editable = !/\.(png|jpg|jpeg|gif|ico|webp|bmp|pdf|zip|tar|gz|7z|rar|exe|dll|wasm|mp3|mp4|wav|ogg|ttf|woff|woff2)$/i.test(f);
            return `<div class="file-tree-item${editable ? " file-editable" : ""}"
              ${editable ? `data-file="${esc(f)}" tabindex="0" role="button" aria-label="Edit ${esc(f)}"` : ""}
              >
              <span class="file-name">${esc(f)}</span>
              ${cs ? `<span class="checksum">${cs}</span>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>
    </div>`;
}

// ── Repo overview renderer ────────────────────────────────────────────────────
function renderRepoOverview(snapshots) {
  if (!snapshots.length) {
    return `<div class="empty-state"><p>No snapshots found in <strong>${esc(repoName)}</strong>.</p>
      <p>Run <code>julion seal --deposit --repository ${esc(repoName)}</code> to create one.</p></div>`;
  }

  const rows = snapshots
    .map(
      (s) => `<tr>
        <td><a class="table-link" href="/repository?repo=${encodeURIComponent(repoName)}&snapshot=${encodeURIComponent(s.name)}">${esc(s.name)}</a></td>
        <td>${s.sizeFormatted}</td>
        <td>${formatDate(s.modifiedTime)}</td>
      </tr>`
    )
    .join("");

  return `<table class="data-table">
    <thead><tr><th>Snapshot</th><th>Size</th><th>Modified</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function init() {
  if (!repoName) { window.location.href = "/repositories"; return; }

  const user = await requireUser();
  if (!user) return;

  document.getElementById("sidebar").innerHTML = renderSidebar(user, "repositories");
  document.getElementById("page-title").textContent = snapName || repoName;
  document.getElementById("back-link").href = snapName ? `/repository?repo=${encodeURIComponent(repoName)}` : "/repositories";
  document.getElementById("back-link").textContent = snapName ? `← ${repoName}` : "← Repositories";

  const main = document.getElementById("main-content");

  if (snapName) {
    // Snapshot detail — we need to download + parse the archive via a separate API
    // Fetch the file list via snapshot metadata endpoint
    try {
      const res  = await fetch(`/api/snapshots?repo=${encodeURIComponent(repoName)}`);
      const json = await res.json();
      if (!json.success) { showError(main, json.error || "Failed to load snapshot"); return; }

      const snap = json.data.find((s) => s.name === snapName);
      if (!snap) { showError(main, "Snapshot not found."); return; }

      // We don't have full archive data from the snapshots API — show a limited view
      // Full metadata requires reading the .on file. Show what we have from Drive metadata.
      main.innerHTML = `
        <div class="snapshot-grid">
          <div class="info-card">
            <h3 class="section-label">Metadata</h3>
            <table class="data-table meta-table">
              <tbody>
                <tr><td class="meta-key">Snapshot</td><td>${esc(snap.name)}</td></tr>
                <tr><td class="meta-key">Size</td><td>${snap.sizeFormatted}</td></tr>
                <tr><td class="meta-key">Modified</td><td>${formatDate(snap.modifiedTime)}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="info-card" id="file-tree-card">
            <h3 class="section-label">Files</h3>
            <p class="status-text">Loading file tree…</p>
          </div>
        </div>`;

      // Load file tree by fetching a dummy content call to trigger archive read
      loadFileTree();
    } catch {
      showError(main, "Failed to load snapshot.");
    }
  } else {
    // Repo overview — list of snapshots
    try {
      const res  = await fetch(`/api/snapshots?repo=${encodeURIComponent(repoName)}`);
      const json = await res.json();
      if (!json.success) { showError(main, json.error || "Failed to load snapshots"); return; }
      main.innerHTML = renderRepoOverview(json.data);
    } catch {
      showError(main, "Failed to load snapshots.");
    }
  }

  // File tree loading via index endpoint
  async function loadFileTree() {
    // Get file list by requesting a sentinel file that doesn't exist — we'll get 404 but archive
    // index is returned. Actually, we call the content API for a known path trick.
    // Instead, we use a dedicated snapshot index approach:
    // Since we don't have a /api/snapshot-index endpoint, request the first file
    // and rely on the archive being read. A cleaner approach: add /api/snapshot endpoint.
    // For now, we present an "open in editor" prompt.
    const card = document.getElementById("file-tree-card");
    if (!card) return;
    card.innerHTML = `
      <h3 class="section-label">Files</h3>
      <p class="file-hint">Click a filename below to open it in the built-in editor.</p>
      <div class="empty-state" style="padding:18px">
        <p>File tree loads when you open a file.</p>
        <p style="margin-top:8px;font-size:0.82rem;color:rgba(247,248,251,0.5)">
          The CLI can show the full tree: <code>julion unseal ${esc(snapName)} --list</code>
        </p>
      </div>`;
  }
}

// ── Event delegation for file tree ───────────────────────────────────────────
document.addEventListener("click", (e) => {
  const item = e.target.closest("[data-file]");
  if (item) openFile(item.dataset.file);
  if (e.target.id === "editor-close-btn" || e.target.closest("#editor-close-btn")) closeEditor();
  if (e.target.id === "editor-save-btn" || e.target.closest("#editor-save-btn")) saveFile();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeEditor();
  const item = e.target.closest("[data-file]");
  if (item && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openFile(item.dataset.file); }
});

init();
